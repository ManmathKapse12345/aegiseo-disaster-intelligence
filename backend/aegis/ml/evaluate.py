"""Quantitative evaluation of the water-segmentation models and classical baselines.

Splits     : Sen1Floods11 hand-labelled ``test`` (90 chips, 10 events seen in training)
             and ``bolivia`` (15 chips from an event never seen in training).
Conditions : ``as_is``    data as provided (natural clouds / no-data included)
             ``cloud_50`` simulated 50 % cloud cover on Sentinel-2 (fixed seeds)
             ``no_s2``    optical unavailable (e.g. persistent monsoon cloud)
             ``no_s1``    SAR unavailable
Metrics    : micro-averaged IoU / F1 / precision / recall / accuracy for the water class,
             IoU on non-permanent ("flood") water excluding JRC permanent water,
             mean per-chip IoU, ECE / MCE / Brier / NLL before and after temperature
             scaling, and MC-dropout uncertainty quality (error-detection AUROC and a
             risk-coverage table) for the improved model.

A sensor-specific system cannot map pixels its sensor did not observe: for single-sensor
baselines, pixels without valid input count as "not detected".

Usage::

    python -m aegis.ml.evaluate --data ../data/datasets/sen1floods11_prepared --models ../models
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
import torch
from torch.utils.data import DataLoader

from aegis.ml import augment
from aegis.ml.baselines import optical_water_index, sar_water_otsu
from aegis.ml.data import Sen1Floods11
from aegis.ml.features import FeatureStats
from aegis.ml.metrics import CalibrationAccumulator, Confusion, auroc, binary_entropy, reliability, safe_float
from aegis.ml.models import MODEL_VARIANTS, build_model, forward_variant, trunk_features

CONDITIONS = {
    "as_is": ({}, "Data as provided (natural clouds and no-data included)"),
    "cloud_50": ({"fixed_cloud_coverage": 0.5}, "Simulated 50% cloud cover on Sentinel-2"),
    "no_s2": ({"remove_s2": True}, "Sentinel-2 unavailable (e.g. persistent cloud)"),
    "no_s1": ({"remove_s1": True}, "Sentinel-1 unavailable"),
}
SPLITS = ("valid", "test", "bolivia")
SELECTION_SPLIT = "valid"  # model selection uses validation data only (test/bolivia stay untouched)


def _applicable(variant: str, cond: str) -> bool:
    if variant == "s1_unet" and cond == "no_s1":
        return False
    if variant == "s2_unet" and cond == "no_s2":
        return False
    return True


def _summ(conf: Confusion, conf_flood: Confusion, chip_ious: list[float], cal_raw, cal_cal) -> dict:
    out = {k: safe_float(v) if isinstance(v, float) else v for k, v in conf.as_dict().items()}
    out["flood_iou_excl_permanent"] = safe_float(conf_flood.iou)
    out["mean_chip_iou"] = safe_float(float(np.nanmean(chip_ious))) if chip_ious else None
    if cal_raw is not None:
        p, y = cal_raw.arrays()
        out["calibration_uncalibrated"] = reliability(p, y)
    if cal_cal is not None:
        p, y = cal_cal.arrays()
        out["calibration"] = reliability(p, y)
    return out


def _chip_iou(pred: np.ndarray, label: np.ndarray) -> float:
    c = Confusion().update(pred, label)
    return c.iou if (c.tp + c.fn) > 0 else float("nan")


@torch.no_grad()
def evaluate_model(ckpt_path: Path, data_dir: Path, device: torch.device) -> dict:
    ckpt = torch.load(ckpt_path, map_location="cpu", weights_only=True)
    variant = ckpt["variant"]
    model = build_model(variant, ckpt["config"].get("dropout", 0.2))
    model.load_state_dict(ckpt["state_dict"])
    model.to(device).eval()
    stats = FeatureStats.from_dict(ckpt["stats"])
    temp = float(ckpt["temperature"])
    result = {
        "description": ckpt.get("description"),
        "parameters": ckpt.get("parameters"),
        "temperature": temp,
        "best_epoch": ckpt.get("best_epoch"),
        "val_iou": ckpt.get("val_metrics", {}).get("iou"),
        "train_seconds": ckpt.get("train_seconds"),
        "splits": {},
    }
    for split in SPLITS:
        result["splits"][split] = {}
        for cond, (kw, _) in CONDITIONS.items():
            if not _applicable(variant, cond):
                result["splits"][split][cond] = None
                continue
            ds = Sen1Floods11(data_dir, split, stats, seed=7, **kw)
            dl = DataLoader(ds, batch_size=4, shuffle=False, num_workers=0)
            conf, conf_flood = Confusion(), Confusion()
            cal_raw, cal_cal = CalibrationAccumulator(), CalibrationAccumulator()
            chip_ious: list[float] = []
            for s1, s2, label, jrc in dl:
                logits, _ = forward_variant(model, variant, s1.to(device), s2.to(device))
                lg = logits.float().squeeze(1).cpu().numpy()
                lb, jr = label.numpy(), jrc.numpy()
                observed = np.ones_like(lb, dtype=bool)
                if variant == "s1_unet":
                    observed = s1[:, -1].numpy() > 0.5
                elif variant == "s2_unet":
                    observed = s2[:, -1].numpy() > 0.5
                prob_cal = 1 / (1 + np.exp(-lg / temp))
                prob_raw = 1 / (1 + np.exp(-lg))
                prob_cal[~observed] = 0.0
                prob_raw[~observed] = 0.0
                pred = (lg > 0) & observed
                conf.update(pred, lb)
                lf = lb.copy()
                lf[jr == 1] = -1
                conf_flood.update(pred, lf)
                for b in range(lb.shape[0]):
                    chip_ious.append(_chip_iou(pred[b], lb[b]))
                cal_raw.update(prob_raw, lb)
                cal_cal.update(prob_cal, lb)
            result["splits"][split][cond] = _summ(conf, conf_flood, chip_ious, cal_raw, cal_cal)
            print(f"[eval] {variant:18s} {split:8s} {cond:9s} IoU {conf.iou:.4f} F1 {conf.f1:.4f}", flush=True)
    if variant.startswith("gated_fusion_unet"):
        result["uncertainty"] = uncertainty_quality(model, variant, data_dir, stats, temp, device)
    return result


def _load(ckpt_path: Path, device: torch.device):
    ckpt = torch.load(ckpt_path, map_location="cpu", weights_only=True)
    model = build_model(ckpt["variant"], ckpt["config"].get("dropout", 0.2))
    model.load_state_dict(ckpt["state_dict"])
    return model.to(device).eval(), ckpt


@torch.no_grad()
def evaluate_hybrid(fusion_ckpt: Path, sar_ckpt: Path, data_dir: Path, device: torch.device) -> dict:
    """Fusion model where optical data are valid, SAR specialist where only SAR observed (as deployed)."""
    from aegis.ml.inference import sar_only_weight

    fm, fc = _load(fusion_ckpt, device)
    sm, sc = _load(sar_ckpt, device)
    stats = FeatureStats.from_dict(fc["stats"])
    tf, ts = float(fc["temperature"]), float(sc["temperature"])
    result = {"description": f"Hybrid: {fc['variant']} + {sc['variant']} where optical data are missing",
              "components": [fc["variant"], sc["variant"]], "splits": {}}
    for split in SPLITS:
        result["splits"][split] = {}
        for cond, (kw, _) in CONDITIONS.items():
            ds = Sen1Floods11(data_dir, split, stats, seed=7, **kw)
            dl = DataLoader(ds, batch_size=4, shuffle=False, num_workers=0)
            conf, conf_flood, cal = Confusion(), Confusion(), CalibrationAccumulator()
            chip_ious: list[float] = []
            for s1, s2, label, jrc in dl:
                lf, _ = forward_variant(fm, fc["variant"], s1.to(device), s2.to(device))
                ls, _ = forward_variant(sm, sc["variant"], s1.to(device), s2.to(device))
                pf = torch.sigmoid(lf.float().squeeze(1) / tf).cpu().numpy()
                ps = torch.sigmoid(ls.float().squeeze(1) / ts).cpu().numpy()
                v1, v2 = s1[:, -1].numpy() > 0.5, s2[:, -1].numpy() > 0.5
                w = np.stack([sar_only_weight(v1[b], v2[b]) for b in range(v1.shape[0])])
                p = (1 - w) * pf + w * ps
                p[~(v1 | v2)] = 0.0
                lb, jr = label.numpy(), jrc.numpy()
                pred = p > 0.5
                conf.update(pred, lb)
                lf_ = lb.copy()
                lf_[jr == 1] = -1
                conf_flood.update(pred, lf_)
                for b in range(lb.shape[0]):
                    chip_ious.append(_chip_iou(pred[b], lb[b]))
                cal.update(p, lb)
            result["splits"][split][cond] = _summ(conf, conf_flood, chip_ious, None, cal)
            print(f"[eval] hybrid {split:8s} {cond:9s} IoU {conf.iou:.4f}", flush=True)
    return result


def select_deployment(report: dict) -> dict:
    """Robustness-weighted selection on the validation split: mean IoU over all four sensor conditions."""
    cands = {}
    for name, entry in {**report["models"], **report.get("hybrids", {})}.items():
        if name in ("s1_unet", "s2_unet"):
            continue  # single-sensor models cannot serve all conditions
        vals = [m["iou"] for m in entry["splits"][SELECTION_SPLIT].values() if m and m.get("iou") is not None]
        if len(vals) == len(CONDITIONS):
            cands[name] = float(np.mean(vals))
    if not cands:
        return {}
    best = max(cands, key=cands.get)
    hybrid = report.get("hybrids", {}).get(best)
    return {"model_variant": hybrid["components"][0] if hybrid else best, "sar_specialist": hybrid["components"][1] if hybrid else "",
            "selected": best, "criterion": f"mean IoU over {list(CONDITIONS)} on the '{SELECTION_SPLIT}' split",
            "scores": {k: round(v, 4) for k, v in sorted(cands.items(), key=lambda kv: -kv[1])}}


@torch.no_grad()
def uncertainty_quality(model, variant, data_dir, stats, temp, device, mc: int = 8, split: str = "test") -> dict:
    """Does MC-dropout uncertainty identify errors? (AUROC + risk-coverage)."""
    ds = Sen1Floods11(data_dir, split, stats, seed=7)
    dl = DataLoader(ds, batch_size=2, shuffle=False, num_workers=0)
    rng = np.random.default_rng(0)
    ent_s, std_s, err_s, pred_s, lab_s = [], [], [], [], []
    head, p = model.decoder.head, model.decoder.dropout.p
    for s1, s2, label, _ in dl:
        feats, _ = trunk_features(model, variant, s1.to(device), s2.to(device))
        samples = torch.stack([
            torch.sigmoid(head(torch.nn.functional.dropout2d(feats, p=p, training=True)).float() / temp)[:, 0]
            for _ in range(mc)
        ])
        mean = samples.mean(0).cpu().numpy()
        std = samples.std(0).cpu().numpy()
        lb = label.numpy()
        valid = lb >= 0
        pred = mean > 0.5
        err = pred != (lb == 1)
        idx = np.flatnonzero(valid.ravel())
        if idx.size > 40000:
            idx = rng.choice(idx, 40000, replace=False)
        ent_s.append(binary_entropy(mean).ravel()[idx])
        std_s.append(std.ravel()[idx])
        err_s.append(err.ravel()[idx])
        pred_s.append(pred.ravel()[idx])
        lab_s.append((lb == 1).ravel()[idx])
    ent, std, err = np.concatenate(ent_s), np.concatenate(std_s), np.concatenate(err_s)
    pred, lab = np.concatenate(pred_s), np.concatenate(lab_s)
    order = np.argsort(ent)  # most confident first
    rc = []
    for cov in (1.0, 0.95, 0.9, 0.8, 0.7):
        keep = order[: int(cov * order.size)]
        c = Confusion().update(pred[keep], lab[keep].astype(np.int64))
        rc.append({"coverage": cov, "accuracy": safe_float(c.accuracy), "iou": safe_float(c.iou),
                   "entropy_threshold": safe_float(float(ent[keep].max())) if keep.size else None})
    return {
        "mc_samples": mc,
        "split": split,
        "pixels": int(err.size),
        "error_rate": float(err.mean()),
        "auroc_entropy_vs_error": safe_float(auroc(ent, err)),
        "auroc_mc_std_vs_error": safe_float(auroc(std, err)),
        "risk_coverage": rc,
    }


def evaluate_classical(data_dir: Path) -> dict:
    """Otsu SAR thresholding, MNDWI and a rule-based optical-else-SAR fusion."""
    out: dict = {
        "otsu_vv": {"description": "Otsu threshold on Sentinel-1 VV (per scene)", "splits": {}},
        "otsu_vh": {"description": "Otsu threshold on Sentinel-1 VH (per scene)", "splits": {}},
        "mndwi": {"description": "MNDWI > 0 on Sentinel-2", "splits": {}},
        "rule_fusion": {"description": "MNDWI where Sentinel-2 valid, otherwise Otsu-VH", "splits": {}},
    }
    for split in SPLITS:
        s1 = np.load(data_dir / f"{split}_s1.npy", mmap_mode="r")
        s2 = np.load(data_dir / f"{split}_s2.npy", mmap_mode="r")
        lab = np.load(data_dir / f"{split}_label.npy", mmap_mode="r")
        jrc = np.load(data_dir / f"{split}_jrc.npy", mmap_mode="r")
        for name in out:
            out[name]["splits"][split] = {}
        for cond, (kw, _) in CONDITIONS.items():
            confs = {n: (Confusion(), Confusion(), []) for n in out}
            for i in range(lab.shape[0]):
                rng = np.random.default_rng(7 * 100003 + i)
                vv, vh = s1[i, 0].astype(np.float32), s1[i, 1].astype(np.float32)
                raw2 = s2[i]
                valid2 = np.all(raw2 > 0, axis=0)
                if kw.get("fixed_cloud_coverage"):
                    valid2 &= ~augment.cloud_mask(valid2.shape, kw["fixed_cloud_coverage"], rng)
                if kw.get("remove_s2"):
                    valid2[:] = False
                if kw.get("remove_s1"):
                    vv[:] = np.nan
                    vh[:] = np.nan
                refl = raw2.astype(np.float32) / 1e4
                w_vv, _ = sar_water_otsu(vv, "VV")
                w_vh, _ = sar_water_otsu(vh, "VH")
                w_opt = optical_water_index(refl[1], refl[3], refl[4], valid2)
                preds = {"otsu_vv": w_vv, "otsu_vh": w_vh, "mndwi": w_opt,
                         "rule_fusion": np.where(valid2, w_opt, w_vh)}
                lb = lab[i].astype(np.int64)
                lf = lb.copy()
                lf[jrc[i] == 1] = -1
                for n, pr in preds.items():
                    c, cf, ious = confs[n]
                    c.update(pr, lb)
                    cf.update(pr, lf)
                    ious.append(_chip_iou(pr, lb))
            for n, (c, cf, ious) in confs.items():
                applicable = not ((n.startswith("otsu") and cond == "no_s1") or (n == "mndwi" and cond == "no_s2"))
                out[n]["splits"][split][cond] = _summ(c, cf, ious, None, None) if applicable else None
            print(f"[eval] classical {split} {cond}: " + ", ".join(f"{n} {confs[n][0].iou:.3f}" for n in out), flush=True)
    return out


def write_markdown(report: dict, path: Path) -> None:
    """Human-readable tables generated directly from the JSON results (no hand-copied numbers)."""

    def fmt(v):
        return "n/a" if v is None else f"{v:.3f}"

    lines = [
        "# Model evaluation (auto-generated)",
        "",
        f"Generated {report['generated_at']} by `python -m aegis.ml.evaluate`. Dataset: {report['dataset']}.",
        "",
    ]
    sel = report.get("selection") or {}
    if sel:
        lines += ["## Deployed configuration (selected on the validation split)", "",
                  f"Selected: **{sel['selected']}** - criterion: {sel['criterion']}. Test and Bolivia results below were not used for selection.", "",
                  "| Candidate | Validation score |", "|---|---|"] + [f"| {k} | {v:.4f} |" for k, v in sel["scores"].items()] + [""]
    hybrids = report.get("hybrids", {})
    names = list(report["models"]) + list(hybrids) + list(report["baselines"])
    for split in SPLITS:
        lines += [f"## Split: `{split}`", "", "| Method | Condition | IoU | F1 | Precision | Recall | Flood IoU (excl. permanent) | ECE (calibrated) |",
                  "|---|---|---|---|---|---|---|---|"]
        for n in names:
            entry = report["models"].get(n) or hybrids.get(n) or report["baselines"].get(n)
            for cond in CONDITIONS:
                m = entry["splits"][split].get(cond)
                if m is None:
                    lines.append(f"| {n} | {cond} | n/a | n/a | n/a | n/a | n/a | n/a |")
                    continue
                ece = m.get("calibration", {}).get("ece") if m.get("calibration") else None
                lines.append(f"| {n} | {cond} | {fmt(m['iou'])} | {fmt(m['f1'])} | {fmt(m['precision'])} | "
                             f"{fmt(m['recall'])} | {fmt(m['flood_iou_excl_permanent'])} | {fmt(ece)} |")
        lines.append("")
    fusion_name = sel.get("model_variant") or "gated_fusion_unet"
    gf = report["models"].get(fusion_name)
    if gf:
        m = gf["splits"]["test"]["as_is"]
        lines += [f"## Calibration of the fusion model `{fusion_name}` (test, as_is)", "",
                  "| | ECE | MCE | Brier | NLL |", "|---|---|---|---|---|",
                  f"| before temperature scaling | {fmt(m['calibration_uncalibrated']['ece'])} | {fmt(m['calibration_uncalibrated']['mce'])} | "
                  f"{fmt(m['calibration_uncalibrated']['brier'])} | {fmt(m['calibration_uncalibrated']['nll'])} |",
                  f"| after (T = {gf['temperature']:.3f}) | {fmt(m['calibration']['ece'])} | {fmt(m['calibration']['mce'])} | "
                  f"{fmt(m['calibration']['brier'])} | {fmt(m['calibration']['nll'])} |", ""]
        u = gf.get("uncertainty")
        if u:
            lines += ["## Uncertainty quality (MC dropout, test split)", "",
                      f"* error-detection AUROC (predictive entropy): {fmt(u['auroc_entropy_vs_error'])}",
                      f"* error-detection AUROC (MC std): {fmt(u['auroc_mc_std_vs_error'])}", "",
                      "| Coverage (most confident pixels kept) | Accuracy | IoU |", "|---|---|---|"]
            for r in u["risk_coverage"]:
                lines.append(f"| {r['coverage']:.0%} | {fmt(r['accuracy'])} | {fmt(r['iou'])} |")
            lines.append("")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")


def plot_figures(report: dict, fig_dir: Path) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig_dir.mkdir(parents=True, exist_ok=True)
    sel = report.get("selection") or {}
    gf = report["models"].get(sel.get("model_variant") or "gated_fusion_unet")
    if gf:
        m = gf["splits"]["test"]["as_is"]
        fig, ax = plt.subplots(figsize=(4.6, 4.2), dpi=150)
        for key, label, color in (("calibration_uncalibrated", "before scaling", "#E8853B"), ("calibration", "after scaling", "#1A7F8E")):
            bins = [b for b in m[key]["bins"] if b["count"]]
            ax.plot([b["confidence"] for b in bins], [b["frequency"] for b in bins], marker="o", ms=3.5, lw=1.6,
                    color=color, label=f"{label} (ECE {m[key]['ece']:.3f})")
        ax.plot([0, 1], [0, 1], ls="--", color="#9AA5B1", lw=1)
        ax.set_xlabel("Predicted probability of water")
        ax.set_ylabel("Observed frequency")
        ax.set_title("Reliability diagram - gated fusion (test)", fontsize=10)
        ax.legend(frameon=False, fontsize=8)
        ax.spines[["top", "right"]].set_visible(False)
        fig.tight_layout()
        fig.savefig(fig_dir / "reliability_gated_fusion.png")
        plt.close(fig)
    hybrids = report.get("hybrids", {})
    names = [n for n in ("otsu_vh", "mndwi", "s1_unet", "s2_unet", "early_fusion_unet", "gated_fusion_unet", "gated_fusion_unet_v2",
                         *hybrids) if n in report["models"] or n in report["baselines"] or n in hybrids]
    labels = [n.replace("hybrid_", "hybrid\n").replace("+s1_unet", "+S1") for n in names]
    conds = list(CONDITIONS)
    fig, ax = plt.subplots(figsize=(10, 3.8), dpi=150)
    width = 0.8 / len(conds)
    palette = ["#1A7F8E", "#5BA4C9", "#E8853B", "#B5546A"]
    for j, cond in enumerate(conds):
        vals = []
        for n in names:
            e = report["models"].get(n) or hybrids.get(n) or report["baselines"].get(n)
            m = e["splits"]["test"].get(cond)
            vals.append(m["iou"] if m else 0)
        ax.bar(np.arange(len(names)) + j * width, vals, width, label=cond, color=palette[j])
    ax.set_xticks(np.arange(len(names)) + width * (len(conds) - 1) / 2, labels, rotation=0, fontsize=6.5)
    ax.set_ylabel("Water IoU (test)")
    ax.set_ylim(0, 1)
    ax.legend(frameon=False, fontsize=8, ncol=4)
    ax.spines[["top", "right"]].set_visible(False)
    fig.tight_layout()
    fig.savefig(fig_dir / "iou_by_condition.png")
    plt.close(fig)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--data", type=Path, required=True)
    p.add_argument("--models", type=Path, required=True)
    p.add_argument("--docs", type=Path, default=Path(__file__).resolve().parents[3] / "docs")
    a = p.parse_args()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    t0 = time.time()
    report = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "dataset": "Sen1Floods11 v1.1 hand-labelled; test = 90 chips, bolivia = 15 chips (held-out event)",
        "conditions": {k: v[1] for k, v in CONDITIONS.items()},
        "models": {},
        "baselines": evaluate_classical(a.data),
    }
    for variant in MODEL_VARIANTS:
        ck = a.models / f"{variant}.pt"
        if ck.exists():
            report["models"][variant] = evaluate_model(ck, a.data, device)
    report["hybrids"] = {}
    sar = a.models / "s1_unet.pt"
    for fusion in ("gated_fusion_unet", "gated_fusion_unet_v2"):
        if sar.exists() and (a.models / f"{fusion}.pt").exists():
            report["hybrids"][f"hybrid_{fusion}+s1_unet"] = evaluate_hybrid(a.models / f"{fusion}.pt", sar, a.data, device)
    report["selection"] = select_deployment(report)
    if report["selection"]:
        (a.models / "selection.json").write_text(json.dumps(report["selection"], indent=2))
    report["seconds"] = round(time.time() - t0, 1)
    (a.models / "evaluation.json").write_text(json.dumps(report, indent=1))
    write_markdown(report, a.docs / "evaluation_results.md")
    plot_figures(report, a.docs / "figures")
    print(f"[eval] done in {report['seconds']}s -> {a.models / 'evaluation.json'}", flush=True)


if __name__ == "__main__":
    main()
