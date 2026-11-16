"""Load task.yaml (the fixed physical task + what each framework/feedback
mode allows) and runner.yaml (who runs it: models, and which slice of the
grid to actually run). Kept separate so the task stays model-agnostic and
the grid can be swapped without touching task/.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import yaml


@dataclass
class Physical:
    viewport: dict          # {width, height}
    ball_diameter_px: float
    floor_y_px: float
    start_x_px: float
    start_height_px: float
    window_seconds: float


@dataclass
class FrameworkSpec:
    name: str
    scaffold: Path
    buildless: bool


@dataclass
class FeedbackSpec:
    name: str
    tools: list[str]


@dataclass
class TaskSpec:
    root: Path
    name: str
    physical: Physical
    brief_template: Path
    frameworks: dict[str, FrameworkSpec]
    materials: list[str]
    feedback_modes: dict[str, FeedbackSpec]
    limits: dict
    extractor_cmd: list[str]


def load_task(task_yaml: Path) -> TaskSpec:
    data = yaml.safe_load(task_yaml.read_text())
    root = task_yaml.parent
    phys = data["physical"]
    frameworks = {
        fname: FrameworkSpec(
            name=fname,
            scaffold=(root / fspec["scaffold"]).resolve(),
            buildless=fspec.get("buildless", True),
        )
        for fname, fspec in data["frameworks"].items()
    }
    feedback_modes = {
        mname: FeedbackSpec(name=mname, tools=list(mspec["tools"]))
        for mname, mspec in data["feedback_modes"].items()
    }
    return TaskSpec(
        root=root,
        name=data["name"],
        physical=Physical(
            viewport=phys["viewport"],
            ball_diameter_px=phys["ball_diameter_px"],
            floor_y_px=phys["floor_y_px"],
            start_x_px=phys["start"]["x_px"],
            start_height_px=phys["start"]["height_px"],
            window_seconds=phys["window_seconds"],
        ),
        brief_template=(root / data["brief_template"]).resolve(),
        frameworks=frameworks,
        materials=list(data["materials"]),
        feedback_modes=feedback_modes,
        limits=data["limits"],
        extractor_cmd=list(data["grader"]["extractor_cmd"]),
    )


@dataclass
class GridSelection:
    frameworks: list[str]
    materials: list[str]
    feedback_modes: list[str]
    seeds: int


@dataclass
class RunnerSpec:
    provider: str
    models: list[str]
    thinking: dict | None
    max_tokens: int
    grid: GridSelection
    concurrency: int
    output_dir: Path


def load_runner(runner_yaml: Path) -> RunnerSpec:
    data = yaml.safe_load(runner_yaml.read_text())
    w = data["worker"]
    g = data["grid"]
    b = data.get("batch", {})
    output_dir = Path(data.get("output_dir", "./runs"))
    if not output_dir.is_absolute():
        output_dir = (runner_yaml.parent / output_dir).resolve()
    return RunnerSpec(
        provider=w["provider"],
        models=list(w["models"]),
        thinking=w.get("thinking"),
        max_tokens=w.get("max_tokens", 8192),
        grid=GridSelection(
            frameworks=list(g["frameworks"]),
            materials=list(g["materials"]),
            feedback_modes=list(g["feedback_modes"]),
            seeds=int(g.get("seeds", 1)),
        ),
        concurrency=int(b.get("concurrency", 1)),
        output_dir=output_dir,
    )
