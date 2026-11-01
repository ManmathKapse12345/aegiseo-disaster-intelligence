"""PyTorch dataset over the prepared Sen1Floods11 arrays (see :mod:`aegis.ml.prepare`)."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import torch
from torch.utils.data import Dataset

from aegis.ml import augment
from aegis.ml.features import FeatureStats, build_s1, build_s2


class Sen1Floods11(Dataset):
    """Returns ``(s1_features, s2_features, label, jrc)`` tensors.

    Arrays are opened lazily (memory-mapped) inside each worker so that the dataset can be
    used with spawn-based multiprocessing on Windows without copying the arrays.
    """

    def __init__(
        self,
        root: Path,
        split: str,
        stats: FeatureStats,
        *,
        crop: int | None = None,
        augment_data: bool = False,
        samples_per_chip: int = 1,
        cloud_sim_p: float = 0.0,
        cloud_coverage: tuple[float, float] = (0.1, 0.9),
        drop_s1_p: float = 0.0,
        drop_s2_p: float = 0.0,
        fixed_cloud_coverage: float | None = None,
        remove_s1: bool = False,
        remove_s2: bool = False,
        seed: int = 0,
    ):
        self.root, self.split, self.stats = Path(root), split, stats
        self.crop, self.augment = crop, augment_data
        self.samples_per_chip = samples_per_chip
        self.cloud_sim_p, self.cloud_coverage = cloud_sim_p, cloud_coverage
        self.drop_s1_p, self.drop_s2_p = drop_s1_p, drop_s2_p
        self.fixed_cloud_coverage = fixed_cloud_coverage
        self.remove_s1, self.remove_s2 = remove_s1, remove_s2
        self.seed = seed
        self.ids: list[str] = json.loads((self.root / f"{split}_ids.json").read_text())
        self._arrays: dict[str, np.ndarray] | None = None

    def _open(self) -> dict[str, np.ndarray]:
        if self._arrays is None:
            self._arrays = {
                k: np.load(self.root / f"{self.split}_{k}.npy", mmap_mode="r") for k in ("s1", "s2", "label", "jrc")
            }
        return self._arrays

    def __getstate__(self) -> dict:
        state = self.__dict__.copy()
        state["_arrays"] = None  # never pickle memory maps into worker processes
        return state

    def __len__(self) -> int:
        return len(self.ids) * self.samples_per_chip

    def __getitem__(self, index: int):
        arr = self._open()
        i = index % len(self.ids)
        if self.augment:
            rng = np.random.default_rng((torch.initial_seed() + index) % (2**32))
        else:  # deterministic per chip for evaluation conditions
            rng = np.random.default_rng(self.seed * 100003 + i)
        # Select the crop window first and slice the memory maps, so only the needed
        # pixels are read and converted (about 7x less work than converting full chips).
        h, w = arr["label"].shape[-2:]
        c = self.crop if self.crop and self.crop < min(h, w) else None
        if c is None:
            ys, xs = slice(None), slice(None)
        elif self.augment:
            y0, x0 = int(rng.integers(0, h - c + 1)), int(rng.integers(0, w - c + 1))
            ys, xs = slice(y0, y0 + c), slice(x0, x0 + c)
        else:
            y0, x0 = (h - c) // 2, (w - c) // 2
            ys, xs = slice(y0, y0 + c), slice(x0, x0 + c)
        s1 = np.asarray(arr["s1"][i, :, ys, xs], dtype=np.float32)
        s2_raw = np.asarray(arr["s2"][i, :, ys, xs])
        s2_valid = np.all(s2_raw > 0, axis=0)
        s2 = s2_raw.astype(np.float32) / 1e4
        label = np.asarray(arr["label"][i, ys, xs], dtype=np.int64)
        jrc = np.asarray(arr["jrc"][i, ys, xs], dtype=np.int64)

        if self.augment:
            s1, s2, m2, lab, jr = augment.flip_rotate(
                [s1, s2, s2_valid[None].astype(np.float32), label[None], jrc[None]], rng
            )
            s2_valid, label, jrc = m2[0] > 0.5, lab[0], jr[0]

        if self.augment:
            s1, s2 = augment.radiometric_jitter(s1, s2, rng)
            if rng.random() < self.cloud_sim_p:
                cov = rng.uniform(*self.cloud_coverage)
                s2_valid = s2_valid & ~augment.cloud_mask(s2_valid.shape, cov, rng)
            r = rng.random()
            if r < self.drop_s2_p:
                s2_valid = np.zeros_like(s2_valid)
            elif r < self.drop_s2_p + self.drop_s1_p:
                s1 = np.full_like(s1, np.nan)
        if self.fixed_cloud_coverage is not None:
            s2_valid = s2_valid & ~augment.cloud_mask(s2_valid.shape, self.fixed_cloud_coverage, rng)
        if self.remove_s2:
            s2_valid = np.zeros_like(s2_valid)
        if self.remove_s1:
            s1 = np.full_like(s1, np.nan)

        f1 = build_s1(s1[0], s1[1], self.stats)
        f2 = build_s2(s2, s2_valid, self.stats)
        return torch.from_numpy(f1), torch.from_numpy(f2), torch.from_numpy(label), torch.from_numpy(jrc)
