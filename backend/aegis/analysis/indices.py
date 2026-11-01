"""Spectral indices from Sentinel-2 reflectance (bands in 0-1 surface reflectance).

NDVI  = (NIR - Red) / (NIR + Red)           vegetation vigour (Rouse et al., 1974)
NDWI  = (Green - NIR) / (Green + NIR)       open water (McFeeters, 1996)
MNDWI = (Green - SWIR1) / (Green + SWIR1)   open water, robust to built-up (Xu, 2006)
NBR   = (NIR - SWIR2) / (NIR + SWIR2)       burn severity (Key & Benson, 2006)
"""

from __future__ import annotations

import numpy as np

from aegis.ml.features import safe_ratio


def _nan_ratio(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    out = safe_ratio(np.nan_to_num(a), np.nan_to_num(b))
    out[~(np.isfinite(a) & np.isfinite(b))] = np.nan
    return out


def ndvi(b: dict[str, np.ndarray]) -> np.ndarray:
    return _nan_ratio(b["B08"], b["B04"])


def ndwi(b: dict[str, np.ndarray]) -> np.ndarray:
    return _nan_ratio(b["B03"], b["B08"])


def mndwi(b: dict[str, np.ndarray]) -> np.ndarray:
    return _nan_ratio(b["B03"], b["B11"])


def nbr(b: dict[str, np.ndarray]) -> np.ndarray:
    return _nan_ratio(b["B08"], b["B12"])


# USGS FIREMON burn-severity classes for dNBR (Key & Benson, 2006)
DNBR_CLASSES: list[tuple[float, float, str, int]] = [
    (-np.inf, 0.10, "Unburned", 0),
    (0.10, 0.27, "Low", 1),
    (0.27, 0.44, "Moderate-low", 2),
    (0.44, 0.66, "Moderate-high", 3),
    (0.66, np.inf, "High", 4),
]


def classify_dnbr(dnbr: np.ndarray) -> np.ndarray:
    out = np.zeros(dnbr.shape, dtype=np.int8)
    for lo, hi, _, code in DNBR_CLASSES:
        out[(dnbr >= lo) & (dnbr < hi)] = code
    out[~np.isfinite(dnbr)] = -1
    return out
