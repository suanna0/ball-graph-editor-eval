"""Load graded rollouts from a runs/ directory into a flat table. Shared by
aggregate.py and gallery.py so both see the same notion of "a graded run"."""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass
class GradedRun:
    run_dir: Path
    cell: dict[str, Any]
    score: dict[str, Any]
    curves: dict[str, Any] | None

    @property
    def model(self) -> str:
        return self.cell["model"]

    @property
    def framework(self) -> str:
        return self.cell["framework"]

    @property
    def material(self) -> str:
        return self.cell["material"]

    @property
    def feedback_mode(self) -> str:
        return self.cell["feedback_mode"]

    @property
    def seed(self) -> int:
        return self.cell["seed"]

    @property
    def total_score(self) -> float:
        return float(self.score["score"])

    @property
    def ease_mix(self) -> dict[str, int]:
        """Counts of easeSource across every keyframe in every property,
        for the preset-vs-hand-placed breakdown."""
        counts: dict[str, int] = {}
        if not self.curves:
            return counts
        for kfs in self.curves.get("properties", {}).values():
            for kf in kfs:
                src = kf.get("easeSource", "unknown")
                counts[src] = counts.get(src, 0) + 1
        return counts

    @property
    def predominantly_hand_placed(self) -> bool:
        counts = self.ease_mix
        preset = counts.get("preset", 0)
        hand = counts.get("hand-placed", 0)
        return hand > preset


def load_runs(runs_dir: Path) -> list[GradedRun]:
    """A run dir is anything containing cell.json + score.json, found at
    any depth under runs_dir -- flat (old layout) or grouped under a batch
    dir (runs/<batch>/<cell_id>/, current layout), without caring which."""
    out: list[GradedRun] = []
    if not runs_dir.is_dir():
        return out
    for cell_path in sorted(runs_dir.rglob("cell.json")):
        d = cell_path.parent
        score_path = d / "score.json"
        if not score_path.is_file():
            continue
        cell = json.loads(cell_path.read_text())
        score = json.loads(score_path.read_text())
        curves_path = d / "extracted" / "curves.json"
        curves = json.loads(curves_path.read_text()) if curves_path.is_file() else None
        out.append(GradedRun(run_dir=d, cell=cell, score=score, curves=curves))
    return out
