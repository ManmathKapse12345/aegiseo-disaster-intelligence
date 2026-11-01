"""Training-time augmentations (NumPy only, so they are unit-testable without PyTorch).

* geometric: random crop, flips, 90-degree rotations (applied identically to all layers)
* radiometric domain randomisation: S2 per-band gain/offset jitter and an S1 dB offset,
  which makes the model tolerant of Level-1C vs Level-2A and sigma0 vs gamma0 differences
  between the training data and the operational Planetary Computer inputs
* simulated cloud masks: smooth random blobs invalidating S2 pixels
* modality dropout: whole-sensor removal, teaching the fusion model to degrade gracefully
"""

from __future__ import annotations

import numpy as np
from scipy import ndimage


def random_crop(arrays: list[np.ndarray], size: int, rng: np.random.Generator) -> list[np.ndarray]:
    h, w = arrays[0].shape[-2:]
    if size >= h and size >= w:
        return arrays
    y = int(rng.integers(0, h - size + 1))
    x = int(rng.integers(0, w - size + 1))
    return [a[..., y : y + size, x : x + size] for a in arrays]


def center_crop(arrays: list[np.ndarray], size: int) -> list[np.ndarray]:
    h, w = arrays[0].shape[-2:]
    y, x = max(0, (h - size) // 2), max(0, (w - size) // 2)
    return [a[..., y : y + size, x : x + size] for a in arrays]


def flip_rotate(arrays: list[np.ndarray], rng: np.random.Generator) -> list[np.ndarray]:
    k = int(rng.integers(0, 4))
    flip = bool(rng.integers(0, 2))
    out = []
    for a in arrays:
        b = np.rot90(a, k, axes=(-2, -1))
        if flip:
            b = b[..., ::-1]
        out.append(np.ascontiguousarray(b))
    return out


def cloud_mask(shape: tuple[int, int], coverage: float, rng: np.random.Generator, scale: int = 24) -> np.ndarray:
    """Smooth random blob mask covering approximately ``coverage`` of the image."""
    coverage = float(np.clip(coverage, 0.0, 1.0))
    if coverage <= 0:
        return np.zeros(shape, dtype=bool)
    if coverage >= 1:
        return np.ones(shape, dtype=bool)
    h, w = shape
    gh, gw = max(2, h // scale), max(2, w // scale)
    noise = rng.standard_normal((gh, gw)).astype(np.float32)
    noise = ndimage.gaussian_filter(noise, sigma=1.0)
    field = ndimage.zoom(noise, (h / gh, w / gw), order=1)[:h, :w]
    thr = np.quantile(field, 1.0 - coverage)
    return field > thr


def radiometric_jitter(
    s1_db: np.ndarray, s2_refl: np.ndarray, rng: np.random.Generator, s1_offset_db: float = 1.5,
    s2_gain: float = 0.10, s2_offset: float = 0.02,
) -> tuple[np.ndarray, np.ndarray]:
    s1 = s1_db + rng.uniform(-s1_offset_db, s1_offset_db) + rng.uniform(-0.3, 0.3, size=(s1_db.shape[0], 1, 1))
    gains = rng.uniform(1 - s2_gain, 1 + s2_gain, size=(s2_refl.shape[0], 1, 1))
    offsets = rng.uniform(-s2_offset, s2_offset, size=(s2_refl.shape[0], 1, 1))
    s2 = s2_refl * gains + offsets
    return s1.astype(np.float32), np.clip(s2, 0, None).astype(np.float32)
