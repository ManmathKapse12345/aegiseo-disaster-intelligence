"""Segmentation and calibration metrics (pure NumPy, nodata-aware).

Conventions
-----------
* Labels: 1 = positive (water / change), 0 = negative, -1 = no-data (ignored).
* Pixel metrics are *micro-averaged*: confusion counts are accumulated over every valid
  pixel in a split before computing IoU/F1, which is the convention used by the
  Sen1Floods11 benchmark ("total IoU"). Mean per-chip IoU is also reported.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np


@dataclass
class Confusion:
    tp: int = 0
    fp: int = 0
    fn: int = 0
    tn: int = 0

    def update(self, pred: np.ndarray, label: np.ndarray) -> Confusion:
        valid = label >= 0
        p = pred.astype(bool) & valid
        t = (label == 1) & valid
        self.tp += int(np.sum(p & t))
        self.fp += int(np.sum(p & ~t))
        self.fn += int(np.sum(~p & t & valid))
        self.tn += int(np.sum(~p & ~t & valid))
        return self

    def __add__(self, other: Confusion) -> Confusion:
        return Confusion(self.tp + other.tp, self.fp + other.fp, self.fn + other.fn, self.tn + other.tn)

    @property
    def iou(self) -> float:
        d = self.tp + self.fp + self.fn
        return self.tp / d if d else float("nan")

    @property
    def precision(self) -> float:
        d = self.tp + self.fp
        return self.tp / d if d else float("nan")

    @property
    def recall(self) -> float:
        d = self.tp + self.fn
        return self.tp / d if d else float("nan")

    @property
    def f1(self) -> float:
        d = 2 * self.tp + self.fp + self.fn
        return 2 * self.tp / d if d else float("nan")

    @property
    def accuracy(self) -> float:
        n = self.tp + self.fp + self.fn + self.tn
        return (self.tp + self.tn) / n if n else float("nan")

    @property
    def n(self) -> int:
        return self.tp + self.fp + self.fn + self.tn

    def as_dict(self) -> dict[str, float]:
        return {
            "iou": self.iou,
            "f1": self.f1,
            "precision": self.precision,
            "recall": self.recall,
            "accuracy": self.accuracy,
            "tp": self.tp,
            "fp": self.fp,
            "fn": self.fn,
            "tn": self.tn,
        }


@dataclass
class CalibrationAccumulator:
    """Collects (probability, outcome) pairs, sub-sampled to bound memory."""

    max_samples: int = 3_000_000
    seed: int = 0
    probs: list[np.ndarray] = field(default_factory=list)
    labels: list[np.ndarray] = field(default_factory=list)
    _count: int = 0

    def update(self, prob: np.ndarray, label: np.ndarray, per_call_cap: int = 60_000) -> None:
        valid = label >= 0
        p, y = prob[valid].ravel(), (label[valid] == 1).ravel()
        if p.size == 0:
            return
        if p.size > per_call_cap:
            idx = np.random.default_rng(self.seed + self._count).choice(p.size, per_call_cap, replace=False)
            p, y = p[idx], y[idx]
        if self._count + p.size > self.max_samples:
            return
        self.probs.append(p.astype(np.float32))
        self.labels.append(y.astype(np.uint8))
        self._count += p.size

    def arrays(self) -> tuple[np.ndarray, np.ndarray]:
        if not self.probs:
            return np.zeros(0, np.float32), np.zeros(0, np.uint8)
        return np.concatenate(self.probs), np.concatenate(self.labels)


def reliability(prob: np.ndarray, y: np.ndarray, n_bins: int = 15) -> dict:
    """Expected calibration error (equal-width bins), Brier score, NLL and reliability bins."""
    if prob.size == 0:
        return {"ece": float("nan"), "mce": float("nan"), "brier": float("nan"), "nll": float("nan"), "bins": []}
    prob = np.clip(prob.astype(np.float64), 1e-7, 1 - 1e-7)
    y = y.astype(np.float64)
    edges = np.linspace(0, 1, n_bins + 1)
    idx = np.clip(np.digitize(prob, edges[1:-1]), 0, n_bins - 1)
    bins, ece, mce = [], 0.0, 0.0
    n = prob.size
    for b in range(n_bins):
        m = idx == b
        cnt = int(m.sum())
        if cnt == 0:
            bins.append({"lo": float(edges[b]), "hi": float(edges[b + 1]), "count": 0, "confidence": None, "frequency": None})
            continue
        conf, freq = float(prob[m].mean()), float(y[m].mean())
        gap = abs(conf - freq)
        ece += cnt / n * gap
        mce = max(mce, gap)
        bins.append({"lo": float(edges[b]), "hi": float(edges[b + 1]), "count": cnt, "confidence": conf, "frequency": freq})
    brier = float(np.mean((prob - y) ** 2))
    nll = float(-np.mean(y * np.log(prob) + (1 - y) * np.log(1 - prob)))
    return {"ece": float(ece), "mce": float(mce), "brier": brier, "nll": nll, "bins": bins, "n": int(n)}


def auroc(scores: np.ndarray, targets: np.ndarray) -> float:
    """Area under the ROC curve via the Mann-Whitney U statistic (ties averaged)."""
    targets = targets.astype(bool)
    n_pos, n_neg = int(targets.sum()), int((~targets).sum())
    if n_pos == 0 or n_neg == 0:
        return float("nan")
    order = np.argsort(scores, kind="mergesort")
    ranks = np.empty(scores.size, dtype=np.float64)
    sorted_scores = scores[order]
    # average ranks for ties
    _, inv, counts = np.unique(sorted_scores, return_inverse=True, return_counts=True)
    cum = np.cumsum(counts)
    avg = cum - (counts - 1) / 2.0
    ranks[order] = avg[inv]
    return float((ranks[targets].sum() - n_pos * (n_pos + 1) / 2) / (n_pos * n_neg))


def binary_entropy(p: np.ndarray) -> np.ndarray:
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return (-(p * np.log2(p) + (1 - p) * np.log2(1 - p))).astype(np.float32)


def safe_float(x: float) -> float | None:
    """JSON-friendly float (NaN/inf -> None)."""
    if x is None or not np.isfinite(x):
        return None
    return float(x)
