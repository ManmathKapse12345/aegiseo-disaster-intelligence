"""SAR processing helpers."""

from __future__ import annotations

import numpy as np
from scipy import ndimage


def lee_filter_db(db: np.ndarray, size: int = 5, looks: float = 4.4) -> np.ndarray:
    """Lee (1980) adaptive speckle filter applied in the *linear* intensity domain.

    Filtering in dB would bias the mean; the multiplicative speckle model holds for
    linear intensity. NaNs are preserved and excluded from local statistics.
    """
    valid = np.isfinite(db)
    if not valid.any():
        return db.copy()
    lin = np.where(valid, 10 ** (np.nan_to_num(db) / 10.0), 0.0).astype(np.float64)
    w = valid.astype(np.float64)
    norm = ndimage.uniform_filter(w, size)
    norm = np.maximum(norm, 1e-9)
    mean = ndimage.uniform_filter(lin, size) / norm
    sq = ndimage.uniform_filter(lin * lin, size) / norm
    var = np.maximum(sq - mean * mean, 0.0)
    noise_var_rel = 1.0 / looks  # coefficient of variation squared of fully developed speckle
    signal_var = np.maximum(var - mean * mean * noise_var_rel, 0.0)
    k = np.where(var > 0, signal_var / np.maximum(var, 1e-12), 0.0)
    out = mean + k * (lin - mean)
    with np.errstate(divide="ignore", invalid="ignore"):
        res = 10 * np.log10(np.maximum(out, 1e-6))
    res[~valid] = np.nan
    return res.astype(np.float32)


def log_ratio_db(post_db: np.ndarray, pre_db: np.ndarray) -> np.ndarray:
    """Change in backscatter, 10*log10(post/pre) = post_dB - pre_dB."""
    out = post_db - pre_db
    out[~(np.isfinite(post_db) & np.isfinite(pre_db))] = np.nan
    return out.astype(np.float32)
