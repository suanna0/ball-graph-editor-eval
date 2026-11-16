"""Entry point.

    python -m runtime.cli run-batch [--task task/task.yaml] [--runner runner.yaml]
                                     [--limit N] [--dry-run]

`--limit N` runs only the first N cells of the expanded grid (useful for a
smoke test before spending on a full batch). `--dry-run` prints the cells
without running anything.

Grading is a separate command (grader/grade.py) that reads a run
directory's final/ tree, so this file does not need to know about it."""
from __future__ import annotations

import argparse
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from runtime.config import load_runner, load_task
from runtime.dotenv import load_dotenv
from runtime.matrix import expand_grid
from runtime.rollout import run_one_rollout


def _load_project_env(start: Path) -> None:
    """Load a .env file from the first parent containing one. No-op if none
    is found. Existing environment variables are not overwritten."""
    for d in [start, *start.parents]:
        candidate = d / ".env"
        if candidate.is_file():
            load_dotenv(candidate)
            return


def cmd_run_batch(args: argparse.Namespace) -> None:
    task_yaml = Path(args.task).resolve()
    runner_yaml = Path(args.runner).resolve()
    task = load_task(task_yaml)
    runner_cfg = load_runner(runner_yaml)

    cells = expand_grid(task, runner_cfg)
    if args.limit is not None:
        cells = cells[: args.limit]

    if args.dry_run:
        print(f"{len(cells)} cell(s):")
        for c in cells:
            print(f"  {c.cell_id}")
        return

    n = len(cells)
    workers = max(1, min(runner_cfg.concurrency, n))
    print_lock = threading.Lock()

    def _say(msg: str) -> None:
        with print_lock:
            print(msg, flush=True)

    def _one(idx: int) -> Path:
        cell = cells[idx]
        _say(f"[{idx + 1}/{n}] starting {cell.cell_id}")
        try:
            run_dir = run_one_rollout(
                task=task,
                runner_cfg=runner_cfg,
                cell=cell,
                task_yaml_path=task_yaml,
                runner_yaml_path=runner_yaml,
            )
        except Exception as e:
            _say(f"[{idx + 1}/{n}] failed {cell.cell_id}: {type(e).__name__}: {e}")
            raise
        _say(f"[{idx + 1}/{n}] wrote {run_dir}")
        return run_dir

    _say(f"running {n} rollout(s), concurrency={workers}")
    failures = 0
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futures = {ex.submit(_one, i): i for i in range(n)}
        for fut in as_completed(futures):
            try:
                fut.result()
            except Exception:
                failures += 1

    if failures:
        _say(f"done: {n - failures} ok, {failures} failed")
        raise SystemExit(1)
    _say(f"done: {n} ok")


def main(argv: list[str] | None = None) -> None:
    _load_project_env(Path.cwd())
    p = argparse.ArgumentParser(prog="runtime")
    sub = p.add_subparsers(dest="cmd", required=True)

    r = sub.add_parser("run-batch", help="Expand the grid and run rollouts.")
    r.add_argument("--task", default="task/task.yaml")
    r.add_argument("--runner", default="runner.yaml")
    r.add_argument("--limit", type=int, default=None, help="Only run the first N cells.")
    r.add_argument("--dry-run", action="store_true", help="Print the expanded cells and exit.")
    r.set_defaults(func=cmd_run_batch)

    args = p.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
