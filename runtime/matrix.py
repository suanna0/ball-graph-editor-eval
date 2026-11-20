"""Expand a RunnerSpec's grid selection into individual rollout cells.

One cell = one (model, framework, material, feedback_mode, seed) combination.
Each cell is run as exactly one rollout. This is the only place the grid
is expanded -- cli.py and rollout.py just consume the resulting list.
"""
from __future__ import annotations

from dataclasses import dataclass

from runtime.config import RunnerSpec, TaskSpec


@dataclass(frozen=True)
class Cell:
    model: str
    framework: str
    material: str
    feedback_mode: str
    seed: int

    @property
    def cell_id(self) -> str:
        # OpenRouter-style model slugs ("openai/gpt-5") contain "/", which
        # would otherwise be read as a path separator and silently nest an
        # extra directory -- the model stays intact for the actual API call
        # (Cell.model), this only affects the directory name.
        model_slug = self.model.replace("/", "--")
        return f"{model_slug}_{self.framework}_{self.material}_{self.feedback_mode}_s{self.seed:02d}"


def expand_grid(task: TaskSpec, runner: RunnerSpec) -> list[Cell]:
    unknown_fw = set(runner.grid.frameworks) - set(task.frameworks)
    if unknown_fw:
        raise ValueError(f"runner.yaml grid.frameworks not in task.yaml frameworks: {sorted(unknown_fw)}")
    unknown_mat = set(runner.grid.materials) - set(task.materials)
    if unknown_mat:
        raise ValueError(f"runner.yaml grid.materials not in task.yaml materials: {sorted(unknown_mat)}")
    unknown_fb = set(runner.grid.feedback_modes) - set(task.feedback_modes)
    if unknown_fb:
        raise ValueError(f"runner.yaml grid.feedback_modes not in task.yaml feedback_modes: {sorted(unknown_fb)}")

    cells: list[Cell] = []
    for model in runner.models:
        for framework in runner.grid.frameworks:
            for material in runner.grid.materials:
                for feedback_mode in runner.grid.feedback_modes:
                    for seed in range(1, runner.grid.seeds + 1):
                        cells.append(Cell(
                            model=model,
                            framework=framework,
                            material=material,
                            feedback_mode=feedback_mode,
                            seed=seed,
                        ))
    return cells
