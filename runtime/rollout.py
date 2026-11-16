"""Drive one rollout end-to-end: freeze inputs, run the agent loop, snapshot
the final state. The resulting directory is self-contained -- the grader can
read it alone, with no reference to the live task tree, by re-extracting
curves from `final/` (see grader/grade.py)."""
from __future__ import annotations

import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

import jinja2

from runtime.agent import EventLog, run_agent
from runtime.config import RunnerSpec, TaskSpec
from runtime.matrix import Cell
from runtime.sandbox import DockerSandbox
from runtime.tools import ToolBridge, tool_specs


def _timestamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")


def new_run_dir(output_dir: Path, cell: Cell) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    d = output_dir / f"{_timestamp()}_{cell.cell_id}"
    d.mkdir(parents=True, exist_ok=False)
    return d


def render_brief(task: TaskSpec, cell: Cell) -> str:
    template = jinja2.Template(task.brief_template.read_text())
    p = task.physical
    feedback_spec = task.feedback_modes[cell.feedback_mode]
    return template.render(
        framework=cell.framework,
        material=cell.material,
        material_label=cell.material.replace("_", " "),
        viewport=p.viewport,
        ball_diameter_px=p.ball_diameter_px,
        floor_y_px=p.floor_y_px,
        start_x_px=p.start_x_px,
        start_height_px=p.start_height_px,
        window_seconds=p.window_seconds,
        has_render_graph="render_graph" in feedback_spec.tools,
    )


def freeze_inputs(
    task: TaskSpec,
    cell: Cell,
    task_yaml_path: Path,
    runner_yaml_path: Path,
    run_dir: Path,
) -> str:
    shutil.copy2(task_yaml_path, run_dir / "task.yaml")
    shutil.copy2(runner_yaml_path, run_dir / "runner.yaml")
    (run_dir / "cell.json").write_text(json.dumps(cell.__dict__, indent=2))
    prompt_text = render_brief(task, cell)
    (run_dir / "prompt.md").write_text(prompt_text)
    shutil.copytree(task.frameworks[cell.framework].scaffold, run_dir / "begin")
    return prompt_text


def run_one_rollout(
    *,
    task: TaskSpec,
    runner_cfg: RunnerSpec,
    cell: Cell,
    task_yaml_path: Path,
    runner_yaml_path: Path,
) -> Path:
    if runner_cfg.provider != "anthropic":
        raise ValueError(f"unsupported provider: {runner_cfg.provider}")

    # Imported here so missing deps don't crash `--help`.
    from anthropic import Anthropic

    run_dir = new_run_dir(runner_cfg.output_dir, cell)
    prompt_text = freeze_inputs(task, cell, task_yaml_path, runner_yaml_path, run_dir)

    feedback_spec = task.feedback_modes[cell.feedback_mode]
    scaffold = task.frameworks[cell.framework].scaffold

    sandbox = DockerSandbox()
    event_log = EventLog(run_dir / "logs" / "events.jsonl")
    try:
        sandbox.seed(scaffold)
        bridge = ToolBridge(sandbox, framework=cell.framework)

        summary = run_agent(
            client=Anthropic(),
            model=cell.model,
            max_tokens=runner_cfg.max_tokens,
            thinking=runner_cfg.thinking,
            prompt_text=prompt_text,
            tool_specs=tool_specs(feedback_spec.tools),
            tool_bridge=bridge,
            max_turns=task.limits["max_turns"],
            wall_clock_seconds=task.limits["wall_clock_seconds"],
            max_tool_calls=task.limits["max_tool_calls"],
            max_output_tokens=task.limits["max_output_tokens"],
            event_log=event_log,
        )

        (run_dir / "logs" / "usage.json").write_text(
            json.dumps(
                {**summary, "model": cell.model, "provider": runner_cfg.provider},
                indent=2,
            )
        )
        sandbox.copy_final_to(run_dir / "final")
    finally:
        event_log.close()
        sandbox.cleanup()

    return run_dir
