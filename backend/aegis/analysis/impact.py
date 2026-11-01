"""Exposure / impact assessment.

Terminology is deliberate: anything intersecting a detected hazard extent is
*potentially exposed* or *potentially affected*. Nothing here establishes damage,
displacement or casualties - those require ground truth.

Inputs
    hazard result (affected mask on the analysis grid)
    infrastructure features (OpenStreetMap via Overpass, or synthetic)
    population estimate (WorldPop zonal statistics, or a synthetic raster)
    land cover (ESA WorldCover 2021)

Population disaggregation
    WorldPop zonal totals are authoritative for the AOI and for the affected extent. For
    per-cell prioritisation the affected total is allocated to pixels dasymetrically
    (Mennis, 2003) using land-cover weights, so cell values always sum to the zonal total.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

import numpy as np
from scipy import ndimage

from aegis.analysis.bundle import WORLDCOVER_CLASSES, SceneBundle
from aegis.analysis.hazards import HazardResult
from aegis.geo.grid import Grid

# Relative importance of facility types for life safety and response capacity.
FACILITY_WEIGHTS: dict[str, float] = {
    "hospital": 1.0,
    "clinic": 0.6,
    "fire_station": 0.8,
    "ambulance_station": 0.8,
    "police": 0.6,
    "shelter": 0.7,
    "school": 0.5,
    "power": 0.6,
    "water_works": 0.6,
    "telecom": 0.4,
}
FACILITY_LABELS: dict[str, str] = {
    "hospital": "Hospitals",
    "clinic": "Clinics / health posts",
    "fire_station": "Fire stations",
    "ambulance_station": "Ambulance stations",
    "police": "Police stations",
    "shelter": "Shelters",
    "school": "Schools",
    "power": "Power infrastructure",
    "water_works": "Water / wastewater works",
    "telecom": "Telecom",
    "settlement": "Settlements",
}
# Dasymetric weights by WorldCover class (relative residential density)
DASYMETRIC_WEIGHTS: dict[int, float] = {50: 1.0, 40: 0.05, 30: 0.03, 20: 0.02, 10: 0.01, 60: 0.02, 90: 0.005, 95: 0.0,
                                        80: 0.0, 70: 0.0, 100: 0.0}


@dataclass
class PopulationEstimate:
    available: bool
    source: str
    year: int | None = None
    aoi_total: float | None = None
    affected_total: float | None = None
    pixel_raster: np.ndarray | None = None   # people per pixel (synthetic scenes)
    method: str = ""
    note: str = ""
    provenance: dict[str, Any] = field(default_factory=dict)


@dataclass
class ImpactResult:
    affected_area_km2: float
    population: dict[str, Any]
    facilities: list[dict[str, Any]]
    facility_counts: dict[str, dict[str, int]]
    roads: dict[str, Any]
    settlements: list[dict[str, Any]]
    landcover_affected_ha: dict[str, float] | None
    pop_per_pixel: np.ndarray | None
    built_up_affected_km2: float | None
    road_km_per_pixel: np.ndarray | None = None
    limitations: list[str] = field(default_factory=list)

    def summary(self) -> dict[str, Any]:
        return {
            "affected_area_km2": self.affected_area_km2,
            "population": self.population,
            "facility_counts": self.facility_counts,
            "roads": self.roads,
            "settlements_affected": [s for s in self.settlements if s["status"] != "outside"],
            "landcover_affected_ha": self.landcover_affected_ha,
            "built_up_affected_km2": self.built_up_affected_km2,
            "limitations": self.limitations,
        }


def lonlat_to_pixel(grid: Grid, lon: float, lat: float) -> tuple[int, int]:
    x, y = grid.from_wgs84.transform(lon, lat)
    return int((grid.transform.f - y) // grid.resolution), int((x - grid.transform.c) // grid.resolution)


def _line_coords_px(grid: Grid, coords: list[list[float]]) -> np.ndarray:
    xs, ys = grid.from_wgs84.transform([c[0] for c in coords], [c[1] for c in coords])
    return np.column_stack([np.asarray(xs), np.asarray(ys)])


def road_exposure(
    grid: Grid, affected: np.ndarray, roads: list[dict[str, Any]], aoi_mask: np.ndarray
) -> tuple[dict[str, Any], np.ndarray]:
    """Length of road (km) crossing the affected extent, by highway class.

    Lines are densified to half-pixel steps in the projected grid and each sample is
    tested against the affected raster - robust for any number of segments. Also returns
    a raster of affected road length (km) per pixel for per-cell aggregation.
    """
    by_class_aff: dict[str, float] = {}
    by_class_tot: dict[str, float] = {}
    segments_aff: list[dict[str, Any]] = []
    km_px = np.zeros(grid.shape, np.float32)
    step = grid.resolution / 2.0
    for f in roads:
        geom = f.get("geometry") or {}
        lines = [geom["coordinates"]] if geom.get("type") == "LineString" else (
            geom.get("coordinates", []) if geom.get("type") == "MultiLineString" else [])
        cls = (f.get("tags") or {}).get("highway", "road")
        for line in lines:
            if len(line) < 2:
                continue
            xy = _line_coords_px(grid, line)
            seg = np.diff(xy, axis=0)
            lens = np.hypot(seg[:, 0], seg[:, 1])
            aff_len = tot_len = 0.0
            for (x0, y0), (dx, dy), ln in zip(xy[:-1], seg, lens, strict=True):
                if ln <= 0:
                    continue
                n = max(1, int(math.ceil(ln / step)))
                t = (np.arange(n) + 0.5) / n
                xs, ys = x0 + t * dx, y0 + t * dy
                cols = ((xs - grid.transform.c) // grid.resolution).astype(int)
                rows = ((grid.transform.f - ys) // grid.resolution).astype(int)
                inside = (rows >= 0) & (rows < grid.height) & (cols >= 0) & (cols < grid.width)
                if not inside.any():
                    continue
                r, c = rows[inside], cols[inside]
                in_aoi = aoi_mask[r, c]
                piece = ln / n
                hit = affected[r, c] & in_aoi
                tot_len += float(in_aoi.sum()) * piece
                aff_len += float(hit.sum()) * piece
                np.add.at(km_px, (r[hit], c[hit]), piece / 1000.0)
            by_class_tot[cls] = by_class_tot.get(cls, 0.0) + tot_len / 1000
            if aff_len > 0:
                by_class_aff[cls] = by_class_aff.get(cls, 0.0) + aff_len / 1000
                segments_aff.append({"id": f.get("id"), "name": f.get("name"), "class": cls, "affected_km": round(aff_len / 1000, 3)})
    segments_aff.sort(key=lambda s: -s["affected_km"])
    return {
        "available": True,
        "affected_km_by_class": {k: round(v, 3) for k, v in sorted(by_class_aff.items(), key=lambda kv: -kv[1])},
        "total_km_in_aoi_by_class": {k: round(v, 3) for k, v in sorted(by_class_tot.items(), key=lambda kv: -kv[1])},
        "affected_km": round(sum(by_class_aff.values()), 3),
        "segments": segments_aff[:50],
    }, km_px


def assess_impact(
    result: HazardResult,
    bundle: SceneBundle,
    infrastructure: list[dict[str, Any]] | None,
    population: PopulationEstimate | None,
    near_m: float = 500.0,
) -> ImpactResult:
    g, aoi = bundle.grid, bundle.aoi_mask
    affected = result.affected & aoi
    px_km2 = g.pixel_area_km2
    limitations: list[str] = []
    dist_m = ndimage.distance_transform_edt(~affected) * g.resolution if affected.any() else np.full(g.shape, np.inf)

    # --- point facilities and settlements ----------------------------------------------
    facilities: list[dict[str, Any]] = []
    settlements: list[dict[str, Any]] = []
    counts: dict[str, dict[str, int]] = {}
    roads: list[dict[str, Any]] = []
    if infrastructure is None:
        limitations.append("Infrastructure data unavailable - facility and road exposure not assessed.")
    for f in infrastructure or []:
        geom = f.get("geometry") or {}
        cat = f.get("category", "other")
        if cat == "road":
            roads.append(f)
            continue
        if geom.get("type") != "Point":
            continue
        lon, lat = geom["coordinates"][:2]
        r, c = lonlat_to_pixel(g, lon, lat)
        if not (0 <= r < g.height and 0 <= c < g.width) or not aoi[r, c]:
            continue
        d = float(dist_m[r, c])
        status = "inside" if d <= g.resolution * 0.5 else ("near" if d <= near_m else "outside")
        rec = {
            "id": f.get("id"), "category": cat, "name": f.get("name") or FACILITY_LABELS.get(cat, cat).rstrip("s"),
            "lon": lon, "lat": lat, "status": status, "distance_m": None if not math.isfinite(d) else round(d, 1),
            "tags": f.get("tags", {}), "row": r, "col": c,
            "hazard_confidence": None if status == "outside" or not np.isfinite(result.confidence[r, c])
            else round(float(result.confidence[r, c]), 3),
        }
        if cat == "settlement":
            settlements.append(rec)
        else:
            facilities.append(rec)
            cc = counts.setdefault(cat, {"inside": 0, "near": 0, "total": 0})
            cc["total"] += 1
            if status in ("inside", "near"):
                cc[status] += 1
    facilities.sort(key=lambda r: ({"inside": 0, "near": 1, "outside": 2}[r["status"]], -FACILITY_WEIGHTS.get(r["category"], 0.3)))

    road_info: dict[str, Any] = {"available": False}
    road_km_px: np.ndarray | None = None
    if infrastructure is not None:
        if roads:
            road_info, road_km_px = road_exposure(g, affected, roads, aoi)
        else:
            road_info = {"available": True, "affected_km_by_class": {}, "total_km_in_aoi_by_class": {},
                         "affected_km": 0.0, "segments": []}
            road_km_px = np.zeros(g.shape, np.float32)

    # --- land cover ---------------------------------------------------------------------
    lc_aff: dict[str, float] | None = None
    built_aff = None
    lc = bundle.context.landcover
    if lc is not None and np.isfinite(lc).any():
        codes = np.nan_to_num(lc, nan=0).astype(np.int32)
        lc_aff = {}
        for code, name in WORLDCOVER_CLASSES.items():
            n = int((affected & (codes == code)).sum())
            if n:
                lc_aff[name] = round(n * px_km2 * 100, 2)  # hectares
        built_aff = round(float((affected & (codes == 50)).sum() * px_km2), 4)
    else:
        limitations.append("Land-cover data unavailable - agricultural / built-up exposure not assessed.")

    # --- population ---------------------------------------------------------------------
    pop_info: dict[str, Any] = {"available": False}
    pop_px: np.ndarray | None = None
    if population is not None and population.available:
        if population.pixel_raster is not None:
            pop_px = np.nan_to_num(population.pixel_raster, nan=0.0).astype(np.float32) * aoi
            exposed = float(pop_px[affected].sum())
            aoi_total = float(pop_px.sum())
            method = population.method or "sum of gridded population inside the affected extent"
        else:
            exposed = population.affected_total
            aoi_total = population.aoi_total
            method = population.method
            if lc is not None and exposed is not None and exposed > 0 and affected.any():
                codes = np.nan_to_num(lc, nan=0).astype(np.int32)
                w = np.zeros(g.shape, np.float32)
                for code, wt in DASYMETRIC_WEIGHTS.items():
                    w[codes == code] = wt
                w_aff = np.where(affected, w, 0.0)
                if w_aff.sum() <= 0:
                    w_aff = affected.astype(np.float32)
                pop_px = (w_aff / w_aff.sum() * exposed).astype(np.float32)
                method += "; per-cell values allocated dasymetrically with ESA WorldCover weights"
        pop_info = {
            "available": exposed is not None,
            "potentially_exposed": None if exposed is None else int(round(exposed)),
            "aoi_total": None if aoi_total is None else int(round(aoi_total)),
            "source": population.source,
            "year": population.year,
            "method": method,
            "note": population.note or "Residents within the detected extent; not a count of affected or displaced people.",
            "provenance": population.provenance,
        }
    else:
        note = population.note if population is not None else "population source not queried"
        pop_info = {"available": False, "note": note, "source": population.source if population else None}
        limitations.append(f"Population exposure unavailable ({note}).")

    return ImpactResult(
        affected_area_km2=round(float(affected.sum() * px_km2), 4),
        population=pop_info,
        facilities=facilities,
        facility_counts=counts,
        roads=road_info,
        settlements=settlements,
        landcover_affected_ha=lc_aff,
        pop_per_pixel=pop_px,
        built_up_affected_km2=built_aff,
        road_km_per_pixel=road_km_px,
        limitations=limitations,
    )
