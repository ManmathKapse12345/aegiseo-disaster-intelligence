"""Hazard-specific change detection.

Each detector turns a co-registered :class:`SceneBundle` into a :class:`HazardResult`:
an affected-area mask plus per-pixel confidence and uncertainty, display layers, data
quality diagnostics and a written methodology. The method is chosen per hazard because
the physical signal differs:

flood      new open water: deep multi-sensor fusion model applied to pre- and post-event
           data (post-classification comparison), permanent water excluded with JRC
           Global Surface Water, corroborated by SAR log-ratio and optical MNDWI change,
           constrained by terrain (slope and height above local drainage).
wildfire   burn scars: differenced Normalized Burn Ratio (dNBR) with USGS FIREMON severity
           classes, restricted to pre-fire vegetation, corroborated by SAR cross-pol
           decrease and VIIRS/MODIS active-fire detections.
landslide  candidate scars: vegetation loss (NDVI) and/or SAR backscatter change on steep
           slopes; always flagged for analyst verification.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import numpy as np
from scipy import ndimage

from aegis.analysis import indices
from aegis.analysis.bundle import SceneBundle, SensorObservation
from aegis.analysis.sar import lee_filter_db, log_ratio_db
from aegis.analysis.terrain import height_above_local_drainage, slope_degrees
from aegis.geo.vector import clean_mask
from aegis.ml.features import S2_BANDS, FeatureStats, build_s1, build_s2
from aegis.ml.inference import WaterSegmenter


class InsufficientDataError(RuntimeError):
    """The available observations cannot support the requested analysis."""


@dataclass
class DetectionParams:
    prob_threshold: float = 0.5
    min_mapping_unit_ha: float = 0.5
    mc_samples: int = 6
    sar_drop_db: float = -3.0
    max_hand_m: float = 15.0
    max_slope_deg: float = 8.0
    dnbr_threshold: float = 0.10
    landslide_min_slope_deg: float = 10.0
    ndvi_loss_threshold: float = 0.15


@dataclass
class HazardResult:
    hazard: str
    method: str
    methodology: list[str]
    affected: np.ndarray
    confidence: np.ndarray
    uncertainty: np.ndarray
    layers: dict[str, np.ndarray] = field(default_factory=dict)
    quality: dict[str, Any] = field(default_factory=dict)
    stats: dict[str, Any] = field(default_factory=dict)
    model_info: dict[str, Any] = field(default_factory=dict)
    severity: np.ndarray | None = None
    severity_labels: dict[int, str] = field(default_factory=dict)
    corroboration: np.ndarray | None = None  # 1 = independent method agrees, 0 = disagrees, NaN = n/a
    limitations: list[str] = field(default_factory=list)


def _mmu_pixels(ha: float, resolution_m: float) -> int:
    return max(1, int(math.ceil(ha * 1e4 / resolution_m**2)))


def _aoi_frac(mask: np.ndarray, aoi: np.ndarray) -> float:
    n = int(aoi.sum())
    return float((mask & aoi).sum() / n) if n else 0.0


def _features(s1: SensorObservation | None, s2: SensorObservation | None, stats: FeatureStats):
    f1 = build_s1(s1.bands["vv_db"], s1.bands["vh_db"], stats) if s1 is not None else None
    f2 = None
    if s2 is not None:
        refl = np.stack([s2.bands[b] for b in S2_BANDS])
        f2 = build_s2(refl, s2.valid, stats)
    return f1, f2


def distribution_shift(bundle: SceneBundle, stats: FeatureStats) -> dict[str, Any]:
    """Distance of the AOI's input distribution from the training distribution.

    Reported as the largest absolute z-score of AOI channel medians relative to the
    training pixel mean/std. Values > 1.5 indicate conditions under-represented in the
    training data (e.g. desert, snow, dense urban) where model output deserves scrutiny.
    """
    zs: dict[str, float] = {}
    aoi = bundle.aoi_mask
    for role in ("pre", "post"):
        s1 = bundle.get("S1", role)
        if s1 is not None:
            for i, key in enumerate(("vv_db", "vh_db")):
                v = s1.bands[key][aoi & s1.valid]
                if v.size > 100:
                    zs[f"S1_{role}_{key}"] = abs(float(np.median(v)) - stats.s1_mean[i]) / stats.s1_std[i]
        s2 = bundle.get("S2", role)
        if s2 is not None:
            for i, b in enumerate(S2_BANDS):
                v = s2.bands[b][aoi & s2.valid]
                if v.size > 100:
                    zs[f"S2_{role}_{b}"] = abs(float(np.median(v)) - stats.s2_mean[i]) / stats.s2_std[i]
    worst = max(zs.items(), key=lambda kv: kv[1]) if zs else (None, 0.0)
    return {"max_z": round(float(worst[1]), 3), "worst_channel": worst[0], "per_channel": {k: round(v, 3) for k, v in zs.items()}}


# ============================================================================ flood
def detect_flood(
    bundle: SceneBundle,
    segmenter: WaterSegmenter,
    params: DetectionParams | None = None,
    cancel_check: Callable[[], None] | None = None,
) -> HazardResult:
    p = params or DetectionParams()
    g, aoi = bundle.grid, bundle.aoi_mask
    s1_pre, s1_post = bundle.get("S1", "pre"), bundle.get("S1", "post")
    s2_pre, s2_post = bundle.get("S2", "pre"), bundle.get("S2", "post")
    if s1_post is None and s2_post is None:
        raise InsufficientDataError("no post-event Sentinel-1 or Sentinel-2 observation is available")
    s2_post_usable = s2_post if (s2_post is not None and s2_post.valid_fraction > 0.02) else None
    if s1_post is None and s2_post_usable is None:
        raise InsufficientDataError("post-event Sentinel-2 is fully cloud-covered and no Sentinel-1 is available")
    segmenter.load()
    stats = segmenter.stats
    methodology: list[str] = []
    limitations: list[str] = []

    post = segmenter.predict(*_features(s1_post, s2_post_usable, stats), mc_samples=p.mc_samples, cancel_check=cancel_check)
    methodology.append(
        f"Post-event surface water probability from {post.model_info.get('variant')} "
        f"({'Sentinel-1' if s1_post else ''}{' + ' if s1_post and s2_post_usable else ''}{'Sentinel-2' if s2_post_usable else ''}), "
        f"temperature-calibrated (T={post.model_info.get('temperature', 1.0):.3f})"
        + (f", {post.model_info.get('mc_samples')} Monte-Carlo dropout samples." if post.method == "deep_fusion_model" else ".")
    )
    if post.method != "deep_fusion_model":
        limitations.append("Deep model unavailable - classical Otsu/MNDWI rules were used; confidence is reduced.")

    occ = bundle.context.water_occurrence
    permanent = bundle.context.permanent_water
    pre = None
    if s1_pre is not None or s2_pre is not None:
        pre = segmenter.predict(*_features(s1_pre, s2_pre, stats), mc_samples=max(1, p.mc_samples // 2), cancel_check=cancel_check)
        methodology.append("Pre-event surface water probability from the same model (post-classification comparison).")
    p_post = post.prob
    if pre is not None:
        p_pre = pre.prob.copy()
        missing = ~np.isfinite(p_pre)
        if occ is not None:
            p_pre[missing] = np.clip(np.nan_to_num(occ[missing]) / 100.0, 0, 1)
    elif occ is not None:
        p_pre = np.clip(np.nan_to_num(occ) / 100.0, 0, 1).astype(np.float32)
        methodology.append("No pre-event image: JRC water occurrence used as the prior probability of pre-existing water.")
        limitations.append("No pre-event acquisition - seasonal water may be counted as flooding.")
    else:
        p_pre = np.zeros_like(p_post)
        limitations.append("No pre-event acquisition and no permanent-water reference - all detected water is reported.")

    p_flood = p_post * (1.0 - np.nan_to_num(p_pre, nan=0.0))
    methodology.append("New-water probability P(flood) = P(water after) x (1 - P(water before)).")
    if permanent is not None:
        p_flood = np.where(permanent, 0.0, p_flood)
        methodology.append("Permanent water (JRC Global Surface Water occurrence >= 80 %) excluded.")
    p_flood = np.where(np.isfinite(p_post), p_flood, np.nan).astype(np.float32)

    std_pre = pre.epistemic_std if pre is not None else np.zeros_like(p_post)
    unc = np.sqrt((1 - np.nan_to_num(p_pre)) ** 2 * np.nan_to_num(post.epistemic_std) ** 2
                  + np.nan_to_num(p_post) ** 2 * np.nan_to_num(std_pre) ** 2).astype(np.float32)
    unc[~np.isfinite(p_flood)] = np.nan

    # --- terrain plausibility --------------------------------------------------------
    implausible = np.zeros(g.shape, dtype=bool)
    layers: dict[str, np.ndarray] = {}
    if bundle.context.dem is not None and np.isfinite(bundle.context.dem).any():
        hand = height_above_local_drainage(bundle.context.dem, g.resolution)
        slope = slope_degrees(bundle.context.dem, g.resolution)
        implausible = (np.nan_to_num(hand) > p.max_hand_m) | (np.nan_to_num(slope) > p.max_slope_deg)
        layers["hand_m"] = hand
        methodology.append(
            f"Terrain constraint: detections more than {p.max_hand_m:.0f} m above local drainage or on slopes > "
            f"{p.max_slope_deg:.0f} deg removed (Copernicus DEM GLO-30)."
        )
    else:
        limitations.append("No DEM available - terrain plausibility check skipped.")

    candidate = (np.nan_to_num(p_flood) >= p.prob_threshold) & aoi
    terrain_suppressed = candidate & implausible
    detected = clean_mask(candidate & ~implausible, _mmu_pixels(p.min_mapping_unit_ha, g.resolution))
    methodology.append(
        f"Threshold P(flood) >= {p.prob_threshold:.2f}, morphological opening and a minimum mapping unit of "
        f"{p.min_mapping_unit_ha} ha."
    )

    # --- corroboration by independent classical methods --------------------------------
    corr = np.full(g.shape, np.nan, dtype=np.float32)
    sar_support = opt_support = None
    s1_orbit_consistent = None
    if s1_pre is not None and s1_post is not None:
        s1_orbit_consistent = s1_pre.meta.get("relative_orbit") == s1_post.meta.get("relative_orbit")
        dvv = log_ratio_db(lee_filter_db(s1_post.bands["vv_db"]), lee_filter_db(s1_pre.bands["vv_db"]))
        layers["sar_change_db"] = dvv
        sar_support = np.where(np.isfinite(dvv), (dvv <= p.sar_drop_db).astype(np.float32), np.nan)
        methodology.append(f"SAR corroboration: Lee-filtered VV log-ratio <= {p.sar_drop_db:.0f} dB.")
        if not s1_orbit_consistent:
            limitations.append("Pre/post Sentinel-1 come from different relative orbits - SAR change is less reliable.")
    if s2_post_usable is not None:
        m_post = indices.mndwi(s2_post_usable.bands)
        ok = s2_post_usable.valid & np.isfinite(m_post)
        opt = (m_post > 0).astype(np.float32)
        if s2_pre is not None:
            m_pre = indices.mndwi(s2_pre.bands)
            ok &= s2_pre.valid & np.isfinite(m_pre)
            opt = ((m_post > 0) & (m_pre <= 0)).astype(np.float32)
        opt_support = np.where(ok, opt, np.nan)
        methodology.append("Optical corroboration: MNDWI > 0 after the event (and <= 0 before, where cloud-free).")
    if sar_support is not None or opt_support is not None:
        stack = np.stack([a for a in (sar_support, opt_support) if a is not None])
        any_avail = np.isfinite(stack).any(axis=0)
        agree = np.nanmax(np.where(np.isfinite(stack), stack, -1), axis=0)
        corr = np.where(any_avail, (agree > 0).astype(np.float32), np.nan)

    det_n = int(detected.sum())
    corr_det = corr[detected]
    corr_avail = np.isfinite(corr_det)
    agreement = float(np.mean(corr_det[corr_avail])) if corr_avail.any() else None
    conf = np.where(np.isfinite(p_flood), p_flood, np.nan).astype(np.float32)

    # --- quality / diagnostics ----------------------------------------------------------
    def gap_days(a: SensorObservation | None, b: SensorObservation | None) -> float | None:
        if a is None or b is None:
            return None
        return round(abs((b.acquired_at - a.acquired_at).total_seconds()) / 86400.0, 1)

    quality = {
        "sensors_post": [s for s, o in (("S1", s1_post), ("S2", s2_post_usable)) if o is not None],
        "sensors_pre": [s for s, o in (("S1", s1_pre), ("S2", s2_pre)) if o is not None],
        "s2_post_cloud_fraction": None if s2_post is None else s2_post.cloud_fraction,
        "s2_post_valid_fraction": None if s2_post is None else s2_post.valid_fraction,
        "s1_orbit_consistent": s1_orbit_consistent,
        "s1_gap_days": gap_days(s1_pre, s1_post),
        "s2_gap_days": gap_days(s2_pre, s2_post),
        "terrain_suppressed_fraction": float(terrain_suppressed.sum() / max(1, candidate.sum())),
        "mean_uncertainty_detected": float(np.nanmean(unc[detected])) if det_n else None,
        "mean_entropy_detected": float(np.nanmean(post.entropy[detected])) if det_n else None,
        "mean_probability_detected": float(np.nanmean(p_flood[detected])) if det_n else None,
        "cross_method_agreement": agreement,
        "cross_method_coverage": float(corr_avail.mean()) if det_n else None,
        "affected_fraction_of_aoi": _aoi_frac(detected, aoi),
        "no_data_fraction_post": float((~np.isfinite(p_post) & aoi).sum() / max(1, aoi.sum())),
        "model_method": post.method,
        "distribution_shift": distribution_shift(bundle, stats),
    }
    if post.sar_reliance is not None:
        quality["mean_sar_reliance_detected"] = float(np.nanmean(post.sar_reliance[detected])) if det_n else None
    px = g.pixel_area_km2
    stats_out = {
        "affected_area_km2": round(det_n * px, 4),
        "post_water_area_km2": round(float((np.nan_to_num(p_post) >= 0.5)[aoi].sum() * px), 4),
        "pre_water_area_km2": round(float((np.nan_to_num(p_pre) >= 0.5)[aoi].sum() * px), 4) if pre is not None or occ is not None else None,
        "permanent_water_area_km2": round(float(permanent[aoi].sum() * px), 4) if permanent is not None else None,
        "aoi_area_km2": round(float(aoi.sum() * px), 4),
        "pixel_size_m": g.resolution,
    }
    layers.update({
        "flood_probability": p_flood,
        "post_water_probability": p_post,
        "uncertainty": unc,
        "affected": detected.astype(np.float32),
    })
    if pre is not None:
        layers["pre_water_probability"] = pre.prob
    if post.sar_reliance is not None:
        layers["sar_reliance"] = post.sar_reliance
    limitations += [
        "Flood depth is not estimated; extent only.",
        "C-band SAR under-detects water beneath dense vegetation and in built-up areas (double-bounce).",
    ]
    return HazardResult(
        hazard="flood",
        method="Multi-sensor post-classification comparison (gated-fusion U-Net) with classical corroboration",
        methodology=methodology,
        affected=detected,
        confidence=conf,
        uncertainty=unc,
        layers=layers,
        quality=quality,
        stats=stats_out,
        model_info=post.model_info,
        corroboration=corr,
        limitations=limitations,
    )


# ============================================================================ wildfire
def detect_burn(bundle: SceneBundle, params: DetectionParams | None = None, hotspots: list[dict] | None = None) -> HazardResult:
    p = params or DetectionParams()
    g, aoi = bundle.grid, bundle.aoi_mask
    s2_pre, s2_post = bundle.get("S2", "pre"), bundle.get("S2", "post")
    s1_pre, s1_post = bundle.get("S1", "pre"), bundle.get("S1", "post")
    methodology: list[str] = []
    limitations: list[str] = ["dNBR thresholds are generic (Key & Benson, 2006); field calibration (CBI) is not available."]
    layers: dict[str, np.ndarray] = {}
    optical_ok = s2_pre is not None and s2_post is not None and (s2_pre.valid & s2_post.valid & aoi).sum() > 0.02 * aoi.sum()
    severity = None
    if optical_ok:
        nbr_pre, nbr_post = indices.nbr(s2_pre.bands), indices.nbr(s2_post.bands)
        dnbr = nbr_pre - nbr_post
        valid = s2_pre.valid & s2_post.valid & np.isfinite(dnbr)
        water = (np.nan_to_num(indices.mndwi(s2_pre.bands), nan=-1) > 0)
        if bundle.context.permanent_water is not None:
            water |= bundle.context.permanent_water
        vegetated = np.nan_to_num(indices.ndvi(s2_pre.bands), nan=0) > 0.15
        burned = valid & ~water & vegetated & (dnbr >= p.dnbr_threshold) & aoi
        burned = clean_mask(burned, _mmu_pixels(p.min_mapping_unit_ha, g.resolution))
        conf = np.where(valid, 1 / (1 + np.exp(-(np.nan_to_num(dnbr) - p.dnbr_threshold) / 0.05)), np.nan).astype(np.float32)
        severity = np.where(burned, indices.classify_dnbr(dnbr), 0).astype(np.int8)
        layers.update({"dnbr": np.where(valid, dnbr, np.nan).astype(np.float32), "burn_severity": severity.astype(np.float32)})
        methodology += [
            "dNBR = NBR(pre) - NBR(post), NBR = (B08 - B12) / (B08 + B12) on cloud-free Sentinel-2 pixels.",
            f"Burned where dNBR >= {p.dnbr_threshold:.2f} on pixels vegetated before the event (NDVI > 0.15), water excluded.",
            "Severity classes: USGS FIREMON (low 0.10-0.27, moderate-low 0.27-0.44, moderate-high 0.44-0.66, high > 0.66).",
        ]
        method = "Differenced Normalized Burn Ratio (dNBR) with SAR and active-fire corroboration"
    elif s1_pre is not None and s1_post is not None:
        dvh = log_ratio_db(lee_filter_db(s1_post.bands["vh_db"]), lee_filter_db(s1_pre.bands["vh_db"]))
        lc = bundle.context.landcover
        veg = np.isin(np.nan_to_num(lc, nan=0).astype(int), (10, 20, 30)) if lc is not None else np.ones(g.shape, bool)
        burned = clean_mask((np.nan_to_num(dvh) <= -2.0) & veg & aoi, _mmu_pixels(max(1.0, p.min_mapping_unit_ha), g.resolution))
        conf = np.where(np.isfinite(dvh), 1 / (1 + np.exp((np.nan_to_num(dvh) + 2.0) / 0.7)), np.nan).astype(np.float32) * 0.7
        layers["sar_change_vh_db"] = dvh
        methodology.append("Optical data unusable: burned area approximated by VH backscatter decrease <= -2 dB in vegetation.")
        limitations.append("SAR-only burn mapping is a weak proxy (moisture and phenology also change VH); low confidence.")
        method = "SAR cross-polarisation change (fallback, low confidence)"
    else:
        raise InsufficientDataError("wildfire analysis needs cloud-free Sentinel-2 before and after, or a Sentinel-1 pair")

    corr = np.full(g.shape, np.nan, np.float32)
    if optical_ok and s1_pre is not None and s1_post is not None:
        dvh = log_ratio_db(lee_filter_db(s1_post.bands["vh_db"]), lee_filter_db(s1_pre.bands["vh_db"]))
        layers["sar_change_vh_db"] = dvh
        corr = np.where(np.isfinite(dvh), (dvh <= -1.0).astype(np.float32), np.nan)
        methodology.append("SAR corroboration: VH decrease <= -1 dB (loss of canopy volume scattering).")
    hotspot_support = None
    if hotspots:
        rows, cols = _points_to_pixels(g, [(h["lon"], h["lat"]) for h in hotspots])
        inside = [(r, c) for r, c in zip(rows, cols, strict=True) if 0 <= r < g.height and 0 <= c < g.width]
        if burned.any() and inside:
            dist = ndimage.distance_transform_edt(~burned) * g.resolution
            near = sum(1 for r, c in inside if dist[r, c] <= 750)
            hotspot_support = {"hotspots_in_aoi": len(inside), "hotspots_within_750m_of_burn": near}
        else:
            hotspot_support = {"hotspots_in_aoi": len(inside), "hotspots_within_750m_of_burn": 0}
        methodology.append("Active-fire corroboration: VIIRS/MODIS detections within 750 m of mapped burn scars.")
    det_n = int(burned.sum())
    corr_det = corr[burned]
    avail = np.isfinite(corr_det)
    unc = np.where(np.isfinite(conf), 1 - np.abs(2 * conf - 1), np.nan).astype(np.float32) * 0.5
    px = g.pixel_area_km2
    sev_area = {}
    if severity is not None:
        for _, _, name, code in indices.DNBR_CLASSES[1:]:
            sev_area[name] = round(float((severity == code).sum() * px), 4)
    quality = {
        "sensors_post": [s for s, o in (("S1", s1_post), ("S2", s2_post)) if o is not None],
        "sensors_pre": [s for s, o in (("S1", s1_pre), ("S2", s2_pre)) if o is not None],
        "s2_post_cloud_fraction": None if s2_post is None else s2_post.cloud_fraction,
        "optical_used": bool(optical_ok),
        "cross_method_agreement": float(np.mean(corr_det[avail])) if avail.any() else None,
        "cross_method_coverage": float(avail.mean()) if det_n else None,
        "mean_probability_detected": float(np.nanmean(conf[burned])) if det_n else None,
        "mean_uncertainty_detected": float(np.nanmean(unc[burned])) if det_n else None,
        "affected_fraction_of_aoi": _aoi_frac(burned, aoi),
        "hotspot_corroboration": hotspot_support,
        "model_method": "index_based",
    }
    layers.update({"burn_confidence": conf, "affected": burned.astype(np.float32), "uncertainty": unc})
    return HazardResult(
        hazard="wildfire", method=method, methodology=methodology, affected=burned, confidence=conf, uncertainty=unc,
        layers=layers, quality=quality,
        stats={"affected_area_km2": round(det_n * px, 4), "severity_area_km2": sev_area,
               "aoi_area_km2": round(float(aoi.sum() * px), 4), "pixel_size_m": g.resolution},
        model_info={"variant": "dnbr_index", "version": "dnbr-firemon@1"},
        severity=severity,
        severity_labels={code: name for _, _, name, code in indices.DNBR_CLASSES},
        corroboration=corr,
        limitations=limitations,
    )


# ============================================================================ landslide
def detect_landslide(bundle: SceneBundle, params: DetectionParams | None = None) -> HazardResult:
    p = params or DetectionParams()
    g, aoi = bundle.grid, bundle.aoi_mask
    dem = bundle.context.dem
    if dem is None or not np.isfinite(dem).any():
        raise InsufficientDataError("landslide analysis requires a digital elevation model")
    slope = slope_degrees(dem, g.resolution)
    steep = np.nan_to_num(slope) >= p.landslide_min_slope_deg
    s2_pre, s2_post = bundle.get("S2", "pre"), bundle.get("S2", "post")
    s1_pre, s1_post = bundle.get("S1", "pre"), bundle.get("S1", "post")
    methodology = [f"Candidate zones restricted to slopes >= {p.landslide_min_slope_deg:.0f} deg (Copernicus DEM)."]
    limitations = [
        "Landslide detection from 10-20 m imagery is indicative only; small or narrow failures are missed.",
        "Candidates require analyst verification (VHR imagery or field reports) before operational use.",
    ]
    layers: dict[str, np.ndarray] = {"slope_deg": slope}
    score = np.zeros(g.shape, np.float32)
    weight = np.zeros(g.shape, np.float32)
    have_opt = s2_pre is not None and s2_post is not None
    have_sar = s1_pre is not None and s1_post is not None
    if not have_opt and not have_sar:
        raise InsufficientDataError("landslide analysis needs a pre/post Sentinel-2 or Sentinel-1 pair")
    if have_opt:
        loss = indices.ndvi(s2_pre.bands) - indices.ndvi(s2_post.bands)
        ok = s2_pre.valid & s2_post.valid & np.isfinite(loss)
        layers["ndvi_loss"] = np.where(ok, loss, np.nan).astype(np.float32)
        score += np.where(ok, (loss >= p.ndvi_loss_threshold).astype(np.float32) * 0.65, 0)
        weight += np.where(ok, 0.65, 0)
        methodology.append(f"Vegetation stripping: NDVI(pre) - NDVI(post) >= {p.ndvi_loss_threshold:.2f}.")
    if have_sar:
        dvv = log_ratio_db(lee_filter_db(s1_post.bands["vv_db"]), lee_filter_db(s1_pre.bands["vv_db"]))
        ok = np.isfinite(dvv)
        layers["sar_change_db"] = dvv
        score += np.where(ok, (np.abs(np.nan_to_num(dvv)) >= 2.5).astype(np.float32) * 0.35, 0)
        weight += np.where(ok, 0.35, 0)
        methodology.append("Surface disturbance: |VV log-ratio| >= 2.5 dB (Lee-filtered).")
    conf = np.where(weight > 0, score / np.maximum(weight, 1e-6), np.nan).astype(np.float32)
    need = 0.6 if have_opt else 0.99
    cand = steep & aoi & (np.nan_to_num(conf) >= need)
    if bundle.context.permanent_water is not None:
        cand &= ~bundle.context.permanent_water
    cand = clean_mask(cand, _mmu_pixels(max(0.2, p.min_mapping_unit_ha * 0.5), g.resolution))
    conf = conf * (0.85 if have_opt else 0.55)  # indicator agreement is not a calibrated probability
    unc = np.where(np.isfinite(conf), 0.5 - 0.5 * np.abs(2 * conf - 1), np.nan).astype(np.float32)
    det_n = int(cand.sum())
    px = g.pixel_area_km2
    corr = np.full(g.shape, np.nan, np.float32)
    if have_opt and have_sar:
        corr = np.where(np.isfinite(layers["sar_change_db"]), (np.abs(np.nan_to_num(layers["sar_change_db"])) >= 2.5).astype(np.float32), np.nan)
    avail = np.isfinite(corr[cand])
    layers.update({"landslide_score": conf, "affected": cand.astype(np.float32), "uncertainty": unc})
    return HazardResult(
        hazard="landslide",
        method="Multi-indicator landslide candidate mapping (NDVI loss, SAR change, slope)",
        methodology=methodology, affected=cand, confidence=conf, uncertainty=unc, layers=layers,
        quality={
            "sensors_post": [s for s, o in (("S1", s1_post), ("S2", s2_post)) if o is not None],
            "sensors_pre": [s for s, o in (("S1", s1_pre), ("S2", s2_pre)) if o is not None],
            "s2_post_cloud_fraction": None if s2_post is None else s2_post.cloud_fraction,
            "cross_method_agreement": float(np.mean(corr[cand][avail])) if avail.any() else None,
            "cross_method_coverage": float(avail.mean()) if det_n else None,
            "mean_probability_detected": float(np.nanmean(conf[cand])) if det_n else None,
            "mean_uncertainty_detected": float(np.nanmean(unc[cand])) if det_n else None,
            "affected_fraction_of_aoi": _aoi_frac(cand, aoi),
            "model_method": "indicator_based",
            "requires_verification": True,
        },
        stats={"affected_area_km2": round(det_n * px, 4), "aoi_area_km2": round(float(aoi.sum() * px), 4),
               "pixel_size_m": g.resolution},
        model_info={"variant": "landslide_indicators", "version": "ndvi-sar-slope@1"},
        corroboration=corr,
        limitations=limitations,
    )


def _points_to_pixels(g, lonlats: list[tuple[float, float]]) -> tuple[list[int], list[int]]:
    if not lonlats:
        return [], []
    xs, ys = g.from_wgs84.transform([p[0] for p in lonlats], [p[1] for p in lonlats])
    cols = [int((x - g.transform.c) // g.resolution) for x in xs]
    rows = [int((g.transform.f - y) // g.resolution) for y in ys]
    return rows, cols
