"""Model input construction shared by training and inference.

Keeping this in one module guarantees the deployed model sees inputs prepared exactly
like its training data.

Sentinel-1 branch (4 channels)
    VV [dB], VH [dB], VV-VH [dB] (cross-polarisation ratio), validity flag
Sentinel-2 branch (9 channels)
    B02, B03, B04, B08, B11, B12 surface/TOA reflectance (0-1), NDWI, MNDWI, validity flag

Invalid pixels (SAR no-data, optical no-data, clouds, cloud shadows) are set to 0 after
standardisation and flagged in the validity channel, which the gated-fusion model uses to
decide per pixel how much to rely on each sensor.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path

import numpy as np

S2_BANDS: tuple[str, ...] = ("B02", "B03", "B04", "B08", "B11", "B12")
S1_CHANNELS = 4
S2_CHANNELS = 9
EPS = 1e-6

# Sen1Floods11 S2Hand band order is B1,B2,B3,B4,B5,B6,B7,B8,B8A,B9,B10,B11,B12
SEN1FLOODS11_S2_INDEX = {"B02": 1, "B03": 2, "B04": 3, "B08": 7, "B11": 11, "B12": 12}

# Physically plausible clipping ranges
VV_RANGE = (-30.0, 5.0)
VH_RANGE = (-35.0, 0.0)
REFL_RANGE = (0.0, 1.5)


@dataclass
class FeatureStats:
    """Per-channel standardisation statistics computed on the training split."""

    # Defaults = statistics measured on the Sen1Floods11 hand-labelled training split
    # (see aegis.ml.prepare.compute_stats); checkpoints embed their own copy.
    s1_mean: list[float] = field(default_factory=lambda: [-10.3761, -17.178, 6.8019])
    s1_std: list[float] = field(default_factory=lambda: [4.0044, 4.5252, 3.3032])
    s2_mean: list[float] = field(default_factory=lambda: [0.14272, 0.13983, 0.1239, 0.2679, 0.20735, 0.11957])
    s2_std: list[float] = field(default_factory=lambda: [0.07108, 0.07082, 0.08459, 0.09522, 0.09343, 0.07461])
    source: str = "Sen1Floods11 hand-labelled train split"

    def to_json(self, path: Path) -> None:
        path.write_text(json.dumps(asdict(self), indent=2))

    @classmethod
    def from_json(cls, path: Path) -> FeatureStats:
        return cls(**json.loads(path.read_text()))

    @classmethod
    def from_dict(cls, d: dict) -> FeatureStats:
        return cls(**d)


def safe_ratio(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Normalised difference (a-b)/(a+b) with protection against division by ~0."""
    den = a + b
    out = np.where(np.abs(den) > EPS, (a - b) / np.where(np.abs(den) > EPS, den, 1.0), 0.0)
    return np.clip(out, -1.0, 1.0).astype(np.float32)


def build_s1(vv_db: np.ndarray, vh_db: np.ndarray, stats: FeatureStats) -> np.ndarray:
    """Stack the SAR branch input. NaN marks invalid pixels."""
    valid = np.isfinite(vv_db) & np.isfinite(vh_db)
    vv = np.clip(np.nan_to_num(vv_db, nan=VV_RANGE[0]), *VV_RANGE)
    vh = np.clip(np.nan_to_num(vh_db, nan=VH_RANGE[0]), *VH_RANGE)
    ratio = vv - vh
    chans = []
    for x, m, s in zip((vv, vh, ratio), stats.s1_mean, stats.s1_std, strict=True):
        chans.append(np.where(valid, (x - m) / s, 0.0))
    chans.append(valid.astype(np.float32))
    return np.stack(chans).astype(np.float32)


def build_s2(refl: np.ndarray, valid: np.ndarray, stats: FeatureStats) -> np.ndarray:
    """Stack the optical branch input.

    ``refl`` has shape (6, H, W) holding reflectance (0-1) in ``S2_BANDS`` order; ``valid``
    is a boolean (H, W) mask that excludes no-data, clouds and cloud shadows.
    """
    if refl.shape[0] != len(S2_BANDS):
        raise ValueError(f"expected {len(S2_BANDS)} bands, got {refl.shape[0]}")
    valid = valid & np.all(np.isfinite(refl), axis=0)
    r = np.clip(np.nan_to_num(refl, nan=0.0), *REFL_RANGE)
    green, nir, swir1 = r[1], r[3], r[4]
    ndwi = safe_ratio(green, nir)
    mndwi = safe_ratio(green, swir1)
    chans = [np.where(valid, (r[i] - stats.s2_mean[i]) / stats.s2_std[i], 0.0) for i in range(len(S2_BANDS))]
    chans += [np.where(valid, ndwi, 0.0), np.where(valid, mndwi, 0.0), valid.astype(np.float32)]
    return np.stack(chans).astype(np.float32)


def empty_s1(shape: tuple[int, int]) -> np.ndarray:
    return np.zeros((S1_CHANNELS, *shape), dtype=np.float32)


def empty_s2(shape: tuple[int, int]) -> np.ndarray:
    return np.zeros((S2_CHANNELS, *shape), dtype=np.float32)


def gamma0_to_sigma0_db(gamma0_linear: np.ndarray, incidence_deg: float = 39.0) -> np.ndarray:
    """Approximate GRD sigma0 [dB] from terrain-flattened gamma0 [linear].

    Sen1Floods11 S1 chips are sigma0 (Earth Engine GRD), whereas the Planetary Computer
    ``sentinel-1-rtc`` collection provides radiometrically terrain-corrected gamma0.
    Over flat terrain gamma0 = sigma0 / cos(theta); we apply a mid-swath incidence of 39
    degrees (IW range ~30-46 deg) to harmonise, leaving a residual of about +-0.5 dB which
    the training-time radiometric augmentation (+-1.5 dB) covers.
    """
    with np.errstate(divide="ignore", invalid="ignore"):
        db = 10.0 * np.log10(np.where(gamma0_linear > 0, gamma0_linear, np.nan))
    return (db + 10.0 * np.log10(np.cos(np.deg2rad(incidence_deg)))).astype(np.float32)


def linear_to_db(x: np.ndarray) -> np.ndarray:
    with np.errstate(divide="ignore", invalid="ignore"):
        return (10.0 * np.log10(np.where(x > 0, x, np.nan))).astype(np.float32)
