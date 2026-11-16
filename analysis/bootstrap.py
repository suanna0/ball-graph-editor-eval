"""Paired bootstrap confidence intervals over per-seed scores."""
from __future__ import annotations

import numpy as np


def bootstrap_ci(values: list[float], n_resamples: int = 10_000, ci: float = 0.95, seed: int = 0) -> tuple[float, float, float]:
    """Mean and a percentile-bootstrap CI, resampling seeds with
    replacement. Returns (mean, lo, hi)."""
    arr = np.asarray(values, dtype=float)
    if arr.size == 0:
        return (float("nan"), float("nan"), float("nan"))
    if arr.size == 1:
        return (float(arr[0]), float(arr[0]), float(arr[0]))
    rng = np.random.default_rng(seed)
    resamples = rng.choice(arr, size=(n_resamples, arr.size), replace=True)
    means = resamples.mean(axis=1)
    alpha = (1 - ci) / 2
    lo, hi = np.quantile(means, [alpha, 1 - alpha])
    return (float(arr.mean()), float(lo), float(hi))


def paired_bootstrap_diff_ci(
    a: list[float], b: list[float], n_resamples: int = 10_000, ci: float = 0.95, seed: int = 0
) -> tuple[float, float, float]:
    """CI for mean(a) - mean(b), resampling PAIRED indices jointly (a[i]
    and b[i] always move together) so correlation between the two
    conditions -- e.g. the same seed run under two feedback modes -- is
    preserved rather than washed out by resampling each side
    independently."""
    a_arr = np.asarray(a, dtype=float)
    b_arr = np.asarray(b, dtype=float)
    if a_arr.size != b_arr.size:
        raise ValueError(f"paired bootstrap requires equal-length samples, got {a_arr.size} vs {b_arr.size}")
    if a_arr.size == 0:
        return (float("nan"), float("nan"), float("nan"))
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, a_arr.size, size=(n_resamples, a_arr.size))
    diffs = a_arr[idx].mean(axis=1) - b_arr[idx].mean(axis=1)
    alpha = (1 - ci) / 2
    lo, hi = np.quantile(diffs, [alpha, 1 - alpha])
    return (float(a_arr.mean() - b_arr.mean()), float(lo), float(hi))
