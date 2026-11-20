"""Deterministic grader CLI.

    python -m grader.grade <run-dir>

Reads `<run-dir>/final/` and `<run-dir>/cell.json` (written by
runtime/rollout.py), re-extracts curves from scratch via the TypeScript
extractor (never trusting anything the worker wrote during the rollout --
see runtime/tools.py's module docstring), scores them with
grader.rubric.score(), and writes `<run-dir>/extracted/curves.json` and
`<run-dir>/score.json`.

If grader/rubric.py isn't implemented yet, pass --stub-rubric to score
everything 0.5 so the rest of the pipeline (extraction, file layout,
aggregation) can be exercised and tested independently.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

from runtime.config import load_task

_REPO_ROOT = Path(__file__).resolve().parents[1]


def _stub_score(curves: dict[str, Any]) -> dict[str, Any]:
    return {"score": 0.5, "checks": {"stub": {"score": 0.5, "detail": "rubric not implemented yet"}}}


def extract_curves(extractor_cmd: list[str], final_dir: Path, framework: str, timeout: int = 60) -> dict[str, Any]:
    proc = subprocess.run(
        [*extractor_cmd, str(final_dir), framework],
        capture_output=True,
        text=True,
        timeout=timeout,
        cwd=_REPO_ROOT,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"extractor failed (exit {proc.returncode}):\n{proc.stderr}")
    return json.loads(proc.stdout)


def grade_run_dir(run_dir: Path, use_stub_rubric: bool = False) -> dict[str, Any]:
    # A run dir is self-contained -- it carries its own frozen task.yaml,
    # so grading never depends on the live task/ tree having stayed the
    # same since the rollout ran.
    task = load_task(run_dir / "task.yaml")
    cell = json.loads((run_dir / "cell.json").read_text())
    framework = cell["framework"]
    final_dir = run_dir / "final"

    curves = extract_curves(task.extractor_cmd, final_dir, framework)

    extracted_dir = run_dir / "extracted"
    extracted_dir.mkdir(parents=True, exist_ok=True)
    (extracted_dir / "curves.json").write_text(json.dumps(curves, indent=2))

    if use_stub_rubric:
        result = _stub_score(curves)
    else:
        from grader.rubric import score

        result = score(curves)

    (run_dir / "score.json").write_text(json.dumps(result, indent=2))
    return result


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("run_dir", type=Path)
    ap.add_argument("--stub-rubric", action="store_true", help="Score 0.5 instead of calling grader.rubric (for pipeline testing).")
    args = ap.parse_args()

    try:
        result = grade_run_dir(args.run_dir, use_stub_rubric=args.stub_rubric)
    except NotImplementedError as e:
        print(f"error: {e}\nhint: pass --stub-rubric to test the pipeline without a rubric.", file=sys.stderr)
        raise SystemExit(1)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
