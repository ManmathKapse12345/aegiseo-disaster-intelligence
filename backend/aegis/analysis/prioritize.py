"""Explainable response prioritisation.

The AOI is divided into square response cells (default 1 km). Each eligible cell (with a
minimum affected area) receives two sub-scores built from normalised, documented factors:

Hazard  H = weighted mean of
    extent     affected share of the cell (saturates at 50 %)
    intensity  mean detection confidence (flood: calibrated probability; wildfire: severity)
Exposure E = weighted mean of the factors whose data are available
    population           potentially exposed residents, log-scaled (saturates at 5,000 per km2 of cell);
                         falls back to built-up area (ESA WorldCover; saturates at 25 % of the cell)
                         when population is unavailable
    critical_facilities  1 - exp(-sum of facility weights); inside = full weight, within 500 m = half
    access               affected road length (saturates at 2 km per km2 of cell)

All saturation references are densities, so scores do not depend on the chosen cell size.

Priority score = 100 * H^a * E^(1-a)  (a = 0.5 by default), the multiplicative
"risk = hazard x exposure" formulation used by UNDRR / INFORM: a cell with no exposure
cannot be critical however intense the hazard, and vice versa. Vulnerability and coping
capacity are not included because no globally consistent fine-scale data exist; this is
reported as a limitation.

Categories: Critical >= 70, High >= 50, Moderate >= 30, Low otherwise. A cell containing a
hospital or emergency service inside the extent with confidence >= 0.6 is never ranked
below High (explicit life-safety floor rule).

Confidence is reported separately (it does NOT reduce priority - uncertain but potentially
severe situations must be verified, not silently down-ranked). Weight sensitivity is
quantified by Monte-Carlo perturbation of all weights.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field
from typing import Any

import numpy as np
from shapely.geometry import box

from aegis.analysis.bundle import SceneBundle
from aegis.analysis.hazards import HazardResult
from aegis.analysis.impact import FACILITY_LABELS, FACILITY_WEIGHTS, ImpactResult
from aegis.geo.vector import round_coords, to_wgs84

CATEGORIES = ("Critical", "High", "Moderate", "Low")
LIFE_SAFETY = {"hospital", "fire_station", "ambulance_station", "clinic", "shelter"}


@dataclass
class PriorityWeights:
    extent: float = 0.55
    intensity: float = 0.45
    population: float = 0.45
    critical_facilities: float = 0.35
    access: float = 0.20
    hazard_exponent: float = 0.5

    def validate(self) -> PriorityWeights:
        for k, v in asdict(self).items():
            if not (0 <= v <= 10) or not math.isfinite(v):
                raise ValueError(f"weight {k} must be a finite number in [0, 10]")
        if self.extent + self.intensity <= 0:
            raise ValueError("at least one hazard weight must be positive")
        if self.population + self.critical_facilities + self.access <= 0:
            raise ValueError("at least one exposure weight must be positive")
        if not (0.05 <= self.hazard_exponent <= 0.95):
            raise ValueError("hazard_exponent must be within [0.05, 0.95]")
        return self


@dataclass
class PriorityConfig:
    cell_km: float | None = None
    max_cells: int = 900
    min_affected_ha: float = 1.0
    extent_ref: float = 0.5
    pop_ref_per_km2: float = 5000.0
    built_ref_fraction: float = 0.25
    road_ref_km_per_km2: float = 2.0
    near_weight: float = 0.5
    thresholds: dict[str, float] = field(default_factory=lambda: {"Critical": 70.0, "High": 50.0, "Moderate": 30.0})
    sensitivity_samples: int = 200
    sensitivity_spread: float = 0.25
    seed: int = 0


def category_for(score: float, thresholds: dict[str, float]) -> str:
    if score >= thresholds["Critical"]:
        return "Critical"
    if score >= thresholds["High"]:
        return "High"
    if score >= thresholds["Moderate"]:
        return "Moderate"
    return "Low"


def _block_sum(a: np.ndarray, n: int, nby: int, nbx: int) -> np.ndarray:
    H, W = a.shape
    pad = np.zeros((nby * n, nbx * n), dtype=np.float64)
    pad[:H, :W] = a
    return pad.reshape(nby, n, nbx, n).sum(axis=(1, 3))


def _score(h: np.ndarray, e: np.ndarray, alpha: float) -> np.ndarray:
    return 100.0 * np.power(np.clip(h, 0, 1), alpha) * np.power(np.clip(e, 0, 1), 1 - alpha)


def _ranks(scores: np.ndarray) -> np.ndarray:
    order = np.argsort(-scores, kind="mergesort")
    r = np.empty_like(order)
    r[order] = np.arange(1, len(scores) + 1)
    return r


def prioritize(
    result: HazardResult,
    impact: ImpactResult,
    bundle: SceneBundle,
    weights: PriorityWeights | None = None,
    config: PriorityConfig | None = None,
) -> dict[str, Any]:
    w = (weights or PriorityWeights()).validate()
    cfg = config or PriorityConfig()
    g, aoi = bundle.grid, bundle.aoi_mask
    aoi_km2 = float(aoi.sum() * g.pixel_area_km2)
    # 1 km response cells (0.5 km for small AOIs), coarsened only if the AOI would exceed max_cells
    base = 0.5 if aoi_km2 < 50 else 1.0
    cell_km = cfg.cell_km or max(base, math.ceil(math.sqrt(max(aoi_km2, 1e-6) / cfg.max_cells) * 2) / 2)
    n = max(2, int(round(cell_km * 1000 / g.resolution)))
    cell_area_km2 = (n * g.resolution) ** 2 / 1e6
    nby, nbx = math.ceil(g.height / n), math.ceil(g.width / n)
    aff = (result.affected & aoi).astype(np.float64)

    A = _block_sum(aff, n, nby, nbx)
    T = _block_sum(aoi.astype(np.float64), n, nby, nbx)
    conf = np.nan_to_num(result.confidence, nan=0.0)
    if result.hazard == "wildfire" and result.severity is not None:
        conf = np.clip(result.severity.astype(np.float64) / 4.0, 0, 1)  # severity class 1-4 -> intensity
    C = _block_sum(conf * aff, n, nby, nbx)
    U = _block_sum(np.nan_to_num(result.uncertainty, nan=0.5) * aff, n, nby, nbx)
    corr = result.corroboration
    if corr is not None:
        cav = np.isfinite(corr) & (aff > 0)
        CA = _block_sum(np.where(cav, corr, 0.0), n, nby, nbx)
        CN = _block_sum(cav.astype(np.float64), n, nby, nbx)
    else:
        CA = CN = np.zeros((nby, nbx))
    pop_available = impact.population.get("available") and impact.pop_per_pixel is not None
    P = _block_sum(impact.pop_per_pixel * aff, n, nby, nbx) if pop_available else None
    lc = bundle.context.landcover
    B = _block_sum(((np.nan_to_num(lc, nan=0) == 50) & (aff > 0)).astype(np.float64), n, nby, nbx) * g.pixel_area_km2 \
        if lc is not None else None
    R = _block_sum(impact.road_km_per_pixel.astype(np.float64), n, nby, nbx) if impact.road_km_per_pixel is not None else None
    infra_available = impact.roads.get("available", False)

    fac_cells: dict[tuple[int, int], list[dict[str, Any]]] = {}
    for f in impact.facilities:
        if f["status"] in ("inside", "near"):
            fac_cells.setdefault((f["row"] // n, f["col"] // n), []).append(f)

    min_px = cfg.min_affected_ha * 1e4 / g.resolution**2
    eligible = [(i, j) for i in range(nby) for j in range(nbx) if A[i, j] >= max(1.0, min_px)]
    cells: list[dict[str, Any]] = []
    factor_rows = []
    for i, j in eligible:
        a_n, t_n = A[i, j], max(T[i, j], 1.0)
        ext = min(1.0, (a_n / t_n) / cfg.extent_ref)
        inten = C[i, j] / a_n
        unc = U[i, j] / a_n
        agree = (CA[i, j] / CN[i, j]) if CN[i, j] > 0 else None
        factors: dict[str, float | None] = {"extent": ext, "intensity": inten}
        exposure_basis = "population"
        if P is not None:
            pop = float(P[i, j])
            factors["population"] = min(1.0, math.log10(1 + pop) / math.log10(1 + cfg.pop_ref_per_km2 * cell_area_km2))
        elif B is not None:
            pop = None
            factors["population"] = min(1.0, float(B[i, j]) / (cfg.built_ref_fraction * cell_area_km2))
            exposure_basis = "built_up_proxy"
        else:
            pop = None
            factors["population"] = None
        facs = fac_cells.get((i, j), [])
        if infra_available:
            wsum = sum(FACILITY_WEIGHTS.get(f["category"], 0.3) * (1.0 if f["status"] == "inside" else cfg.near_weight) for f in facs)
            factors["critical_facilities"] = 1 - math.exp(-wsum)
            road_km = float(R[i, j]) if R is not None else 0.0
            factors["access"] = min(1.0, road_km / (cfg.road_ref_km_per_km2 * cell_area_km2))
        else:
            road_km = None
            factors["critical_facilities"] = None
            factors["access"] = None
        factor_rows.append(factors)
        cells.append({
            "i": i, "j": j, "affected_km2": round(a_n * g.pixel_area_km2, 4),
            "affected_fraction": round(a_n / t_n, 4), "mean_confidence": round(inten, 4),
            "mean_uncertainty": round(unc, 4), "cross_method_agreement": None if agree is None else round(agree, 4),
            "population_exposed": None if pop is None else int(round(pop)),
            "built_up_affected_km2": None if B is None else round(float(B[i, j]), 4),
            "road_km_affected": None if road_km is None else round(road_km, 3),
            "facilities": [{k: f[k] for k in ("id", "category", "name", "status", "distance_m", "lon", "lat")} for f in facs],
            "exposure_basis": exposure_basis,
            "factors": {k: (None if v is None else round(v, 4)) for k, v in factors.items()},
        })

    def compute(weights_: PriorityWeights, rows: list[dict[str, float | None]]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        hs, es, completeness = [], [], []
        for f in rows:
            hw = weights_.extent + weights_.intensity
            hs.append((weights_.extent * f["extent"] + weights_.intensity * f["intensity"]) / hw)
            parts = [(weights_.population, f["population"]), (weights_.critical_facilities, f["critical_facilities"]),
                     (weights_.access, f["access"])]
            av = [(wt, v) for wt, v in parts if v is not None and wt > 0]
            tot = sum(wt for wt, _ in parts if wt > 0)
            if av:
                es.append(sum(wt * v for wt, v in av) / sum(wt for wt, _ in av))
            else:
                es.append(0.5)  # exposure unknown: neutral prior, flagged as low completeness
            completeness.append(sum(wt for wt, _ in av) / tot if tot else 0.0)
        return np.array(hs), np.array(es), np.array(completeness)

    H_, E_, comp = compute(w, factor_rows) if factor_rows else (np.zeros(0), np.zeros(0), np.zeros(0))
    scores = _score(H_, E_, w.hazard_exponent) if len(H_) else np.zeros(0)

    # --- weight-sensitivity analysis (Monte-Carlo) ---------------------------------------
    sens = {"samples": 0}
    if len(scores) >= 2 and cfg.sensitivity_samples > 0:
        rng = np.random.default_rng(cfg.seed)
        base_rank = _ranks(scores)
        k = max(3, math.ceil(0.1 * len(scores)))
        top_hits = np.zeros(len(scores))
        same_cat = np.zeros(len(scores))
        base_cat = np.array([category_for(s, cfg.thresholds) for s in scores])
        rhos = []
        ranks_all = []
        for _ in range(cfg.sensitivity_samples):
            jit = lambda v: v * float(np.exp(rng.normal(0, cfg.sensitivity_spread)))  # noqa: E731
            wp = PriorityWeights(jit(w.extent), jit(w.intensity), jit(w.population), jit(w.critical_facilities),
                                 jit(w.access), float(np.clip(w.hazard_exponent + rng.normal(0, 0.08), 0.2, 0.8)))
            h2, e2, _ = compute(wp, factor_rows)
            s2 = _score(h2, e2, wp.hazard_exponent)
            r2 = _ranks(s2)
            ranks_all.append(r2)
            top_hits += r2 <= k
            same_cat += np.array([category_for(s, cfg.thresholds) for s in s2]) == base_cat
            d = (base_rank - r2).astype(np.float64)
            nn = len(scores)
            rhos.append(1 - 6 * np.sum(d * d) / (nn * (nn * nn - 1)))
        ranks_all = np.array(ranks_all)
        sens = {
            "samples": cfg.sensitivity_samples,
            "spread_log_sd": cfg.sensitivity_spread,
            "mean_spearman_rho": round(float(np.mean(rhos)), 4),
            "top_k": k,
        }
        for idx, cell in enumerate(cells):
            cell["sensitivity"] = {
                "p_top_k": round(float(top_hits[idx] / cfg.sensitivity_samples), 3),
                "category_stability": round(float(same_cat[idx] / cfg.sensitivity_samples), 3),
                "rank_p10": int(np.percentile(ranks_all[:, idx], 10)),
                "rank_p90": int(np.percentile(ranks_all[:, idx], 90)),
            }

    # --- assemble ---------------------------------------------------------------------------
    order = np.argsort(-scores, kind="mergesort") if len(scores) else []
    out_cells = []
    x0, y0, res = g.transform.c, g.transform.f, g.resolution
    for rank, idx in enumerate(order, start=1):
        cell = cells[idx]
        score = float(scores[idx])
        cat = category_for(score, cfg.thresholds)
        floor_applied = False
        life_safety_inside = [f for f in cell["facilities"] if f["category"] in LIFE_SAFETY and f["status"] == "inside"]
        if life_safety_inside and cell["mean_confidence"] >= 0.6 and cat in ("Moderate", "Low"):
            cat, floor_applied = "High", True
        u = cell["mean_uncertainty"]
        agree = cell["cross_method_agreement"]
        conf_score = 0.4 * max(0.0, 1 - 2.5 * u) + 0.3 * (agree if agree is not None else 0.5) + 0.3 * float(comp[idx])
        conf_level = "High" if conf_score >= 0.75 else ("Medium" if conf_score >= 0.5 else "Low")
        hw = w.extent + w.intensity
        ew_av = {k: getattr(w, k) for k in ("population", "critical_facilities", "access")
                 if cell["factors"].get(k) is not None and getattr(w, k) > 0}
        ew_sum = sum(ew_av.values()) or 1.0
        contributions = {
            "hazard": {"extent": round(w.extent * cell["factors"]["extent"] / hw, 4),
                       "intensity": round(w.intensity * cell["factors"]["intensity"] / hw, 4)},
            "exposure": {k: round(v * cell["factors"][k] / ew_sum, 4) for k, v in ew_av.items()},
        }
        i, j = cell["i"], cell["j"]
        cell_geom = box(x0 + j * n * res, y0 - (i + 1) * n * res, x0 + (j + 1) * n * res, y0 - i * n * res)
        geom = round_coords(to_wgs84(cell_geom, g).__geo_interface__)
        missing = [k for k, v in cell["factors"].items() if v is None]
        cell.update({
            "cell_id": f"C{i:03d}-{j:03d}",
            "rank": rank,
            "score": round(score, 2),
            "category": cat,
            "floor_rule_applied": floor_applied,
            "hazard_subscore": round(float(H_[idx]) * 100, 2),
            "exposure_subscore": round(float(E_[idx]) * 100, 2),
            "data_completeness": round(float(comp[idx]), 3),
            "confidence_score": round(conf_score, 3),
            "confidence": conf_level,
            "contributions": contributions,
            "missing_factors": missing,
            "geometry": geom,
            "centroid": [round(v, 6) for v in to_wgs84(cell_geom.centroid, g).coords[0]],
            "needs_verification": conf_level == "Low" and cat in ("Critical", "High"),
        })
        cell["explanation"] = explain_cell(cell, result.hazard, len(order))
        cell["recommended_actions"] = recommend(cell, result.hazard)
        out_cells.append(cell)
    dist = {c: sum(1 for x in out_cells if x["category"] == c) for c in CATEGORIES}
    return {
        "cell_km": cell_km,
        "cells": out_cells,
        "distribution": dist,
        "weights": asdict(w),
        "thresholds": cfg.thresholds,
        "sensitivity": sens,
        "methodology": __doc__.strip().splitlines()[0],
        "exposure_basis": "population" if P is not None else ("built_up_proxy" if B is not None else "unavailable"),
    }


def _fmt_int(v: int | None) -> str:
    return "n/a" if v is None else f"{v:,}"


def explain_cell(cell: dict[str, Any], hazard: str, n_cells: int) -> str:
    what = {"flood": "new surface water", "wildfire": "burn scar", "landslide": "landslide candidate"}.get(hazard, "change")
    parts = [
        f"{cell['category']} priority (score {cell['score']:.0f}/100, rank {cell['rank']} of {n_cells}).",
        f"{cell['affected_fraction'] * 100:.0f}% of this cell ({cell['affected_km2']:.2f} km2) shows {what}"
        f" (mean confidence {cell['mean_confidence']:.2f}).",
    ]
    if cell["population_exposed"] is not None:
        parts.append(f"About {_fmt_int(cell['population_exposed'])} residents are potentially exposed (estimate).")
    elif cell["exposure_basis"] == "built_up_proxy" and cell["built_up_affected_km2"] is not None:
        parts.append(f"{cell['built_up_affected_km2']:.3f} km2 of built-up land is affected (population data unavailable).")
    inside = [f for f in cell["facilities"] if f["status"] == "inside"]
    near = [f for f in cell["facilities"] if f["status"] == "near"]
    if inside:
        parts.append("Inside the detected extent: " + ", ".join(f"{f['name']} ({FACILITY_LABELS.get(f['category'], f['category']).lower()})" for f in inside[:4]) + ".")
    if near:
        parts.append(f"{len(near)} further facilit{'y' if len(near) == 1 else 'ies'} within 500 m.")
    if cell["road_km_affected"]:
        parts.append(f"{cell['road_km_affected']:.2f} km of mapped roads cross the affected area.")
    if cell["floor_rule_applied"]:
        parts.append("Raised to High by the life-safety rule (critical facility inside the extent).")
    agree = cell["cross_method_agreement"]
    parts.append(
        f"Confidence {cell['confidence'].lower()}: mean model uncertainty {cell['mean_uncertainty']:.2f}"
        + (f", independent-method agreement {agree * 100:.0f}%" if agree is not None else "")
        + f", data completeness {cell['data_completeness'] * 100:.0f}%."
    )
    if cell["missing_factors"]:
        parts.append("Missing: " + ", ".join(cell["missing_factors"]) + ".")
    s = cell.get("sensitivity")
    if s:
        parts.append(f"Ranking robustness: category unchanged in {s['category_stability'] * 100:.0f}% of weight perturbations.")
    return " ".join(parts)


def recommend(cell: dict[str, Any], hazard: str) -> list[str]:
    recs: list[str] = []
    if cell["needs_verification"]:
        recs.append("Verify before acting: evidence confidence is low (request VHR imagery, UAV or field confirmation).")
    cat = cell["category"]
    inside = [f for f in cell["facilities"] if f["status"] == "inside"]
    if cat == "Critical":
        recs.append("Prioritise for immediate situational verification and response coordination with local authorities.")
    elif cat == "High":
        recs.append("Schedule rapid verification and include in the next response-planning cycle.")
    elif cat == "Moderate":
        recs.append("Monitor with the next satellite acquisition; include in situational-awareness products.")
    else:
        recs.append("No immediate action indicated by remote sensing; continue routine monitoring.")
    for f in inside[:3]:
        if f["category"] in ("hospital", "clinic"):
            recs.append(f"Confirm operating status and access routes of {f['name']}.")
        elif f["category"] == "school":
            recs.append(f"Check whether {f['name']} is in use as a shelter or needs closure.")
        elif f["category"] in ("power", "water_works"):
            recs.append(f"Check service continuity at {f['name']}.")
    if cell.get("road_km_affected") and cell["road_km_affected"] > 0.2:
        recs.append("Assess road passability before routing ground teams through this cell.")
    if hazard == "flood":
        recs.append("Re-assess with the next Sentinel-1 pass to track flood evolution.")
    return recs
