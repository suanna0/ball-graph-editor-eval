# Ball Bounce Eval

This evaluation environment compares how well different AI models animate a ball 
bounce by inspecting keyframes and bezier curves in a reconstructed graph 
instead of only grading the visual output.

A ball bounce is a beginner animation exercise that teaches students how to read 
and modify the graph editor to create appealing animations. This exercise is 
effective because it is easy to spot when the animation looks wrong, and there 
are few enough moving parts that the exercise stays focused on reading the graph 
editor.

Each rollout receives prompt `task/brief.md.j2`: the scene
(viewport size, duration, start and end position) the ball's material, and the 
constraints (keyframes and easing only, no physics-simulation loop). It also 
gets instructions for which file to edit and how, depending on the cell:

| Framework | File edited       | Motion API                | Position properties | Easing format              |
|-----------|--------------------|---------------------------|----------------------|----------------------------|
| CSS       | `style.css`        | `@keyframes` rule         | `transform: translateX/Y` | `animation-timing-function` (cubic-bezier) |
| GSAP      | `animation.js`     | `gsap.to` / `gsap.timeline` | `x` / `y`            | named eases (`"power2.out"`) or custom |
| Lottie    | `animation.json`   | direct JSON edit (Bodymovin format) | `ks.p` (position)    | `i`/`o` bezier tangents    |




Tools: `read_file`, `write_file`, `list_dir`, `bash`, `finish`, and
`render_graph`, a preview of keyframes/handles as
a graph plot and a filmstrip of stills. 

## Rubric

Once the worker finishes, `grader/grade.py` re-extracts curves from a
frozen snapshot of the worker's final files and calls `grader/rubric.py`'s
`score()`, which runs 7 checks for a score out of 50 points:

1. At a given contact point, the ball's path does not bulge past its handlebars (8 pts)
2. Contact points have broken tangents and apexes are smooth (8 pts)
3. Translate X is linear or subtle ease-out (monotonic, non-increasing velocity) (8 pts)
4. Every Y key is either a contact or apex, no unnecessary keys (8 pts)
5. No stray keys on unused channels (scale/rotation) (8 pts)
6. X and Y finish at the same frame (5 pts)
7. The time of each bounce decreases at a constant rate (5 pts)

The rubric items are adapted from this tutorial by Moshe Mahler 
(https://vimeo.com/423284703?fl=pl&fe=vl).

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
                score.json. The checks in rubric.py/tolerances.yaml are the
                project owner's own design -- see below.
analysis/       Python. Aggregate report (bootstrap CIs) and the HTML
                gallery over a runs/ directory.
runs/           Gitignored. One <timestamp>[_<label>]/ batch directory per
                `run-batch` invocation, each holding one subdirectory per
                rollout cell.
```

## Quickstart

```bash
cp .env.example .env   # fill in ANTHROPIC_API_KEY
make build
make dry-run                              # see which cells runner.yaml's grid expands to
make run-batch LIMIT=1 LABEL=smoke-test   # run just the first cell
make grade RUN=<printed run dir>          # extract + score (add STUB=1 for a stub rubric)
make aggregate
make gallery                              # writes runs/gallery.html
```

Widen the grid by editing `runner.yaml` (`worker.models`, `grid.frameworks`,
`grid.materials`, `grid.feedback_modes`, `grid.seeds`); the physical task
itself (viewport, floor, ball size, time window) lives in `task/task.yaml`
and is shared by every cell. `aggregate`/`gallery` scan all of `runs/`
regardless of batch nesting.

## Canonical curve schema

Every adapter (`extractor/src/adapters/{domAnimations,gsap,lottie}.ts`)
converts whatever the worker authored into one framework-agnostic shape --
see `extractor/src/schema.ts`. Handles are stored relative to their own
keyframe (`{dt, dv}`), not normalized bezier control points, so a CSS
`cubic-bezier(...)`, a GSAP named ease, and Lottie's own `i`/`o` tangents
are all directly comparable without re-deriving per-segment scale factors.

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
fixture page with known keyframes -- run with `npx vitest run`.

**Per-framework notes:** CSS/WAA/Motion all read via
`document.getAnimations()[].effect.getKeyframes()`, which returns the
*authored* transform string per offset, so it's just regex-parsed for
`translate`/`scale`/`rotate`. GSAP is extracted by injecting a wrapper
around the global `window.gsap` before the page's own script runs (it has
to be plain-JS source, not a serialized TS function -- see the comment at
the top of `gsap.ts`). Lottie needs no browser at all: its `i`/`o`
tangents are already segment-relative normalized bezier controls, same
shape as a CSS `cubic-bezier`.

## Testing

```bash
make typecheck     # tsc --noEmit over extractor/
make test          # vitest (extractor) + pytest (grader scaffold)
```
