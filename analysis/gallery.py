"""Static HTML gallery: side-by-side GIF + graph-editor plot per rollout,
highlighting best, worst, and "passes the checks but looks dead" (high
score, but the curve itself barely moves -- a heuristic over the extracted
curve, not the rubric, since the rubric is user-owned).

    python -m analysis.gallery [--runs ./runs] [--top 5]

Writes `<runs>/gallery.html`. Renders any missing per-rollout GIF/graph
artifacts (via extractor/src/render-gif.ts and render-graph.ts) as it goes.
"""
from __future__ import annotations

import argparse
import html
import subprocess
from pathlib import Path

from analysis.load import GradedRun, load_runs

_REPO_ROOT = Path(__file__).resolve().parents[1]
_RENDER_GIF_SCRIPT = _REPO_ROOT / "extractor" / "src" / "render-gif.ts"
_RENDER_GRAPH_SCRIPT = _REPO_ROOT / "extractor" / "src" / "render-graph.ts"


def count_y_extrema(curves: dict) -> int:
    y = curves.get("properties", {}).get("y", [])
    vals = [k["value"] for k in y]
    count = 0
    for i in range(1, len(vals) - 1):
        if (vals[i] - vals[i - 1]) * (vals[i + 1] - vals[i]) < 0:
            count += 1
    return count


def looks_dead(run: GradedRun, score_threshold: float = 0.75) -> bool:
    if run.total_score < score_threshold or not run.curves:
        return False
    return count_y_extrema(run.curves) <= 1


def ensure_rendered(run: GradedRun) -> tuple[Path | None, Path | None]:
    render_dir = run.run_dir / "render"
    render_dir.mkdir(parents=True, exist_ok=True)
    gif_path = render_dir / "animation.gif"
    graph_path = render_dir / "graph.png"
    curves_path = run.run_dir / "extracted" / "curves.json"
    final_dir = run.run_dir / "final"

    if not graph_path.is_file() and curves_path.is_file():
        subprocess.run(
            ["npx", "tsx", str(_RENDER_GRAPH_SCRIPT), str(curves_path), str(graph_path)],
            cwd=_REPO_ROOT, check=False,
        )
    if not gif_path.is_file() and run.curves and final_dir.is_dir():
        duration = run.curves.get("durationSeconds", 0)
        if duration > 0:
            subprocess.run(
                ["npx", "tsx", str(_RENDER_GIF_SCRIPT), str(final_dir), run.framework, str(duration), str(gif_path)],
                cwd=_REPO_ROOT, check=False,
            )
    return (gif_path if gif_path.is_file() else None, graph_path if graph_path.is_file() else None)


def _row_html(run: GradedRun) -> str:
    gif_path, graph_path = ensure_rendered(run)
    rel = lambda p: p.relative_to(run.run_dir.parent).as_posix() if p else None  # noqa: E731
    gif_rel, graph_rel = rel(gif_path), rel(graph_path)
    title = html.escape(f"{run.model} / {run.framework} / {run.material} / {run.feedback_mode} / seed {run.seed}")
    img_tags = []
    if gif_rel:
        img_tags.append(f'<img src="{gif_rel}" style="max-width:360px;border:1px solid #ddd" />')
    if graph_rel:
        img_tags.append(f'<img src="{graph_rel}" style="max-width:420px;border:1px solid #ddd" />')
    imgs = "".join(img_tags) or "<em>(no render available)</em>"
    return (
        f'<div style="margin-bottom:24px;padding-bottom:16px;border-bottom:1px solid #eee">'
        f'<div><strong>{title}</strong> &mdash; score {run.total_score:.3f}</div>'
        f'<div style="display:flex;gap:12px;margin-top:8px">{imgs}</div>'
        f"</div>"
    )


def build_gallery_html(runs: list[GradedRun], top: int) -> str:
    ranked = sorted(runs, key=lambda r: r.total_score, reverse=True)
    best = ranked[:top]
    worst = list(reversed(ranked[-top:])) if len(ranked) > top else []
    dead = [r for r in runs if looks_dead(r)][:top]

    def section(title: str, items: list[GradedRun]) -> str:
        if not items:
            return f"<h2>{html.escape(title)}</h2><p><em>none</em></p>"
        return f"<h2>{html.escape(title)}</h2>" + "".join(_row_html(r) for r in items)

    body = (
        section(f"Best ({len(best)})", best)
        + section(f"Worst ({len(worst)})", worst)
        + section(f"Passes the checks but looks dead ({len(dead)})", dead)
    )
    return (
        "<!doctype html><html><head><meta charset='utf-8'><title>Ball Bounce Eval Gallery</title></head>"
        f"<body style='font-family:sans-serif;max-width:900px;margin:40px auto'>"
        f"<h1>Ball Bounce Eval Gallery</h1><p>{len(runs)} graded rollouts.</p>{body}</body></html>"
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=Path, default=Path("runs"))
    ap.add_argument("--top", type=int, default=5)
    args = ap.parse_args()

    runs = load_runs(args.runs)
    out_path = args.runs / "gallery.html"
    out_path.write_text(build_gallery_html(runs, args.top))
    print(f"wrote {out_path}")


if __name__ == "__main__":
    main()
