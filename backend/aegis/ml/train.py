"""Train a water-segmentation model on Sen1Floods11 (hand-labelled split).

Example::

    python -m aegis.ml.train --variant gated_fusion_unet --data ../data/datasets/sen1floods11_prepared \
        --out ../models --epochs 60

The best checkpoint (by validation IoU) is saved together with the feature statistics,
training configuration, history and a temperature fitted on the validation split
(post-hoc calibration, Guo et al. 2017).
"""

from __future__ import annotations

import argparse
import json
import math
import random
import time
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from torch.utils.data import DataLoader

from aegis.ml.data import Sen1Floods11
from aegis.ml.features import FeatureStats
from aegis.ml.metrics import Confusion
from aegis.ml.models import MODEL_VARIANTS, build_model, count_parameters, forward_variant


@dataclass
class TrainConfig:
    variant: str
    epochs: int = 40
    # Small batches/crops keep peak GPU memory below ~0.8 GB so training also works on
    # 4 GB laptop GPUs that share VRAM with the desktop (measured: ~2.2 Mpx/s on a T1000).
    batch_size: int = 4
    crop: int = 192
    samples_per_chip: int = 4
    lr: float = 2e-3
    weight_decay: float = 1e-4
    dropout: float = 0.2
    seed: int = 42
    cloud_sim_p: float = 0.5
    cloud_max_coverage: float = 0.9
    drop_s1_p: float = 0.15
    drop_s2_p: float = 0.15
    # fp16 autocast is slower than fp32 on GPUs without tensor cores (e.g. TU117/T1000)
    amp: bool = False
    workers: int = 4
    val_every: int = 2


def default_config(variant: str, **overrides) -> TrainConfig:
    cfg = TrainConfig(variant=variant)
    if variant in ("s1_unet", "s2_unet"):
        # single-sensor baselines: sensor-removal augmentations are not meaningful
        cfg.cloud_sim_p, cfg.drop_s1_p, cfg.drop_s2_p = 0.0, 0.0, 0.0
    if variant == "gated_fusion_unet_v2":
        # v1 evaluation showed the SAR pathway collapses without optical input; train it explicitly
        cfg.drop_s2_p, cfg.drop_s1_p, cfg.cloud_sim_p, cfg.cloud_max_coverage = 0.30, 0.10, 0.6, 1.0
    for k, v in overrides.items():
        if v is not None:
            setattr(cfg, k, v)
    return cfg


def seed_everything(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)


def masked_bce_dice(logits: torch.Tensor, target: torch.Tensor) -> torch.Tensor:
    logits = logits.float().squeeze(1)
    valid = (target >= 0).float()
    t = target.clamp(min=0).float()
    bce = F.binary_cross_entropy_with_logits(logits, t, reduction="none")
    bce = (bce * valid).sum() / valid.sum().clamp(min=1.0)
    p = torch.sigmoid(logits) * valid
    inter = (p * t).sum()
    dice = 1.0 - (2.0 * inter + 1.0) / (p.sum() + (t * valid).sum() + 1.0)
    return bce + dice


@torch.no_grad()
def collect_logits(model, variant, loader, device, max_pixels: int = 3_000_000, seed: int = 0):
    """Validation pass: confusion at p=0.5 plus a pixel sample of (logit, label) for calibration."""
    model.eval()
    conf = Confusion()
    rng = np.random.default_rng(seed)
    logit_s, label_s = [], []
    per_batch = max(1, max_pixels // max(1, len(loader)))
    for s1, s2, label, _ in loader:
        s1, s2 = s1.to(device), s2.to(device)
        logits, _ = forward_variant(model, variant, s1, s2)
        lg = logits.float().squeeze(1).cpu().numpy()
        lb = label.numpy()
        conf.update(lg > 0, lb)
        valid = lb >= 0
        lv, yv = lg[valid], lb[valid]
        if lv.size > per_batch:
            idx = rng.choice(lv.size, per_batch, replace=False)
            lv, yv = lv[idx], yv[idx]
        logit_s.append(lv)
        label_s.append(yv)
    return conf, np.concatenate(logit_s), np.concatenate(label_s)


def calibration_nll(logits: np.ndarray, labels: np.ndarray, temperature: float) -> float:
    """Numerically stable mean binary cross-entropy of ``sigmoid(logits / T)``."""
    s = logits.astype(np.float64) / temperature
    y = labels.astype(np.float64)
    return float(np.mean(np.maximum(s, 0) - s * y + np.log1p(np.exp(-np.abs(s)))))


def fit_temperature(logits: np.ndarray, labels: np.ndarray, t_min: float = 0.05, t_max: float = 20.0) -> float:
    """Temperature scaling (Guo et al., 2017) by bounded golden-section search on log T.

    The NLL is convex in 1/T, hence unimodal in log T, so a bracketing search is
    guaranteed to converge without the step-size failures of gradient line searches.
    """
    if logits.size == 0:
        return 1.0
    a, b = np.log(t_min), np.log(t_max)
    inv_phi = (np.sqrt(5.0) - 1.0) / 2.0
    c, d = b - inv_phi * (b - a), a + inv_phi * (b - a)
    fc, fd = calibration_nll(logits, labels, np.exp(c)), calibration_nll(logits, labels, np.exp(d))
    for _ in range(60):
        if fc < fd:
            b, d, fd = d, c, fc
            c = b - inv_phi * (b - a)
            fc = calibration_nll(logits, labels, np.exp(c))
        else:
            a, c, fc = c, d, fd
            d = a + inv_phi * (b - a)
            fd = calibration_nll(logits, labels, np.exp(d))
    return float(np.exp((a + b) / 2.0))


def train(cfg: TrainConfig, data_dir: Path, out_dir: Path, device_name: str = "auto") -> dict:
    if cfg.variant not in MODEL_VARIANTS:
        raise ValueError(f"unknown variant {cfg.variant}")
    seed_everything(cfg.seed)
    torch.backends.cudnn.benchmark = True
    device = torch.device("cuda" if (device_name == "auto" and torch.cuda.is_available()) else
                          (device_name if device_name != "auto" else "cpu"))
    stats = FeatureStats.from_json(data_dir / "feature_stats.json")
    train_ds = Sen1Floods11(
        data_dir, "train", stats, crop=cfg.crop, augment_data=True, samples_per_chip=cfg.samples_per_chip,
        cloud_sim_p=cfg.cloud_sim_p, cloud_coverage=(0.1, cfg.cloud_max_coverage), drop_s1_p=cfg.drop_s1_p, drop_s2_p=cfg.drop_s2_p,
    )
    val_ds = Sen1Floods11(data_dir, "valid", stats)
    g = torch.Generator()
    g.manual_seed(cfg.seed)
    train_dl = DataLoader(train_ds, batch_size=cfg.batch_size, shuffle=True, num_workers=cfg.workers, drop_last=True,
                          persistent_workers=cfg.workers > 0, generator=g, pin_memory=device.type == "cuda")
    # In-process validation: on Windows, re-spawning loader workers each pass costs more than the reads.
    val_dl = DataLoader(val_ds, batch_size=4, shuffle=False, num_workers=0)

    model = build_model(cfg.variant, cfg.dropout).to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=cfg.lr, weight_decay=cfg.weight_decay)
    steps = cfg.epochs * len(train_dl)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=cfg.lr, total_steps=steps, pct_start=0.08)
    use_amp = cfg.amp and device.type == "cuda"
    scaler = torch.amp.GradScaler("cuda", enabled=use_amp)

    history, best_iou, best_state, best_epoch = [], -1.0, None, -1
    t0 = time.time()
    print(f"[train] {cfg.variant}: {count_parameters(model):,} params on {device}, {len(train_ds)} samples/epoch", flush=True)
    for epoch in range(1, cfg.epochs + 1):
        model.train()
        losses = []
        t_epoch, t_wait = time.perf_counter(), 0.0
        batches = iter(train_dl)
        while True:
            t_fetch = time.perf_counter()
            try:
                s1, s2, label, _ = next(batches)
            except StopIteration:
                break
            t_wait += time.perf_counter() - t_fetch
            s1, s2, label = s1.to(device, non_blocking=True), s2.to(device, non_blocking=True), label.to(device)
            opt.zero_grad(set_to_none=True)
            with torch.autocast(device_type=device.type, dtype=torch.float16, enabled=use_amp):
                logits, _ = forward_variant(model, cfg.variant, s1, s2)
            loss = masked_bce_dice(logits, label)
            if not torch.isfinite(loss):
                print("[train] non-finite loss encountered; skipping batch", flush=True)
                continue
            scaler.scale(loss).backward()
            scaler.unscale_(opt)
            torch.nn.utils.clip_grad_norm_(model.parameters(), 5.0)
            scaler.step(opt)
            scaler.update()
            sched.step()
            losses.append(float(loss.item()))
        rec = {
            "epoch": epoch,
            "loss": float(np.mean(losses)) if losses else math.nan,
            "lr": sched.get_last_lr()[0],
            "epoch_seconds": round(time.perf_counter() - t_epoch, 1),
            "data_wait_seconds": round(t_wait, 1),
        }
        if epoch % cfg.val_every == 0 or epoch == cfg.epochs:
            conf, _, _ = collect_logits(model, cfg.variant, val_dl, device, max_pixels=10)
            rec.update(val_iou=conf.iou, val_f1=conf.f1)
            if conf.iou > best_iou:
                best_iou, best_epoch = conf.iou, epoch
                best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
        history.append(rec)
        print(f"[train] {cfg.variant} ep {epoch:3d} loss {rec['loss']:.4f} "
              + (f"val_iou {rec['val_iou']:.4f} " if "val_iou" in rec else "")
              + f"epoch {rec['epoch_seconds']}s (data wait {rec['data_wait_seconds']}s) total {time.time() - t0:.0f}s",
              flush=True)

    assert best_state is not None
    model.load_state_dict(best_state)
    conf, logits, labels = collect_logits(model, cfg.variant, val_dl, device)
    temperature = fit_temperature(logits, labels)
    out_dir.mkdir(parents=True, exist_ok=True)
    ckpt = {
        "variant": cfg.variant,
        "description": MODEL_VARIANTS[cfg.variant]["description"],
        "state_dict": best_state,
        "config": asdict(cfg),
        "stats": asdict(stats),
        "temperature": temperature,
        "best_epoch": best_epoch,
        "val_metrics": conf.as_dict(),
        "history": history,
        "parameters": count_parameters(model),
        "train_seconds": time.time() - t0,
        "trained_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "dataset": "Sen1Floods11 v1.1 hand-labelled (train=252 / valid=89 chips)",
        # plain str: TorchVersion objects are rejected by safe (weights_only) loading
        "torch_version": str(torch.__version__),
    }
    torch.save(ckpt, out_dir / f"{cfg.variant}.pt")
    summary = {k: v for k, v in ckpt.items() if k != "state_dict"}
    (out_dir / f"{cfg.variant}.json").write_text(json.dumps(summary, indent=2, default=str))
    print(f"[train] {cfg.variant} done: best val IoU {best_iou:.4f} @ epoch {best_epoch}, T={temperature:.3f}", flush=True)
    return summary


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--variant", required=True, choices=sorted(MODEL_VARIANTS))
    p.add_argument("--data", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--epochs", type=int)
    p.add_argument("--batch-size", type=int)
    p.add_argument("--workers", type=int)
    p.add_argument("--seed", type=int)
    p.add_argument("--device", default="auto")
    p.add_argument("--amp", action="store_true", help="mixed precision (useful on GPUs with tensor cores)")
    a = p.parse_args()
    cfg = default_config(a.variant, epochs=a.epochs, batch_size=a.batch_size, workers=a.workers, seed=a.seed,
                         amp=True if a.amp else None)
    train(cfg, a.data, a.out, a.device)


if __name__ == "__main__":
    main()
