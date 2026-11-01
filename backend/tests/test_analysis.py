from pathlib import Path

import numpy as np
import pytest

from aegis.analysis import indices
from aegis.analysis.bundle import SceneBundle
from aegis.analysis.hazards import DetectionParams, InsufficientDataError, detect_burn, detect_flood, detect_landslide
from aegis.analysis.impact import PopulationEstimate, assess_impact
from aegis.analysis.prioritize import PriorityConfig, PriorityWeights, category_for, prioritize
from aegis.analysis.sar import lee_filter_db, log_ratio_db
from aegis.analysis.terrain import height_above_local_drainage, slope_degrees
from aegis.ml.inference import WaterSegmenter
from aegis.ml.metrics import Confusion
from aegis.synthetic import SyntheticConfig, make_scene


def iou(pred, truth, aoi):
    return Confusion().update(pred & aoi, np.where(aoi, truth.astype(int), -1)).iou


def fallback():
    return WaterSegmenter(Path("does-not-exist"))


def test_indices_and_dnbr_classes():
    b = {"B03": np.array([0.1]), "B04": np.array([0.05]), "B08": np.array([0.4]), "B11": np.array([0.2]), "B12": np.array([0.1])}
    assert indices.ndvi(b)[0] == pytest.approx(0.7778, abs=1e-3)
    assert indices.mndwi(b)[0] < 0 and indices.nbr(b)[0] == pytest.approx(0.6)
    nan = {k: np.array([np.nan]) for k in b}
    assert np.isnan(indices.ndwi(nan)[0])
    classes = indices.classify_dnbr(np.array([0.05, 0.2, 0.3, 0.5, 0.8, np.nan]))
    assert classes.tolist() == [0, 1, 2, 3, 4, -1]


def test_lee_filter_reduces_speckle_and_keeps_nan():
    rng = np.random.default_rng(0)
    lin = 0.1 * rng.gamma(4.4, 1 / 4.4, (64, 64))
    db = (10 * np.log10(lin)).astype(np.float32)
    db[5, 5] = np.nan
    f = lee_filter_db(db)
    assert np.isnan(f[5, 5]) and np.nanstd(f) < np.nanstd(db) * 0.7
    assert abs(np.nanmean(10 ** (f / 10)) - 0.1) < 0.01  # linear-domain mean preserved
    lr = log_ratio_db(np.array([-20.0, np.nan]), np.array([-10.0, -10.0]))
    assert lr[0] == -10 and np.isnan(lr[1])


def test_terrain_derivatives():
    x = np.arange(50, dtype=np.float32)
    plane = np.tile(x * 20 * np.tan(np.deg2rad(10)), (50, 1))  # 10 degree slope at 20 m pixels
    assert np.nanmedian(slope_degrees(plane, 20)) == pytest.approx(10, abs=0.2)
    valley = np.abs(np.arange(100) - 50)[None, :].repeat(20, 0).astype(np.float32)
    hand = height_above_local_drainage(valley, 20, window_m=400)
    assert hand[:, 50].max() == 0 and hand[:, 0].min() > 0


def test_flood_detection_on_synthetic_scene_with_classical_fallback(flood_scene):
    b = flood_scene.bundle
    res = detect_flood(b, fallback())
    assert iou(res.affected, b.truth["flood"], b.aoi_mask) > 0.8
    assert res.quality["model_method"] == "classical_fallback"
    assert not (res.affected & b.truth["permanent_water"]).any()  # permanent water never reported as flood
    assert res.quality["cross_method_agreement"] > 0.9
    assert {"flood_probability", "uncertainty", "affected", "sar_change_db"} <= set(res.layers)
    assert any("classical" in lim for lim in res.limitations)


def test_flood_insufficient_data_paths():
    sc = make_scene(SyntheticConfig(hazard="flood", seed=2, include_s1=False, cloud_cover_post=1.0))
    with pytest.raises(InsufficientDataError):
        detect_flood(sc.bundle, fallback())
    empty = SceneBundle(grid=sc.bundle.grid, aoi_mask=sc.bundle.aoi_mask)
    with pytest.raises(InsufficientDataError):
        detect_flood(empty, fallback())


def test_flood_without_pre_event_uses_occurrence_prior():
    sc = make_scene(SyntheticConfig(hazard="flood", seed=17, include_pre=False))
    res = detect_flood(sc.bundle, fallback())
    assert any("No pre-event" in lim for lim in res.limitations)
    assert iou(res.affected, sc.bundle.truth["flood"], sc.bundle.aoi_mask) > 0.6


def test_burn_and_landslide_detection():
    sc = make_scene(SyntheticConfig(hazard="wildfire", seed=3, cloud_cover_post=0.1))
    r = detect_burn(sc.bundle, hotspots=sc.hotspots)
    assert iou(r.affected, sc.bundle.truth["burn"], sc.bundle.aoi_mask) > 0.6
    assert r.quality["hotspot_corroboration"]["hotspots_within_750m_of_burn"] > 0
    assert sum(r.stats["severity_area_km2"].values()) == pytest.approx(r.stats["affected_area_km2"], rel=0.02)
    sl = make_scene(SyntheticConfig(hazard="landslide", seed=3, cloud_cover_post=0.1))
    rl = detect_landslide(sl.bundle)
    assert iou(rl.affected, sl.bundle.truth["landslide"], sl.bundle.aoi_mask) > 0.4
    assert rl.quality["requires_verification"] is True
    nodem = SceneBundle(grid=sl.bundle.grid, aoi_mask=sl.bundle.aoi_mask, observations=sl.bundle.observations)
    with pytest.raises(InsufficientDataError):
        detect_landslide(nodem)


def _impact(scene, infra=True, pop=True):
    res = detect_flood(scene.bundle, fallback())
    pe = PopulationEstimate(True, "synthetic", pixel_raster=scene.bundle.context.population) if pop else None
    return res, assess_impact(res, scene.bundle, scene.infrastructure if infra else None, pe)


def test_impact_assessment(flood_scene):
    res, imp = _impact(flood_scene)
    hosp = next(f for f in imp.facilities if f["name"].startswith("Riverside General"))
    assert hosp["status"] == "inside"
    assert imp.population["potentially_exposed"] > 0
    assert imp.population["potentially_exposed"] <= imp.population["aoi_total"]
    assert imp.roads["affected_km"] > 0 and imp.road_km_per_pixel.sum() == pytest.approx(imp.roads["affected_km"], rel=0.01)
    assert "Cropland" in imp.landcover_affected_ha
    _, none = _impact(flood_scene, infra=False, pop=False)
    assert not none.roads["available"] and not none.population["available"] and none.limitations


def test_prioritisation_logic(flood_scene):
    res, imp = _impact(flood_scene)
    pri = prioritize(res, imp, flood_scene.bundle)
    cells = pri["cells"]
    assert cells and [c["rank"] for c in cells] == list(range(1, len(cells) + 1))
    assert all(cells[i]["score"] >= cells[i + 1]["score"] for i in range(len(cells) - 1) if not cells[i]["floor_rule_applied"])
    hosp_cell = next(c for c in cells if any(f["name"].startswith("Riverside General") and f["status"] == "inside" for f in c["facilities"]))
    assert hosp_cell["category"] in ("Critical", "High")
    for c in cells:
        assert set(c["contributions"]) == {"hazard", "exposure"}
        assert sum(c["contributions"]["hazard"].values()) * 100 == pytest.approx(c["hazard_subscore"], abs=0.1)
        assert c["explanation"] and c["recommended_actions"]
    assert pri["sensitivity"]["mean_spearman_rho"] > 0.8
    assert sum(pri["distribution"].values()) == len(cells)


def test_priority_without_exposure_is_low(flood_scene):
    res, _ = _impact(flood_scene)
    empty_pop = PopulationEstimate(True, "zero", pixel_raster=np.zeros(flood_scene.bundle.grid.shape, np.float32))
    imp = assess_impact(res, flood_scene.bundle, [], empty_pop)
    pri = prioritize(res, imp, flood_scene.bundle)
    assert all(c["category"] == "Low" and c["score"] == 0 for c in pri["cells"])


def test_priority_weights_validation_and_categories():
    with pytest.raises(ValueError):
        PriorityWeights(extent=0, intensity=0).validate()
    with pytest.raises(ValueError):
        PriorityWeights(hazard_exponent=1.0).validate()
    with pytest.raises(ValueError):
        PriorityWeights(population=float("nan")).validate()
    th = PriorityConfig().thresholds
    assert [category_for(s, th) for s in (90, 60, 35, 5)] == ["Critical", "High", "Moderate", "Low"]


def test_cell_size_does_not_inflate_scores(flood_scene):
    res, imp = _impact(flood_scene)
    s05 = prioritize(res, imp, flood_scene.bundle, config=PriorityConfig(cell_km=0.5, sensitivity_samples=0))
    s10 = prioritize(res, imp, flood_scene.bundle, config=PriorityConfig(cell_km=1.0, sensitivity_samples=0))
    m05 = max(c["score"] for c in s05["cells"])
    m10 = max(c["score"] for c in s10["cells"])
    assert abs(m05 - m10) < 25  # density-based references keep scales comparable


def test_detection_params_affect_extent(flood_scene):
    low = detect_flood(flood_scene.bundle, fallback(), DetectionParams(prob_threshold=0.3))
    high = detect_flood(flood_scene.bundle, fallback(), DetectionParams(prob_threshold=0.8))
    assert low.affected.sum() >= high.affected.sum()
