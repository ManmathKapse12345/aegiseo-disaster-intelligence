"""Classical (non-learned) water-mapping baselines.

* SAR: Otsu (1979) histogram thresholding of VV/VH backscatter, the standard
  operational approach for SAR flood mapping, with a physical plausibility clamp so
  that scenes with little water do not yield a land/land split.
* Optical: MNDWI > 0 (Xu, 2006) and NDWI > 0 (McFeeters, 1996).
"""

from __future__ import annotations

import numpy as np

from aegis.ml.features import safe_ratio

# Physically plausible water thresholds (dB). Open water is a specular reflector and
# typically appears below about -18 dB in VV and -24 dB in VH.
VV_THRESHOLD_BOUNDS = (-23.0, -15.0)
VH_THRESHOLD_BOUNDS = (-30.0, -20.0)


def otsu_threshold(values: np.ndarray, nbins: int = 256) -> float:
    """Otsu's threshold maximising between-class variance of a 1-D sample."""
    v = values[np.isfinite(values)]
    if v.size < 2:
        raise ValueError("Otsu threshold needs at least two finite values")
    lo, hi = float(v.min()), float(v.max())
    if hi - lo < 1e-9:
        return lo
    hist, edges = np.histogram(v, bins=nbins, range=(lo, hi))
    hist = hist.astype(np.float64)
    centers = (edges[:-1] + edges[1:]) / 2
    w0 = np.cumsum(hist)
    w1 = w0[-1] - w0
    m0 = np.cumsum(hist * centers) / np.maximum(w0, 1e-12)
    m1 = (np.sum(hist * centers) - np.cumsum(hist * centers)) / np.maximum(w1, 1e-12)
    between = w0 * w1 * (m0 - m1) ** 2
    between[(w0 == 0) | (w1 == 0)] = 0
    # Well-separated classes give a flat maximum (empty bins between the modes); argmax would
    # return its first bin, i.e. the edge of the lower class. Use the centre of the plateau.
    best = np.flatnonzero(between >= between.max() * (1 - 1e-9))
    return float((centers[best[0]] + centers[best[-1]]) / 2)


def sar_water_otsu(db: np.ndarray, polarization: str = "VV") -> tuple[np.ndarray, float]:
    """Return (water mask, threshold). NaN pixels are never water."""
    bounds = VV_THRESHOLD_BOUNDS if polarization.upper() == "VV" else VH_THRESHOLD_BOUNDS
    finite = np.isfinite(db)
    if finite.sum() < 100:
        return np.zeros(db.shape, dtype=bool), float("nan")
    # subsample for speed on large scenes
    sample = db[finite]
    if sample.size > 2_000_000:
        sample = np.random.default_rng(0).choice(sample, 2_000_000, replace=False)
    t = float(np.clip(otsu_threshold(sample), *bounds))
    return finite & (db < t), t


def optical_water_index(green: np.ndarray, nir: np.ndarray, swir1: np.ndarray, valid: np.ndarray) -> np.ndarray:
    """MNDWI > 0 water mask restricted to valid (cloud-free) pixels."""
    mndwi = safe_ratio(green, swir1)
    return valid & (mndwi > 0.0)


def ndwi_water(green: np.ndarray, nir: np.ndarray, valid: np.ndarray) -> np.ndarray:
    return valid & (safe_ratio(green, nir) > 0.0)
