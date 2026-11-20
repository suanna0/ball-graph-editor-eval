# Ball Bounce Eval

A ball bounce is a beginner animation exercise that teaches students how to read 
and modify the graph editor to creaidkte appealing animations. This exercise is 
effective because it is easy to spot when the animation looks wrong, and there 
are few enough moving parts that the exercise stays focused on reading the graph 
editor.

This evaluation environment compares how well different AI models animate a ball 
bounce by inspecting keyframes and bezier curves in a reconstructed graph 
instead of only grading the visual output.

**Why can't we use a physics simulation?**

In animation, character movement doesn't always have to follow the rules
of physics. Balls travel in parabolic paths, but a half-circle arc could
look more appealing for a simplified cartoon. Another example of a simplification
is the ball's height decay over time. In real life, a ball's bounce height decays 
exponentially, while a linear decay looks good enough to the human eye.

Each rollout receives prompt `task/brief.md.j2`: the scene
(viewport size, duration, start and end position) the ball's material, and the 
constraints (keyframes and easing only, no physics-simulation loop). It also 
gets instructions for which file to edit and how, depending on the cell:

| Framework | File edited       | Motion API                | Position properties | Easing format              |
|-----------|--------------------|---------------------------|----------------------|----------------------------|
| CSS       | `style.css`        | `@keyframes` rule         | `transform: translateX/Y` | `animation-timing-function` (cubic-bezier) |
| GSAP      | `animation.js`     | `gsap.to` / `gsap.timeline` | `x` / `y`            | named eases (`"power2.out"`) or custom |
| Lottie    | `animation.json`   | direct JSON edit (Bodymovin format) | `ks.p` (position)    | `i`/`o` bezier tangents    |




Tools: `read_file`, `write_file`, `list_dir`, `bash`, `render_graph`, and
`finish`. `render_graph` previews the work in progress: keyframes and
Bezier handles as a graph-editor plot, and stills rendered across even time
points.

## Rubric

Once the worker finishes, `grader/grade.py` re-extracts curves from a
frozen snapshot of the worker's final files and calls `grader/rubric.py`'s
`score()`, which runs 10 checks and scores N of 10. Every check is pass/fail 
with no partial credit. Both `grader/fixtures/perfect/` fixtures score 10/10. A 
single number says little about behavior, so the per-check pass rate from 
`analysis/aggregate.py` is the primary output.

1. Attempts at least 3 bounces (the ball meets the floor 3+ times)
2. At a given contact point, the ball's path does not bulge past its handlebars
3. Contact points have broken tangents and apexes are smooth
4. Translate X is linear or subtle ease-out (monotonic, non-increasing velocity)
5. Every Y key is either a contact or apex, no unnecessary keys
6. At most two X keys, indicating a smooth path that is easily modifiable
7. No stray keys on unused channels (scale/rotation)
8. The final X key lands either on the last contact of the last bounce, or one
   last-bounce length past it (the ball rolling to a stop)
9. The time of each bounce decreases at a constant rate
10. Contact points have handles of length greater than zero

The rubric items are adapted from this tutorial by Moshe Mahler 
(https://vimeo.com/423284703?fl=pl&fe=vl)

## Findings

First multi-model batch: 4 models x 5 seeds on CSS / rubber ball / full
feedback, via OpenRouter, 2026-11-20. 20/20 rollouts completed, none
truncated.

Re-scored under the current 10-check rubric. The rollouts themselves are
unchanged -- `grade.py` re-extracts from each run's frozen `final/`
snapshot, so the rubric can be revised and the same corpus re-scored with
no model calls.

| Model | Score | Per-seed | CI95 | Cost |
|-------|-------|----------|------|------|
| `anthropic/claude-opus-5.5` | **5.2/10** | 6,5,5,5,5 | 5.0–5.6 | $1.75 |
| `openai/gpt-6-sol` | **5.0/10** | 5,5,5,5,5 | 5.0–5.0 | $0.41 |
| `openai/gpt-6-luna` | 4.4/10 | 5,5,4,4,4 | 4.0–4.8 | $0.02 |
| `google/gemini-4-hydrogen` | 4.0/10 | 5,5,4,3,3 | 3.2–4.8 | $5.24 |

Per-check pass rate (of 5 seeds):

| Check | opus-5.5 | gpt-6-sol | gpt-6-luna | gemini-4-h |
|-------|----------|-----------|------------|------------|
| 1 `min_bounces` | 5/5 | 5/5 | 5/5 | 5/5 |
| 2 `contact_convex_hull` | 5/5 | 5/5 | 5/5 | 5/5 |
| 3 `corner_at_contact_flat_apex` | 5/5 | 5/5 | 5/5 | **2/5** |
| 4 `x_shape` | **0/5** | **0/5** | **0/5** | **0/5** |
| 5 `y_key_count` | **0/5** | **0/5** | **0/5** | **0/5** |
| 6 `x_key_count` | **0/5** | **0/5** | **0/5** | **0/5** |
| 7 `no_stray_keys` | 5/5 | 5/5 | 5/5 | 5/5 |
| 8 `final_x_key` | 1/5 | **0/5** | **0/5** | **0/5** |
| 9 `bounce_timing` | **0/5** | **0/5** | **0/5** | **0/5** |
| 10 `contact_handles_nontrivial` | 5/5 | 5/5 | **2/5** | **3/5** |

Three checks pass universally and four fail universally, so most of the
separation between models comes from just two checks: 3 and 10. Check 10 is
the strongest discriminator -- it varies both between models and between
seeds of the same model, catching contacts whose easing leaves no tangent
control there at all (CSS `ease-in`'s second control point sits at `(1,1)`
and `ease-out`'s first at `(0,0)`, both collapsing onto the endpoint they
attach to, so a very natural easing choice yields zero-length handles
exactly at the contacts).

**Checks 4 and 6 are not currently reachable.** Both concern the x channel,
and the CSS brief directs workers to a single `@keyframes` rule driven by
`transform` -- inside one such rule every stop sets the whole transform
value, so x takes a key wherever y does and inherits y's per-segment
easing. Extracted x and y key counts are identical in all 20 runs: (48,48),
(19,19), (13,13). Meanwhile `grader/fixtures/perfect/` has x:2 / y:14, so
the rubric grades against a shape the brief forbids, and check 8 is largely
downstream of the same cause (x's final key lands at the animation's end
rather than at the last contact). Fixing this is a task-design change, not
a rubric one.

## Repo layout

```
runtime/        Python. Orchestrates rollouts: Docker sandbox, agent loop,
                tool bridge, experiment-grid expansion, batch CLI.
                runtime/providers/ wraps each model API behind one neutral
                interface so the agent loop never touches a provider-
                specific wire format.
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
cp .env.example .env   # fill in ANTHROPIC_API_KEY (and OPENROUTER_API_KEY if using that provider)
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

### Models and providers

`runner.yaml`'s `worker.provider` picks the wire protocol, independent of
which models are listed under `worker.models`:

- `anthropic` -- direct Anthropic API, model IDs like `claude-opus-5`.
- `openrouter` -- OpenAI-compatible endpoint covering every non-Anthropic
  family in one adapter (GPT, Gemini, Llama, etc.), model IDs like
  `openai/gpt-5`, `google/gemini-3-pro`. Needs `OPENROUTER_API_KEY`.

Both are implemented behind the same `Provider` interface
(`runtime/providers/base.py`); the agent loop, rollout runner, and grid
expansion never branch on which one is active. Adding another model
family that isn't covered by OpenRouter means adding one more module next
to `runtime/providers/{anthropic,openrouter}_provider.py` -- nothing else
in `runtime/` changes. `thinking`/`output_config` in `runner.yaml` are
Anthropic-specific and are ignored (with a warning) under `openrouter`.

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
