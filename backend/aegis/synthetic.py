"""Synthetic multi-sensor disaster scenes - SIMULATED DATA, never real observations.

Purpose: deterministic scenes with known ground truth for automated tests, closed-loop
agent benchmarks and an offline demonstration mode.

To make confusion with real geography impossible, every synthetic scene is located at
"Null Island" (0 N, 0 E) - a GIS placeholder location that is open ocean in the Gulf of
Guinea - and every product derived from it is labelled ``synthetic``.

The generator models the physics that matter for the analysis chain:
* terrain: a sinuous valley with a river, hills and a lake (DEM in metres)
* land cover: built-up towns, cropland on the floodplain, forest on hills
* Sentinel-2-like reflectance per class with texture, clouds and offset cloud shadows
* Sentinel-1-like sigma0 per class with multiplicative Gamma speckle (ENL 4.4) and the
  double-bounce brightening of flooded built-up areas (a real SAR limitation)
* hazards: flood (water level rise connected to the river), wildfire (burn severity
  gradient, NIR drop / SWIR rise, VH decrease), landslide (vegetation-stripped scars on
  steep slopes)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

import numpy as np
from scipy import ndimage

from aegis.analysis.bundle import ContextLayers, SceneBundle, SensorObservation
from aegis.geo.aoi import AOI
from aegis.geo.grid import Grid

SYNTHETIC_BBOX = (0.02, 0.02, 0.10, 0.10)
SYNTHETIC_LABEL = "SIMULATED DATA - synthetic scene at Null Island (0N 0E); not a real place or event"

# class codes (subset of ESA WorldCover legend)
TREE, SHRUB, GRASS, CROP, BUILT, BARE, WATER = 10, 20, 30, 40, 50, 60, 80

# Sentinel-2 surface reflectance (B02, B03, B04, B08, B11, B12) per surface type
S2_SIGNATURES: dict[str, tuple[float, ...]] = {
    "water": (0.060, 0.070, 0.050, 0.030, 0.015, 0.010),
    "flood": (0.090, 0.110, 0.100, 0.060, 0.030, 0.020),
    "crop": (0.050, 0.080, 0.060, 0.350, 0.220, 0.120),
    "tree": (0.030, 0.050, 0.030, 0.300, 0.150, 0.070),
    "grass": (0.050, 0.080, 0.070, 0.280, 0.250, 0.150),
    "built": (0.120, 0.130, 0.140, 0.200, 0.250, 0.220),
    "bare": (0.120, 0.140, 0.160, 0.220, 0.300, 0.250),
    "burn_low": (0.045, 0.060, 0.060, 0.200, 0.200, 0.140),
    "burn_high": (0.040, 0.045, 0.050, 0.090, 0.200, 0.230),
    "cloud": (0.450, 0.450, 0.470, 0.500, 0.400, 0.300),
}
# Sentinel-1 sigma0 (VV, VH) in dB per surface type
S1_SIGNATURES: dict[str, tuple[float, float]] = {
    "water": (-22.0, -28.0),
    "flood": (-20.0, -27.0),
    "flooded_built": (-1.5, -8.0),
    "crop": (-11.0, -17.0),
    "tree": (-7.5, -12.5),
    "grass": (-10.0, -17.0),
    "built": (-3.0, -9.0),
    "bare": (-12.5, -20.0),
    "burn": (-9.0, -16.0),
}


@dataclass
class SyntheticConfig:
    hazard: Literal["flood", "wildfire", "landslide"] = "flood"
    seed: int = 7
    resolution_m: float = 20.0
    cloud_cover_pre: float = 0.05
    cloud_cover_post: float = 0.30
    include_s1: bool = True
    include_s2: bool = True
    include_pre: bool = True
    flood_level_m: float = 5.0
    event_date: datetime = field(default_factory=lambda: datetime(2024, 8, 20, tzinfo=UTC))
    s1_same_orbit: bool = True
    corrupt_s2_post: bool = False   # simulate a corrupted acquisition (failure testing)


@dataclass
class SyntheticScene:
    bundle: SceneBundle
    aoi: AOI
    infrastructure: list[dict[str, Any]]
    hotspots: list[dict[str, Any]]
    config: SyntheticConfig
    label: str = SYNTHETIC_LABEL


def _smooth_noise(rng: np.random.Generator, shape: tuple[int, int], scale: float) -> np.ndarray:
    h, w = shape
    gh, gw = max(2, int(h / scale)), max(2, int(w / scale))
    small = rng.standard_normal((gh, gw))
    big = ndimage.zoom(small, (h / gh, w / gw), order=3)[:h, :w]
    big = ndimage.gaussian_filter(big, 1.0)
    return (big - big.mean()) / (big.std() + 1e-9)


def _blobs(rng: np.random.Generator, shape: tuple[int, int], coverage: float, scale: float = 18) -> np.ndarray:
    if coverage <= 0:
        return np.zeros(shape, dtype=bool)
    field_ = _smooth_noise(rng, shape, scale)
    return field_ > np.quantile(field_, 1.0 - min(coverage, 0.999))


def _speckle_db(db: np.ndarray, rng: np.random.Generator, looks: float = 4.4) -> np.ndarray:
    lin = 10 ** (db / 10.0)
    noisy = lin * rng.gamma(looks, 1.0 / looks, size=db.shape)
    return (10 * np.log10(np.maximum(noisy, 1e-6))).astype(np.float32)


def _pix_to_lonlat(grid: Grid, r: float, c: float) -> tuple[float, float]:
    x = grid.transform.c + (c + 0.5) * grid.resolution
    y = grid.transform.f - (r + 0.5) * grid.resolution
    lon, lat = grid.to_wgs84.transform(x, y)
    return float(lon), float(lat)


def make_scene(cfg: SyntheticConfig | None = None) -> SyntheticScene:
    cfg = cfg or SyntheticConfig()
    rng = np.random.default_rng(cfg.seed)
    aoi = AOI.from_bbox(*SYNTHETIC_BBOX)
    grid = Grid.for_aoi(aoi, cfg.resolution_m, 4_000_000)
    H, W = grid.shape
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    yn, xn = yy / H, xx / W

    # --- terrain -------------------------------------------------------------------
    phase = rng.uniform(0, 2 * np.pi)
    centre = 0.5 + 0.13 * np.sin(2 * np.pi * 1.2 * yn + phase)
    dist = np.abs(xn - centre)
    # gentle floodplain for floods, hills for wildfire, steep mountains (15-35 deg) for landslides
    relief = {"flood": 120.0, "wildfire": 450.0, "landslide": 1400.0}[cfg.hazard]
    dem = 25 + relief * dist**1.25 + 6 * _smooth_noise(rng, (H, W), 40) + 30 * np.clip(_smooth_noise(rng, (H, W), 90), 0, None)
    if cfg.hazard == "landslide":
        dem += 90 * _smooth_noise(rng, (H, W), 12) * np.clip(dist * 6, 0, 1)  # ridges and gullies
    river = dist < 0.010
    lake_c = (0.25 + 0.5 * rng.random(), 0.15 if centre[int(0.2 * H), 0] > 0.5 else 0.85)
    lake = ((yn - lake_c[0]) / 0.05) ** 2 + ((xn - lake_c[1]) / 0.035) ** 2 < 1
    dem = np.where(lake, np.minimum(dem, 24.0), dem)
    dem = np.where(river, 22.0, dem).astype(np.float32)
    permanent = river | lake

    # --- land cover ------------------------------------------------------------------
    lc = np.full((H, W), GRASS, dtype=np.int16)
    lc[(dem < 45) & ~permanent] = CROP
    lc[dem > 70] = TREE
    # two towns: one on the floodplain edge, one on higher ground; three villages
    towns = []
    t1 = (int(0.55 * H), int((centre[int(0.55 * H), 0] + 0.045) * W))  # western edge lies on the floodplain
    t2 = (int(0.22 * H), int((centre[int(0.22 * H), 0] - 0.22) * W))
    villages = [(int(f * H), int((centre[int(f * H), 0] + off) * W)) for f, off in ((0.8, -0.05), (0.38, 0.16), (0.92, 0.2))]
    for (r, c), rad in ((t1, 0.06), (t2, 0.05)):
        m = ((yy - r) / (rad * H)) ** 2 + ((xx - c) / (rad * W)) ** 2 < 1
        lc[m & ~permanent] = BUILT
        towns.append((r, c))
    for r, c in villages:
        m = ((yy - r) / (0.018 * H)) ** 2 + ((xx - c) / (0.018 * W)) ** 2 < 1
        lc[m & ~permanent] = BUILT
    lc[permanent] = WATER
    built = lc == BUILT

    # population per pixel (20 m pixel = 400 m2): ~10,000 /km2 in towns
    density = np.where(built, 4.0, np.where(lc == CROP, 0.04, 0.01)) * np.exp(0.3 * _smooth_noise(rng, (H, W), 15))
    population = rng.poisson(density).astype(np.float32)

    # --- hazard footprints -----------------------------------------------------------
    truth: dict[str, np.ndarray] = {"permanent_water": permanent}
    flood = np.zeros((H, W), dtype=bool)
    burn_sev = np.zeros((H, W), dtype=np.float32)
    scars = np.zeros((H, W), dtype=bool)
    if cfg.hazard == "flood":
        candidate = (dem < 22.0 + cfg.flood_level_m) & ~permanent
        lab, _ = ndimage.label(candidate | river)
        river_labels = np.unique(lab[river])
        flood = np.isin(lab, river_labels[river_labels > 0]) & candidate
        flood |= _blobs(rng, (H, W), 0.01, 6) & (dem < 40) & ~permanent  # isolated ponding
        truth["flood"] = flood
    elif cfg.hazard == "wildfire":
        veg = np.isin(lc, (TREE, GRASS))
        burn = _blobs(rng, (H, W), 0.18, 30) & veg & (dem > 55)
        burn = ndimage.binary_opening(burn, iterations=2)
        core = ndimage.distance_transform_edt(burn)
        burn_sev = np.where(burn, np.clip(0.15 + core / (core.max() + 1e-9) * 0.75, 0, 0.95), 0).astype(np.float32)
        truth["burn"] = burn
        truth["burn_severity_dnbr"] = burn_sev
    else:  # landslide
        slope = np.degrees(np.arctan(np.hypot(*np.gradient(dem, grid.resolution))))
        seeds = np.argwhere((slope > 18) & (lc == TREE))
        if len(seeds):
            for k in rng.choice(len(seeds), size=min(6, len(seeds)), replace=False):
                r, c = seeds[k]
                length, width = rng.integers(18, 35), rng.integers(4, 7)
                gy, gx = np.gradient(dem)
                ang = np.arctan2(-gy[r, c], -gx[r, c])
                for t in range(length):
                    rr, cc = int(r + t * np.sin(ang)), int(c + t * np.cos(ang))
                    rr0, rr1 = max(0, rr - width // 2), min(H, rr + width // 2 + 1)
                    cc0, cc1 = max(0, cc - width // 2), min(W, cc + width // 2 + 1)
                    scars[rr0:rr1, cc0:cc1] = True
        scars &= ~permanent
        truth["landslide"] = scars

    # --- optical ---------------------------------------------------------------------
    def s2_image(epoch: str) -> tuple[np.ndarray, np.ndarray, float]:
        refl = np.zeros((6, H, W), np.float32)
        types = {
            "water": permanent, "crop": lc == CROP, "tree": lc == TREE, "grass": lc == GRASS, "built": built,
        }
        for name, m in types.items():
            refl[:, m] = np.array(S2_SIGNATURES[name], np.float32)[:, None]
        if epoch == "post":
            if cfg.hazard == "flood":
                refl[:, flood] = np.array(S2_SIGNATURES["flood"], np.float32)[:, None]
            elif cfg.hazard == "wildfire":
                lo, hi = np.array(S2_SIGNATURES["burn_low"]), np.array(S2_SIGNATURES["burn_high"])
                b = burn_sev > 0
                w = np.clip((burn_sev[b] - 0.15) / 0.8, 0, 1)
                refl[:, b] = (lo[:, None] * (1 - w) + hi[:, None] * w).astype(np.float32)
            else:
                refl[:, scars] = np.array(S2_SIGNATURES["bare"], np.float32)[:, None]
        texture = 1 + 0.06 * _smooth_noise(rng, (H, W), 8)
        refl = refl * texture + rng.normal(0, 0.006, refl.shape).astype(np.float32)
        cover = cfg.cloud_cover_post if epoch == "post" else cfg.cloud_cover_pre
        cloud = _blobs(rng, (H, W), cover, 22)
        shadow = np.roll(np.roll(cloud, 12, axis=0), -9, axis=1) & ~cloud
        refl[:, shadow] *= 0.35
        refl[:, cloud] = np.array(S2_SIGNATURES["cloud"], np.float32)[:, None] * (1 + 0.05 * rng.standard_normal(int(cloud.sum())))
        valid = ~(cloud | shadow)
        return np.clip(refl, 0, 1.2).astype(np.float32), valid, float((cloud | shadow).mean())

    # --- SAR -------------------------------------------------------------------------
    def s1_image(epoch: str) -> tuple[np.ndarray, np.ndarray]:
        vv = np.zeros((H, W), np.float32)
        vh = np.zeros((H, W), np.float32)
        types = {"water": permanent, "crop": lc == CROP, "tree": lc == TREE, "grass": lc == GRASS, "built": built}
        for name, m in types.items():
            vv[m], vh[m] = S1_SIGNATURES[name]
        if epoch == "post":
            if cfg.hazard == "flood":
                open_flood = flood & ~built
                vv[open_flood], vh[open_flood] = S1_SIGNATURES["flood"]
                fb = flood & built
                vv[fb], vh[fb] = S1_SIGNATURES["flooded_built"]
            elif cfg.hazard == "wildfire":
                b = burn_sev > 0
                vh[b] -= 1.5 + 2.0 * burn_sev[b]
                vv[b] -= 0.5 + 1.0 * burn_sev[b]
            else:
                vv[scars], vh[scars] = S1_SIGNATURES["bare"]
        # incidence/orbit geometry difference if pre/post come from different relative orbits
        if epoch == "post" and not cfg.s1_same_orbit:
            vv += 1.5 * _smooth_noise(rng, (H, W), 20)
            vh += 1.5 * _smooth_noise(rng, (H, W), 20)
        vv += 0.8 * _smooth_noise(rng, (H, W), 10)
        vh += 0.8 * _smooth_noise(rng, (H, W), 10)
        return _speckle_db(vv, rng), _speckle_db(vh, rng)

    aoi_mask = grid.aoi_mask(aoi)
    bundle = SceneBundle(grid=grid, aoi_mask=aoi_mask, synthetic=True, truth=truth)
    pre_t = cfg.event_date - timedelta(days=11)
    post_t = cfg.event_date + timedelta(days=2)
    epochs = (("pre", pre_t), ("post", post_t)) if cfg.include_pre else (("post", post_t),)
    for role, when in epochs:
        if cfg.include_s2:
            refl, valid, cloud_frac = s2_image(role)
            if role == "post" and cfg.corrupt_s2_post:
                refl[:, : H // 2] = np.nan  # half the acquisition unreadable
                valid[: H // 2] = False
            bands = {b: refl[i] for i, b in enumerate(("B02", "B03", "B04", "B08", "B11", "B12"))}
            bundle.observations[("S2", role)] = SensorObservation(
                sensor="S2", role=role, acquired_at=when + timedelta(hours=10, minutes=30),
                collection="synthetic-sentinel-2-l2a", item_ids=[f"SYNTH_S2_{role.upper()}_{cfg.seed}"],
                bands=bands, valid=valid & np.all(np.isfinite(refl), axis=0), cloud_fraction=cloud_frac,
                valid_fraction=float((valid & aoi_mask).sum() / max(1, aoi_mask.sum())),
                meta={"processing_baseline": "synthetic", "platform": "synthetic"}, synthetic=True,
            )
        if cfg.include_s1:
            vv, vh = s1_image(role)
            bundle.observations[("S1", role)] = SensorObservation(
                sensor="S1", role=role, acquired_at=when + timedelta(hours=5, minutes=50),
                collection="synthetic-sentinel-1-rtc", item_ids=[f"SYNTH_S1_{role.upper()}_{cfg.seed}"],
                bands={"vv_db": vv, "vh_db": vh}, valid=np.isfinite(vv) & np.isfinite(vh),
                valid_fraction=1.0,
                meta={"orbit_state": "descending",
                      "relative_orbit": 78 if (role == "pre" or cfg.s1_same_orbit) else 151,
                      "platform": "synthetic"},
                synthetic=True,
            )
    occurrence = np.where(permanent, 95.0, np.where(dist < 0.02, 30.0, 0.0)).astype(np.float32)
    bundle.context = ContextLayers(
        dem=dem, water_occurrence=occurrence, landcover=lc.astype(np.float32), population=population,
        provenance={"dem": "synthetic", "water_occurrence": "synthetic", "landcover": "synthetic", "population": "synthetic"},
    )

    # --- infrastructure (OSM-like features, synthetic) ----------------------------------
    infra: list[dict[str, Any]] = []

    def add_point(cat: str, name: str, r: float, c: float, **tags: Any) -> None:
        lon, lat = _pix_to_lonlat(grid, r, c)
        infra.append({"id": f"synthetic/{cat}/{len(infra)}", "category": cat, "name": name,
                      "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
                      "tags": {"synthetic": "yes", **tags}})

    (r1, c1), (r2, c2) = t1, t2
    hr, hc = r1, c1 - 0.02 * W
    if cfg.hazard == "flood" and flood.any():
        # the riverside hospital stands on the inundated (non built-up) fringe of the floodplain town
        cand = np.argwhere(flood & ~built & ~np.isin(lc, (WATER,)))
        k = int(np.argmin((cand[:, 0] - r1) ** 2 + (cand[:, 1] - c1) ** 2))
        hr, hc = float(cand[k, 0]), float(cand[k, 1])
    add_point("hospital", "Riverside General Hospital (synthetic)", hr, hc, beds="120")
    add_point("hospital", "Hillcrest District Hospital (synthetic)", r2, c2)
    add_point("clinic", "Southbank Health Post (synthetic)", villages[0][0], villages[0][1])
    for k, (r, c) in enumerate([(r1 + 0.03 * H, c1), (r1 - 0.04 * H, c1 + 0.02 * W), (r2 + 0.02 * H, c2 - 0.02 * W),
                               villages[1], villages[2]]):
        add_point("school", f"Primary School No. {k + 1} (synthetic)", r, c)
    add_point("fire_station", "Valley Fire & Rescue (synthetic)", r1 + 0.05 * H, c1 + 0.03 * W)
    add_point("shelter", "Community Hall Shelter (synthetic)", r2 - 0.03 * H, c2 + 0.03 * W)
    add_point("power", "Valley Substation (synthetic)", int(0.65 * H), int((centre[int(0.65 * H), 0] + 0.04) * W))
    add_point("water_works", "Valley Water Treatment Works (synthetic)", int(0.45 * H), int((centre[int(0.45 * H), 0] - 0.05) * W))
    for name, (r, c), pop in (("Riverside (synthetic town)", t1, 18000), ("Hillcrest (synthetic town)", t2, 12000)):
        add_point("settlement", name, r, c, place="town", population=str(pop))
    for k, (r, c) in enumerate(villages):
        add_point("settlement", f"Village {k + 1} (synthetic)", r, c, place="village", population=str(1500 + 500 * k))
    # main road along the valley (just east of the river) and a road between towns
    road = []
    for f in np.linspace(0.0, 1.0, 40):
        r = f * (H - 1)
        c = (centre[min(H - 1, int(r)), 0] + 0.045) * W
        road.append(list(map(lambda v: round(v, 6), _pix_to_lonlat(grid, r, c))))
    infra.append({"id": "synthetic/road/main", "category": "road", "name": "Valley Highway (synthetic)",
                  "geometry": {"type": "LineString", "coordinates": road}, "tags": {"highway": "primary", "synthetic": "yes"}})
    link = [list(map(lambda v: round(v, 6), _pix_to_lonlat(grid, r1 + (r2 - r1) * f, c1 + (c2 - c1) * f))) for f in np.linspace(0, 1, 25)]
    infra.append({"id": "synthetic/road/link", "category": "road", "name": "Town Link Road (synthetic)",
                  "geometry": {"type": "LineString", "coordinates": link}, "tags": {"highway": "secondary", "synthetic": "yes"}})

    hotspots: list[dict[str, Any]] = []
    if cfg.hazard == "wildfire" and truth.get("burn") is not None and truth["burn"].any():
        pts = np.argwhere(truth["burn"])
        for k in rng.choice(len(pts), size=min(25, len(pts)), replace=False):
            r, c = pts[k]
            lon, lat = _pix_to_lonlat(grid, r, c)
            hotspots.append({"lon": lon, "lat": lat, "acq_datetime": (cfg.event_date + timedelta(hours=14)).isoformat(),
                             "confidence": "n", "frp": float(rng.uniform(5, 80)), "satellite": "synthetic"})
    return SyntheticScene(bundle=bundle, aoi=aoi, infrastructure=infra, hotspots=hotspots, config=cfg)
