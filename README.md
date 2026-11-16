# Ball Bounce Eval

An eval harness that has AI models author a bouncing-ball animation from
scratch — keyframes and Bezier handles, no physics simulation loop — then
grades the resulting *curves*, not pixels. Compares models and animation
authoring frameworks (CSS `@keyframes`, GSAP, Lottie to start; Web
Animations API, Motion, and a Three.js render target are planned but not
wired in yet).

The runtime architecture (one Docker container per rollout, an
Anthropic-SDK agent loop, self-contained rollout records, deterministic
grading over a frozen final snapshot, N-way concurrency) is adapted from a
prior project, *Taste RL Env*. See `/Users/suannazhong/.claude/plans/giggly-dreaming-crystal.md`
for the original design plan.

## Repo layout

```
runtime/        Python. Orchestrates rollouts: Docker sandbox, agent loop,
                tool bridge, experiment-grid expansion, batch CLI.
task/           The fixed physical brief (viewport, floor, start position,
                time window), per-framework scaffolds, and the brief
                template.
extractor/      TypeScript. Runtime curve extraction (Playwright-based for
                CSS/WAA/GSAP, direct JSON parse for Lottie), the canonical
                schema, graph-editor plot rendering, GIF rendering.
grader/         Python. grade.py wires extraction to the rubric and writes
                score.json. rubric.py and tolerances.yaml are intentionally
                left for the project owner to author -- see below.
analysis/       Python. Aggregate report (bootstrap CIs) and the HTML
                gallery over a runs/ directory.
runs/           Gitignored. One self-contained directory per rollout.
```

## Quickstart

```bash
cp .env.example .env   # fill in ANTHROPIC_API_KEY
make build
make dry-run                    # see which cells runner.yaml's grid expands to
make run-batch LIMIT=1          # run just the first cell as a smoke test
make grade RUN=<printed run dir> STUB=1   # score it with a stub rubric
make aggregate
make gallery                    # writes runs/gallery.html
```

Widen the grid by editing `runner.yaml` (`worker.models`, `grid.frameworks`,
`grid.materials`, `grid.feedback_modes`, `grid.seeds`) -- each combination
becomes one rollout. The physical task itself (viewport, floor, ball size,
time window) lives in `task/task.yaml` and is shared by every cell.

## Canonical curve schema

Every adapter (`extractor/src/adapters/{domAnimations,gsap,lottie}.ts`)
converts whatever the worker authored into one framework-agnostic shape --
see `extractor/src/schema.ts`. Units are absolute (px for x/y, a ratio for
scale, degrees for rotation); handles are stored relative to their own
keyframe (`{dt, dv}`), not as normalized bezier control points, so a CSS
`cubic-bezier(...)`, a GSAP named ease, and Lottie's own `i`/`o` tangents
are all directly comparable to an ideal-parabola handle without
re-deriving per-segment scale factors downstream.

```jsonc
{
  "framework": "css" | "waa" | "gsap" | "motion" | "lottie",
  "renderTarget": "dom" | "svg" | "three",
  "properties": {
    "x": [{ "time": 0, "value": 80, "inHandle": null, "outHandle": {"dt":0.33,"dv":0}, "easeSource": "hand-placed", "presetName": "cubic-bezier(0.33, 0, 0.67, 0.33)" }, ...],
    "y": [...], "scaleX": [...], "scaleY": [...], "rotation": [...]
  },
  "durationSeconds": 2,
  "extractionWarnings": []
}
```

`extractor/tests/extract.spec.ts` runs each adapter against a hand-built
fixture page (not LLM output) with known keyframes, asserting the exact
expected values and handle shapes -- run with `npx vitest run`.

### Per-framework notes

- **CSS / WAA / Motion**: `document.getAnimations()[].effect.getKeyframes()`
  returns the *authored* `transform` string per offset (not an
  interpolated matrix), so there's no constraint on how the worker writes
  the transform -- it's regex-parsed for `translate(X/Y)`,
  `scale(X/Y)`, `rotate`.
- **GSAP**: `extractor/src/adapters/gsap.ts` injects a wrapper around
  `window.gsap`'s `to`/`timeline` *before* the page's own script runs (via
  `page.addInitScript`), so it can only patch a **global** -- the GSAP
  scaffold loads gsap from a pinned CDN `<script>` tag, not a bundled ESM
  import. That wrapper script is written as a plain-JS string rather than
  an actual TS function; see the comment at the top of that file for why
  (short version: Playwright serializes injected functions via
  `.toString()`, and esbuild's "keep names" pass adds a `__name()` helper
  call that doesn't exist in the browser).
- **Lottie**: pure JSON parse, no browser needed. Lottie's `o`
  (outTangent)/`i` (inTangent) are already segment-relative normalized
  bezier control points in the same shape as a CSS `cubic-bezier`.

## The `render_graph` tool and why it can't affect grading

`feedback_modes.can_render_and_view_graph` in `task/task.yaml` gives the
worker a `render_graph` tool (`runtime/tools.py`) that runs the same
extractor against its *own current files* and returns a graph-editor plot
image -- a preview aid, nothing else. The official grade is always
computed from scratch, in a separate process, against the **frozen
`final/` snapshot** taken after the rollout ends (`runtime/rollout.py` ->
`grader/grade.py`); the grader never reads anything the worker wrote
claiming to be its curves, so nothing done through that tool can influence
the score.

## The rubric is intentionally not implemented here

`grader/rubric.py` and `grader/tolerances.yaml` are the project owner's own
work. `grade.py` is written against a fixed interface
(`score(curves: dict) -> {"score": float, "checks": {...}}`) so the rest of
the pipeline -- extraction, the fixture/test scaffold, aggregation, the
gallery -- can be built and tested independently with
`python -m grader.grade <run-dir> --stub-rubric`.

## Testing

```bash
make typecheck     # tsc --noEmit over extractor/
make test          # vitest (extractor) + pytest (grader scaffold)
```

## Deferred (not in this pass)

Three.js render target, Web Animations API / Motion frameworks beyond
CSS+GSAP+Lottie, a taste/preference layer (pairwise human preference +
VLM judge), and the rubric itself.
