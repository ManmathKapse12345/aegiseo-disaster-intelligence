"""Convert the raw Sen1Floods11 GeoTIFF chips into compact memory-mapped arrays.

Output (per split ``train|valid|test|bolivia``) in ``<out_dir>``::

    {split}_s1.npy     float16 (N, 2, 512, 512)  VV, VH sigma0 [dB], NaN = no data
    {split}_s2.npy     uint16  (N, 6, 512, 512)  B02 B03 B04 B08 B11 B12, TOA reflectance x 1e4, 0 = no data
    {split}_label.npy  int8    (N, 512, 512)     -1 no data, 0 not water, 1 water
    {split}_jrc.npy    uint8   (N, 512, 512)     JRC permanent water
    {split}_ids.json   chip ids in array order

``feature_stats.json`` holds channel statistics computed **on the training split only**
(no information from validation/test leaks into normalisation), and
``dataset_card.json`` documents class balance and data validity per split.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path

import numpy as np
import rasterio

from aegis.ml.features import S2_BANDS, SEN1FLOODS11_S2_INDEX, FeatureStats

CHIP = 512


def _read(path: Path) -> np.ndarray:
    with rasterio.open(path) as src:
        return src.read()


def prepare(raw_dir: Path, out_dir: Path) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    splits: dict[str, list[str]] = json.loads((raw_dir / "splits.json").read_text())
    band_idx = [SEN1FLOODS11_S2_INDEX[b] for b in S2_BANDS]
    card: dict[str, dict] = {}
    for split, ids in splits.items():
        n = len(ids)
        s1 = np.lib.format.open_memmap(out_dir / f"{split}_s1.npy", mode="w+", dtype=np.float16, shape=(n, 2, CHIP, CHIP))
        s2 = np.lib.format.open_memmap(out_dir / f"{split}_s2.npy", mode="w+", dtype=np.uint16, shape=(n, 6, CHIP, CHIP))
        lab = np.lib.format.open_memmap(out_dir / f"{split}_label.npy", mode="w+", dtype=np.int8, shape=(n, CHIP, CHIP))
        jrc = np.lib.format.open_memmap(out_dir / f"{split}_jrc.npy", mode="w+", dtype=np.uint8, shape=(n, CHIP, CHIP))
        counts = Counter()
        s1_invalid = s2_invalid = 0.0
        for i, chip in enumerate(ids):
            a1 = _read(raw_dir / "S1Hand" / f"{chip}_S1Hand.tif").astype(np.float32)
            a1[~np.isfinite(a1)] = np.nan
            s1[i] = a1.astype(np.float16)
            a2 = _read(raw_dir / "S2Hand" / f"{chip}_S2Hand.tif")[band_idx].astype(np.int32)
            s2[i] = np.clip(a2, 0, 65535).astype(np.uint16)
            lb = _read(raw_dir / "LabelHand" / f"{chip}_LabelHand.tif")[0]
            lab[i] = lb.astype(np.int8)
            jrc[i] = _read(raw_dir / "JRCWaterHand" / f"{chip}_JRCWaterHand.tif")[0].astype(np.uint8)
            vals, cnts = np.unique(lb, return_counts=True)
            counts.update(dict(zip(vals.tolist(), cnts.tolist(), strict=True)))
            s1_invalid += float(np.mean(~np.isfinite(a1).all(axis=0)))
            s2_invalid += float(np.mean((a2 == 0).any(axis=0)))
        for arr in (s1, s2, lab, jrc):
            arr.flush()
        (out_dir / f"{split}_ids.json").write_text(json.dumps(ids))
        total = sum(counts.values())
        card[split] = {
            "chips": n,
            "events": dict(Counter(c.split("_")[0] for c in ids)),
            "pixels": total,
            "water_fraction_of_valid": counts.get(1, 0) / max(1, counts.get(0, 0) + counts.get(1, 0)),
            "label_nodata_fraction": counts.get(-1, 0) / max(1, total),
            "s1_nodata_fraction": s1_invalid / max(1, n),
            "s2_nodata_fraction": s2_invalid / max(1, n),
        }
        print(f"[prepare] {split}: {n} chips, water {card[split]['water_fraction_of_valid']:.3f}", flush=True)

    stats = compute_stats(out_dir)
    stats.to_json(out_dir / "feature_stats.json")
    (out_dir / "dataset_card.json").write_text(json.dumps(card, indent=2))
    return card


def compute_stats(out_dir: Path, max_pixels_per_chip: int = 20000, seed: int = 0) -> FeatureStats:
    """Channel mean/std over valid training pixels (sub-sampled for speed)."""
    rng = np.random.default_rng(seed)
    s1 = np.load(out_dir / "train_s1.npy", mmap_mode="r")
    s2 = np.load(out_dir / "train_s2.npy", mmap_mode="r")
    s1_samples, s2_samples = [], []
    for i in range(s1.shape[0]):
        a1 = s1[i].astype(np.float32).reshape(2, -1)
        valid = np.isfinite(a1).all(axis=0)
        idx = np.flatnonzero(valid)
        if idx.size:
            idx = rng.choice(idx, min(idx.size, max_pixels_per_chip), replace=False)
            vv = np.clip(a1[0, idx], -30, 5)
            vh = np.clip(a1[1, idx], -35, 0)
            s1_samples.append(np.stack([vv, vh, vv - vh]))
        a2 = s2[i].astype(np.float32).reshape(6, -1)
        valid2 = (a2 > 0).all(axis=0)
        idx2 = np.flatnonzero(valid2)
        if idx2.size:
            idx2 = rng.choice(idx2, min(idx2.size, max_pixels_per_chip), replace=False)
            s2_samples.append(np.clip(a2[:, idx2] / 1e4, 0, 1.5))
    x1 = np.concatenate(s1_samples, axis=1)
    x2 = np.concatenate(s2_samples, axis=1)
    return FeatureStats(
        s1_mean=[round(float(v), 4) for v in x1.mean(axis=1)],
        s1_std=[round(float(v), 4) for v in x1.std(axis=1)],
        s2_mean=[round(float(v), 5) for v in x2.mean(axis=1)],
        s2_std=[round(float(v), 5) for v in x2.std(axis=1)],
        source="Sen1Floods11 hand-labelled train split",
    )


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--raw", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    a = p.parse_args()
    card = prepare(a.raw, a.out)
    print(json.dumps(card, indent=2))


if __name__ == "__main__":
    main()
