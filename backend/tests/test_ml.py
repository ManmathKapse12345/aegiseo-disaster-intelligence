from pathlib import Path

import numpy as np
import pytest
import torch

from aegis.ml import augment
from aegis.ml.baselines import otsu_threshold, sar_water_otsu
from aegis.ml.features import FeatureStats, build_s1, build_s2, gamma0_to_sigma0_db, safe_ratio
from aegis.ml.inference import HybridSegmenter, WaterSegmenter, _tile_positions, sar_only_weight
from aegis.ml.metrics import CalibrationAccumulator, Confusion, auroc, reliability
from aegis.ml.models import MODEL_VARIANTS, build_model, forward_variant, trunk_features
from aegis.ml.train import calibration_nll, fit_temperature

from .conftest import MODELS_PRESENT

STATS = FeatureStats()


def test_feature_shapes_and_invalid_pixels_zeroed():
    vv = np.full((8, 8), -10.0, np.float32)
    vh = np.full((8, 8), -17.0, np.float32)
    vv[0, 0] = np.nan
    f1 = build_s1(vv, vh, STATS)
    assert f1.shape == (4, 8, 8) and f1[3, 0, 0] == 0 and np.all(f1[:3, 0, 0] == 0) and f1[3, 1, 1] == 1
    refl = np.full((6, 8, 8), 0.1, np.float32)
    valid = np.ones((8, 8), bool)
    valid[2, 2] = False
    refl[:, 3, 3] = np.nan
    f2 = build_s2(refl, valid, STATS)
    assert f2.shape == (9, 8, 8) and f2[8, 2, 2] == 0 and f2[8, 3, 3] == 0 and np.all(f2[:, 2, 2] == 0)
    with pytest.raises(ValueError):
        build_s2(refl[:5], valid, STATS)


def test_safe_ratio_and_gamma_conversion():
    assert safe_ratio(np.array([0.0]), np.array([0.0]))[0] == 0.0
    assert safe_ratio(np.array([3.0]), np.array([1.0]))[0] == pytest.approx(0.5)
    db = gamma0_to_sigma0_db(np.array([0.1, 0.0, -1.0], np.float32))
    assert db[0] == pytest.approx(-10 + 10 * np.log10(np.cos(np.deg2rad(39))), abs=1e-4)
    assert np.isnan(db[1]) and np.isnan(db[2])


def test_otsu_separates_bimodal_backscatter():
    rng = np.random.default_rng(0)
    vals = np.concatenate([rng.normal(-21, 1.0, 3000), rng.normal(-9, 1.5, 7000)])
    t = otsu_threshold(vals)
    assert -18 < t < -12
    img = vals.reshape(100, 100).astype(np.float32)
    mask, thr = sar_water_otsu(img, "VV")
    assert -23 <= thr <= -15 and 0.25 < mask.mean() < 0.35
    # a scene without water must not be split land/land: the clamp keeps the threshold physical
    land = rng.normal(-8, 2, (100, 100)).astype(np.float32)
    lm, lt = sar_water_otsu(land, "VV")
    assert lt <= -15 and lm.mean() < 0.01
    empty, et = sar_water_otsu(np.full((5, 5), np.nan, np.float32))
    assert not empty.any() and np.isnan(et)


def test_confusion_metrics_ignore_nodata():
    label = np.array([[1, 1, 0, -1]])
    pred = np.array([[1, 0, 1, 1]], bool)
    c = Confusion().update(pred, label)
    assert (c.tp, c.fp, c.fn, c.tn) == (1, 1, 1, 0)
    assert c.iou == pytest.approx(1 / 3) and c.f1 == pytest.approx(0.5)
    assert np.isnan(Confusion().iou)


def test_reliability_perfectly_calibrated_has_low_ece():
    rng = np.random.default_rng(1)
    p = rng.random(200_000)
    y = rng.random(200_000) < p
    r = reliability(p, y)
    assert r["ece"] < 0.01 and r["brier"] < 0.2 and len(r["bins"]) == 15
    over = reliability(np.clip(p * 1.6, 0, 1), y)
    assert over["ece"] > r["ece"] + 0.05
    acc = CalibrationAccumulator(max_samples=1000)
    acc.update(np.full((10, 10), 0.5), np.ones((10, 10), int))
    assert acc.arrays()[0].size == 100


def test_auroc_known_values():
    assert auroc(np.array([0.1, 0.2, 0.8, 0.9]), np.array([0, 0, 1, 1])) == 1.0
    assert auroc(np.array([0.9, 0.8, 0.2, 0.1]), np.array([0, 0, 1, 1])) == 0.0
    assert auroc(np.array([0.5, 0.5, 0.5, 0.5]), np.array([0, 1, 0, 1])) == 0.5
    assert np.isnan(auroc(np.array([1.0, 2.0]), np.array([1, 1])))


def test_temperature_scaling_recovers_true_temperature():
    rng = np.random.default_rng(2)
    z_true = rng.normal(0, 2, 100_000)
    y = (rng.random(z_true.size) < 1 / (1 + np.exp(-z_true))).astype(np.float32)
    logits = z_true * 2.5  # an over-confident model
    t = fit_temperature(logits, y)
    assert t == pytest.approx(2.5, rel=0.08)
    assert calibration_nll(logits, y, t) < calibration_nll(logits, y, 1.0)
    assert fit_temperature(np.zeros(0), np.zeros(0)) == 1.0


def test_cloud_mask_coverage_and_augment_consistency():
    rng = np.random.default_rng(3)
    for cov in (0.2, 0.5, 0.8):
        assert abs(augment.cloud_mask((128, 128), cov, rng).mean() - cov) < 0.05
    assert not augment.cloud_mask((8, 8), 0, rng).any() and augment.cloud_mask((8, 8), 1, rng).all()
    a = np.arange(16).reshape(1, 4, 4)
    b = a * 10
    fa, fb = augment.flip_rotate([a, b], np.random.default_rng(4))
    assert np.array_equal(fa * 10, fb)
    c1, c2 = augment.random_crop([a, b], 2, np.random.default_rng(5))
    assert c1.shape == (1, 2, 2) and np.array_equal(c1 * 10, c2)


@pytest.mark.parametrize("variant", sorted(MODEL_VARIANTS))
def test_model_variants_forward(variant):
    torch.manual_seed(0)
    m = build_model(variant).eval()
    s1, s2 = torch.randn(2, 4, 64, 64), torch.randn(2, 9, 64, 64)
    s1[:, -1], s2[:, -1] = 1, 1
    logits, gate = forward_variant(m, variant, s1, s2, return_gate=True)
    assert logits.shape == (2, 1, 64, 64) and torch.isfinite(logits).all()
    feats, _ = trunk_features(m, variant, s1, s2)
    assert feats.shape[-2:] == (64, 64)
    assert (gate is not None) == variant.startswith("gated")
    with pytest.raises(ValueError):
        build_model("nonexistent")


def test_gated_fusion_hard_constraints():
    m = build_model("gated_fusion_unet").eval()
    s1, s2 = torch.randn(1, 4, 32, 32), torch.randn(1, 9, 32, 32)
    s1[:, -1] = 1
    s2[:, -1] = 0  # optical invalid everywhere -> SAR gate must be exactly 1
    _, gate = m(s1, s2, return_gate=True)
    assert torch.allclose(gate, torch.ones_like(gate))
    s1[:, -1], s2[:, -1] = 0, 1  # SAR invalid -> optical only
    _, gate = m(s1, s2, return_gate=True)
    assert torch.allclose(gate, torch.zeros_like(gate))


def test_tile_positions_cover_extent():
    assert _tile_positions(100, 512, 448) == [0]
    pos = _tile_positions(1000, 512, 448)
    assert pos[0] == 0 and pos[-1] == 1000 - 512 and all(b - a <= 448 for a, b in zip(pos, pos[1:], strict=False))


def test_classical_fallback_without_checkpoint(tmp_path):
    seg = WaterSegmenter(Path(tmp_path), "gated_fusion_unet")
    assert not seg.available and "checkpoint not found" in seg.load_error
    vv = np.where(np.arange(64)[None, :] < 32, -22.0, -8.0).repeat(64, 0).astype(np.float32)
    f1 = build_s1(vv, vv - 7, STATS)
    res = seg.predict(f1, None)
    assert res.method == "classical_fallback"
    assert res.prob[:, :32].mean() > 0.8 and res.prob[:, 32:].mean() < 0.2
    assert seg.info()["variant"] == "classical_fallback"


def test_sar_only_weight():
    v1 = np.ones((20, 20), bool)
    v2 = np.ones((20, 20), bool)
    v2[:, :10] = False
    w = sar_only_weight(v1, v2)
    assert w[:, :10].min() == 1.0 and w[:, -1].max() < 0.05 and 0 < w[0, 11] < 1
    v1[:] = False
    assert sar_only_weight(v1, v2).max() == 0


@pytest.mark.skipif(not MODELS_PRESENT, reason="trained checkpoints not present")
def test_trained_model_inference_deterministic_and_tiled(flood_scene):
    from aegis.config import REPO_ROOT

    seg = WaterSegmenter(REPO_ROOT / "models", "gated_fusion_unet", device="cpu", mc_samples=4)
    b = flood_scene.bundle
    s1, s2 = b.get("S1", "post"), b.get("S2", "post")
    f1 = build_s1(s1.bands["vv_db"], s1.bands["vh_db"], seg.stats)
    f2 = build_s2(np.stack([s2.bands[k] for k in ("B02", "B03", "B04", "B08", "B11", "B12")]), s2.valid, seg.stats)
    r1 = seg.predict(f1, f2)
    r2 = seg.predict(f1, f2)
    assert r1.method == "deep_fusion_model" and np.array_equal(r1.prob, r2.prob)  # reproducible MC dropout
    small = seg.predict(f1, f2, tile=128, overlap=32)
    assert np.nanmean(np.abs(small.prob - r1.prob)) < 0.03  # tiling does not change the answer materially
    flood = b.truth["flood"] | b.truth["permanent_water"]
    assert np.nanmean(r1.prob[flood]) > 0.7 and np.nanmean(r1.prob[~flood]) < 0.2
    hyb = HybridSegmenter(seg, WaterSegmenter(REPO_ROOT / "models", "s1_unet", device="cpu", mc_samples=2))
    rh = hyb.predict(f1, f2)
    assert rh.model_info["sar_specialist_fraction"] > 0 and np.isfinite(rh.prob).all()
