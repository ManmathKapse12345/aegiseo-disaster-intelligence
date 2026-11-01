"""Runtime water segmentation with calibrated probabilities and uncertainty.

* tiled inference with overlapping, smoothly blended windows (arbitrary scene sizes)
* temperature-scaled (calibrated) probabilities
* Monte-Carlo dropout over the final feature layer -> epistemic standard deviation, plus
  predictive entropy of the mean probability (total uncertainty)
* sensor-reliance map from the gated-fusion model (fraction of the decision driven by SAR)
* graceful degradation: if PyTorch or the checkpoint is unavailable the segmenter falls back
  to the classical Otsu-SAR / MNDWI rule set and flags the result accordingly
"""

from __future__ import annotations

import hashlib
import logging
import threading
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

from aegis.ml.baselines import otsu_threshold
from aegis.ml.features import S1_CHANNELS, S2_CHANNELS, FeatureStats
from aegis.ml.metrics import binary_entropy

log = logging.getLogger(__name__)


@dataclass
class SegmentationResult:
    prob: np.ndarray                    # calibrated P(water), NaN where no sensor had valid data
    epistemic_std: np.ndarray           # MC-dropout std of P(water)
    entropy: np.ndarray                 # predictive entropy (bits) of the mean probability
    sar_reliance: np.ndarray | None     # 0..1 share of the decision driven by SAR (gated model)
    method: str
    model_info: dict[str, Any] = field(default_factory=dict)


def _tile_positions(n: int, tile: int, stride: int) -> list[int]:
    """Window offsets covering [0, n) with the last window aligned to the end."""
    if n <= tile:
        return [0]
    pos = list(range(0, n - tile, stride))
    pos.append(n - tile)
    return sorted(set(pos))


def _blend_window(size: int, overlap: int) -> np.ndarray:
    ramp = np.ones(size, dtype=np.float32)
    if overlap > 0:
        r = np.linspace(0.05, 1.0, overlap, dtype=np.float32)
        ramp[:overlap] = r
        ramp[-overlap:] = r[::-1]
    return np.outer(ramp, ramp)


class WaterSegmenter:
    def __init__(self, models_dir: Path, variant: str = "gated_fusion_unet", device: str = "auto", mc_samples: int = 6):
        self.models_dir = Path(models_dir)
        self.variant = variant
        self.device_pref = device
        self.mc_samples = mc_samples
        self.checkpoint_path = self.models_dir / f"{variant}.pt"
        self._model = None
        self._torch = None
        self._device = None
        self._info: dict[str, Any] = {}
        self.stats = FeatureStats()
        self.temperature = 1.0
        self.load_error: str | None = None
        self._lock = threading.Lock()
        self._loaded = False

    # ------------------------------------------------------------------ loading
    def load(self) -> bool:
        with self._lock:
            if self._loaded:
                return self._model is not None
            self._loaded = True
            if not self.checkpoint_path.exists():
                self.load_error = f"checkpoint not found: {self.checkpoint_path.name} (run model training, see README)"
                log.warning("segmenter fallback", extra={"reason": self.load_error})
                return False
            try:
                import torch

                from aegis.ml.models import build_model

                ckpt = torch.load(self.checkpoint_path, map_location="cpu", weights_only=True)
                model = build_model(ckpt["variant"], ckpt["config"].get("dropout", 0.2))
                model.load_state_dict(ckpt["state_dict"])
                if self.device_pref == "cuda" or (self.device_pref == "auto" and torch.cuda.is_available()):
                    device = torch.device("cuda")
                else:
                    device = torch.device("cpu")
                model.to(device).eval()
                self._torch, self._model, self._device = torch, model, device
                self.stats = FeatureStats.from_dict(ckpt["stats"])
                self.temperature = float(ckpt.get("temperature", 1.0))
                sha = hashlib.sha256(self.checkpoint_path.read_bytes()).hexdigest()[:12]
                self._info = {
                    "variant": ckpt["variant"],
                    "description": ckpt.get("description"),
                    "trained_at": ckpt.get("trained_at"),
                    "best_epoch": ckpt.get("best_epoch"),
                    "val_iou": ckpt.get("val_metrics", {}).get("iou"),
                    "temperature": self.temperature,
                    "parameters": ckpt.get("parameters"),
                    "checkpoint_sha256": sha,
                    "version": f"{ckpt['variant']}@{sha}",
                    "device": str(device),
                }
                return True
            except Exception as exc:  # torch missing, corrupt checkpoint, version mismatch...
                self.load_error = f"failed to load model: {type(exc).__name__}: {exc}"
                log.exception("segmenter load failed")
                self._model = None
                return False

    @property
    def available(self) -> bool:
        return self.load()

    def info(self) -> dict[str, Any]:
        self.load()
        if self._model is None:
            return {"variant": "classical_fallback", "version": "otsu-mndwi-rules@1", "load_error": self.load_error}
        return dict(self._info)

    # ------------------------------------------------------------------ prediction
    def predict(
        self,
        s1f: np.ndarray | None,
        s2f: np.ndarray | None,
        *,
        mc_samples: int | None = None,
        tile: int = 512,
        overlap: int = 64,
        cancel_check: Callable[[], None] | None = None,
        raw_s1_db: tuple[np.ndarray, np.ndarray] | None = None,
        raw_s2_indices: np.ndarray | None = None,
    ) -> SegmentationResult:
        if s1f is None and s2f is None:
            raise ValueError("at least one sensor is required")
        shape = (s1f if s1f is not None else s2f).shape[-2:]  # type: ignore[union-attr]
        s1f = s1f if s1f is not None else np.zeros((S1_CHANNELS, *shape), np.float32)
        s2f = s2f if s2f is not None else np.zeros((S2_CHANNELS, *shape), np.float32)
        valid_any = (s1f[-1] > 0.5) | (s2f[-1] > 0.5)
        if self.load():
            res = self._predict_model(s1f, s2f, mc_samples or self.mc_samples, tile, overlap, cancel_check)
        else:
            res = self._predict_classical(s1f, s2f, raw_s1_db, raw_s2_indices)
        for arr in (res.prob, res.epistemic_std, res.entropy):
            arr[~valid_any] = np.nan
        if res.sar_reliance is not None:
            res.sar_reliance[~valid_any] = np.nan
        return res

    def _predict_model(self, s1f, s2f, mc, tile, overlap, cancel_check) -> SegmentationResult:
        from aegis.ml.models import trunk_features

        torch = self._torch
        model, device = self._model, self._device
        H, W = s1f.shape[-2:]
        # tile edge must be a multiple of 8 (three 2x poolings); small scenes use one padded tile
        tile = int(min(tile, max(64, int(np.ceil(max(H, W) / 8) * 8))))
        stride = max(8, tile - overlap)
        ph, pw = max(H, tile), max(W, tile)
        pad = ((0, 0), (0, ph - H), (0, pw - W))  # zero padding = "no valid data" for both sensors
        x1, x2 = np.pad(s1f, pad), np.pad(s2f, pad)
        ys, xs = _tile_positions(ph, tile, stride), _tile_positions(pw, tile, stride)
        win = _blend_window(tile, overlap if (len(ys) > 1 or len(xs) > 1) else 0)
        acc_p = np.zeros((ph, pw), np.float64)
        acc_p2 = np.zeros((ph, pw), np.float64)
        acc_g = np.zeros((ph, pw), np.float64)
        acc_w = np.zeros((ph, pw), np.float64)
        variant = self._info.get("variant", self.variant)
        is_gated = variant.startswith("gated_fusion_unet")
        mc = max(1, int(mc))
        head, p_drop = model.decoder.head, model.decoder.dropout.p
        with torch.inference_mode():
            for ti, (y, x) in enumerate((y, x) for y in ys for x in xs):
                if cancel_check:
                    cancel_check()
                t1 = torch.from_numpy(np.ascontiguousarray(x1[:, y : y + tile, x : x + tile]))[None].to(device)
                t2 = torch.from_numpy(np.ascontiguousarray(x2[:, y : y + tile, x : x + tile]))[None].to(device)
                feats, gate = trunk_features(model, variant, t1, t2)
                if mc == 1:  # deterministic pass: dropout disabled (its expectation)
                    pst = torch.sigmoid(head(feats).float() / self.temperature)[0]
                else:
                    # MC dropout over the final feature layer. Channel masks (Dropout2d semantics) are drawn
                    # from a per-tile seeded generator: reproducible results and no shared global RNG state.
                    gen = torch.Generator(device=feats.device)
                    gen.manual_seed(1_000_003 + ti)
                    keep = (torch.rand((mc, feats.shape[1], 1, 1), generator=gen, device=feats.device) >= p_drop).float()
                    pst = torch.sigmoid(head(feats * keep / (1.0 - p_drop)).float() / self.temperature)[:, 0]
                pm = pst.mean(0).cpu().numpy()
                p2 = (pst**2).mean(0).cpu().numpy()
                acc_p[y : y + tile, x : x + tile] += pm * win
                acc_p2[y : y + tile, x : x + tile] += p2 * win
                if gate is not None and is_gated:
                    acc_g[y : y + tile, x : x + tile] += gate[0, 0].float().cpu().numpy() * win
                acc_w[y : y + tile, x : x + tile] += win
        acc_w = np.maximum(acc_w, 1e-9)
        prob = (acc_p / acc_w)[:H, :W].astype(np.float32)
        var = np.maximum((acc_p2 / acc_w)[:H, :W] - prob.astype(np.float64) ** 2, 0)
        std = np.sqrt(var).astype(np.float32)
        gate_map = (acc_g / acc_w)[:H, :W].astype(np.float32) if is_gated else None
        return SegmentationResult(
            prob=prob,
            epistemic_std=std,
            entropy=binary_entropy(prob),
            sar_reliance=gate_map,
            method="deep_fusion_model",
            model_info={**self._info, "mc_samples": mc},
        )

    def _predict_classical(self, s1f, s2f, raw_s1_db, raw_s2_indices) -> SegmentationResult:
        """Rule-based fallback: logistic soft-thresholds around Otsu (SAR) and MNDWI = 0 (optical)."""
        shape = s1f.shape[-2:]
        v1, v2 = s1f[-1] > 0.5, s2f[-1] > 0.5
        p_sar = np.full(shape, np.nan, np.float32)
        p_opt = np.full(shape, np.nan, np.float32)
        if v1.any():
            vv = s1f[0] * self.stats.s1_std[0] + self.stats.s1_mean[0] if raw_s1_db is None else raw_s1_db[0]
            vals = vv[v1]
            t = float(np.clip(otsu_threshold(vals), -23.0, -15.0)) if vals.size > 100 else -18.0
            p_sar[v1] = 1.0 / (1.0 + np.exp((vv[v1] - t) / 1.2))
        if v2.any():
            mndwi = s2f[7] if raw_s2_indices is None else raw_s2_indices
            p_opt[v2] = 1.0 / (1.0 + np.exp(-(mndwi[v2] - 0.0) / 0.08))
        both = v1 & v2
        prob = np.where(both, 0.5 * (np.nan_to_num(p_sar) + np.nan_to_num(p_opt)), np.where(v1, p_sar, p_opt))
        prob = np.nan_to_num(prob, nan=0.0).astype(np.float32)
        disagreement = np.where(both, np.abs(np.nan_to_num(p_sar) - np.nan_to_num(p_opt)), 0.25).astype(np.float32)
        reliance = np.where(both, 0.5, np.where(v1, 1.0, 0.0)).astype(np.float32)
        return SegmentationResult(
            prob=prob,
            epistemic_std=disagreement * 0.5,
            entropy=binary_entropy(prob),
            sar_reliance=reliance,
            method="classical_fallback",
            model_info={"variant": "classical_fallback", "version": "otsu-mndwi-rules@1", "load_error": self.load_error},
        )


def sar_only_weight(s1_valid: np.ndarray, s2_valid: np.ndarray, blend_px: float = 4.0) -> np.ndarray:
    """Per-pixel weight of the SAR specialist: 1 where only SAR observed the surface, smoothly
    decaying across cloud edges so the two models blend without seams."""
    from scipy import ndimage

    w = ndimage.gaussian_filter((~s2_valid).astype(np.float32), sigma=blend_px) if blend_px > 0 else (~s2_valid).astype(np.float32)
    w = np.where(~s2_valid, 1.0, w)
    return np.where(s1_valid, np.clip(w, 0.0, 1.0), 0.0).astype(np.float32)


class HybridSegmenter:
    """Gated-fusion model everywhere optical data are valid; a dedicated Sentinel-1 specialist
    where only SAR observed the ground (clouds, optical no-data).

    Motivation: evaluation showed the fusion model's SAR pathway is weaker than a SAR-only
    network when optical input is entirely missing; the hybrid uses each model where it is
    strongest (selection of this configuration is made on the validation split).
    """

    def __init__(self, primary: WaterSegmenter, sar: WaterSegmenter | None):
        self.primary = primary
        self.sar = sar

    def load(self) -> bool:
        ok = self.primary.load()
        if self.sar is not None:
            self.sar.load()
        return ok

    @property
    def available(self) -> bool:
        return self.load()

    @property
    def stats(self) -> FeatureStats:
        return self.primary.stats

    @property
    def load_error(self) -> str | None:
        return self.primary.load_error

    def info(self) -> dict[str, Any]:
        info = self.primary.info()
        if self.sar is not None and self.sar.available:
            s = self.sar.info()
            info = {**info, "sar_specialist": {k: s.get(k) for k in ("variant", "version", "temperature", "val_iou")},
                    "version": f"{info.get('version')}+{s.get('version')}"}
        return info

    def predict(self, s1f: np.ndarray | None, s2f: np.ndarray | None, **kw: Any) -> SegmentationResult:
        res = self.primary.predict(s1f, s2f, **kw)
        if self.sar is None or s1f is None or not self.sar.available or res.method != "deep_fusion_model":
            return res
        v1 = s1f[-1] > 0.5
        v2 = (s2f[-1] > 0.5) if s2f is not None else np.zeros_like(v1)
        if not (v1 & ~v2).any():
            res.model_info = {**self.info(), **res.model_info, "sar_specialist_fraction": 0.0}
            return res
        sres = self.sar.predict(s1f, None, **{k: v for k, v in kw.items() if k in ("mc_samples", "cancel_check")})
        w = sar_only_weight(v1, v2)
        both = np.isfinite(res.prob) & np.isfinite(sres.prob)
        for attr in ("prob", "epistemic_std"):
            a, b = getattr(res, attr), getattr(sres, attr)
            setattr(res, attr, np.where(both, (1 - w) * a + w * b, a).astype(np.float32))
        res.entropy = binary_entropy(np.nan_to_num(res.prob, nan=0.5))
        res.entropy[~np.isfinite(res.prob)] = np.nan
        if res.sar_reliance is not None:
            res.sar_reliance = np.where(both, np.maximum(res.sar_reliance, w), res.sar_reliance).astype(np.float32)
        res.method = "deep_fusion_model"
        res.model_info = {**self.info(), "mc_samples": res.model_info.get("mc_samples"),
                          "sar_specialist_fraction": round(float((w > 0.5).mean()), 4)}
        return res


_SEGMENTERS: dict[tuple[str, ...], Any] = {}
_SEG_LOCK = threading.Lock()


def get_segmenter(models_dir: Path, variant: str = "gated_fusion_unet", device: str = "auto", mc_samples: int = 6,
                  sar_specialist: str | None = None) -> WaterSegmenter | HybridSegmenter:
    key = (str(models_dir), variant, sar_specialist or "")
    with _SEG_LOCK:
        if key not in _SEGMENTERS:
            primary = WaterSegmenter(models_dir, variant, device, mc_samples)
            if sar_specialist:
                _SEGMENTERS[key] = HybridSegmenter(primary, WaterSegmenter(models_dir, sar_specialist, device, mc_samples))
            else:
                _SEGMENTERS[key] = primary
        return _SEGMENTERS[key]
