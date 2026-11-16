"""Aggregate report over a runs/ directory of graded rollouts.

    python -m analysis.aggregate [--runs ./runs] [--out report.json]

Prints (and optionally writes) scores grouped by model x framework x
feedback_mode with paired-bootstrap 95% CIs over seeds, a preset-vs-
hand-placed breakdown, and pairwise blind-vs-can_render_and_view_graph
deltas (paired by seed) where both exist for the same model x framework x
material.
"""
from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path
from typing import Any

from analysis.bootstrap import bootstrap_ci, paired_bootstrap_diff_ci
from analysis.load import GradedRun, load_runs


def group_by(runs: list[GradedRun], *keys: str) -> dict[tuple[str, ...], list[GradedRun]]:
    groups: dict[tuple[str, ...], list[GradedRun]] = defaultdict(list)
    for r in runs:
        groups[tuple(getattr(r, k) for k in keys)].append(r)
    return groups


def scores_by_model_framework_feedback(runs: list[GradedRun]) -> list[dict[str, Any]]:
    rows = []
    for (model, framework, feedback_mode), group in sorted(group_by(runs, "model", "framework", "feedback_mode").items()):
        mean, lo, hi = bootstrap_ci([r.total_score for r in group])
        rows.append({
            "model": model,
            "framework": framework,
            "feedback_mode": feedback_mode,
            "n": len(group),
            "mean_score": mean,
            "ci95_lo": lo,
            "ci95_hi": hi,
        })
    return rows


def preset_vs_hand_placed(runs: list[GradedRun]) -> list[dict[str, Any]]:
    rows = []
    for key, group in sorted(group_by(runs, "model", "framework").items()):
        model, framework = key
        preset = [r.total_score for r in group if not r.predominantly_hand_placed]
        hand = [r.total_score for r in group if r.predominantly_hand_placed]
        p_mean, p_lo, p_hi = bootstrap_ci(preset) if preset else (float("nan"),) * 3
        h_mean, h_lo, h_hi = bootstrap_ci(hand) if hand else (float("nan"),) * 3
        rows.append({
            "model": model,
            "framework": framework,
            "n_preset": len(preset),
            "preset_mean_score": p_mean,
            "preset_ci95": [p_lo, p_hi],
            "n_hand_placed": len(hand),
            "hand_placed_mean_score": h_mean,
            "hand_placed_ci95": [h_lo, h_hi],
        })
    return rows


def feedback_deltas(runs: list[GradedRun]) -> list[dict[str, Any]]:
    """blind vs can_render_and_view_graph, paired by seed, within each
    (model, framework, material)."""
    rows = []
    for key, group in sorted(group_by(runs, "model", "framework", "material").items()):
        model, framework, material = key
        blind = {r.seed: r.total_score for r in group if r.feedback_mode == "blind"}
        graph = {r.seed: r.total_score for r in group if r.feedback_mode == "can_render_and_view_graph"}
        common_seeds = sorted(set(blind) & set(graph))
        if not common_seeds:
            continue
        a = [graph[s] for s in common_seeds]
        b = [blind[s] for s in common_seeds]
        diff, lo, hi = paired_bootstrap_diff_ci(a, b)
        rows.append({
            "model": model,
            "framework": framework,
            "material": material,
            "n_paired_seeds": len(common_seeds),
            "mean_delta_graph_minus_blind": diff,
            "ci95_lo": lo,
            "ci95_hi": hi,
        })
    return rows


def build_report(runs_dir: Path) -> dict[str, Any]:
    runs = load_runs(runs_dir)
    return {
        "n_runs": len(runs),
        "by_model_framework_feedback": scores_by_model_framework_feedback(runs),
        "preset_vs_hand_placed": preset_vs_hand_placed(runs),
        "feedback_deltas_graph_minus_blind": feedback_deltas(runs),
    }


def _nan_to_none(obj: Any) -> Any:
    if isinstance(obj, float) and obj != obj:  # NaN != NaN
        return None
    if isinstance(obj, dict):
        return {k: _nan_to_none(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_nan_to_none(v) for v in obj]
    return obj


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=Path, default=Path("runs"))
    ap.add_argument("--out", type=Path, default=None)
    args = ap.parse_args()

    report = _nan_to_none(build_report(args.runs))
    text = json.dumps(report, indent=2)
    print(text)
    if args.out:
        args.out.write_text(text)


if __name__ == "__main__":
    main()
