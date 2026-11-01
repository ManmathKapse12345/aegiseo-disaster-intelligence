"""Terrain derivatives used as physical plausibility constraints."""

from __future__ import annotations

import numpy as np
from scipy import ndimage


def slope_degrees(dem: np.ndarray, resolution_m: float) -> np.ndarray:
    d = np.where(np.isfinite(dem), dem, np.nanmedian(dem) if np.isfinite(dem).any() else 0.0)
    gy, gx = np.gradient(d.astype(np.float64), resolution_m)
    s = np.degrees(np.arctan(np.hypot(gx, gy))).astype(np.float32)
    s[~np.isfinite(dem)] = np.nan
    return s


def height_above_local_drainage(dem: np.ndarray, resolution_m: float, window_m: float = 2000.0) -> np.ndarray:
    """Approximate HAND: elevation minus the minimum elevation within a moving window.

    A full HAND model (Nobre et al., 2011) requires a hydrologically conditioned drainage
    network; this local-minimum proxy captures the key property that floodwater collects
    in the lowest terrain nearby, and is used only to flag implausible detections.
    """
    d = np.where(np.isfinite(dem), dem, np.nanmax(dem) if np.isfinite(dem).any() else 0.0)
    size = max(3, int(round(window_m / resolution_m)) | 1)
    # minimum filter on a downsampled DEM keeps this fast for large windows
    step = max(1, size // 25)
    if step > 1:
        small = d[::step, ::step]
        mn = ndimage.minimum_filter(small, size=max(3, size // step))
        mn = np.repeat(np.repeat(mn, step, axis=0), step, axis=1)[: d.shape[0], : d.shape[1]]
    else:
        mn = ndimage.minimum_filter(d, size=size)
    out = (d - mn).astype(np.float32)
    out[~np.isfinite(dem)] = np.nan
    return out
