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




Tools: `read_file`, `write_file`, `list_dir`, `bash`, `finish`, and
`render_graph`, a preview of keyframes/handles as
a graph plot and a filmstrip of stills 

## Rubric

Once the worker finishes, `grader/grade.py` re-extracts curves from a
frozen snapshot of the worker's final files and calls `grader/rubric.py`'s
`score()`, which runs 7 checks and scores **N of 7**:

1. At a given contact point, the ball's path does not bulge past its handlebars
2. Contact points have broken tangents and apexes are smooth
3. Translate X is linear or subtle ease-out (monotonic, non-increasing velocity)
4. Every Y key is either a contact or apex, no unnecessary keys
5. No stray keys on unused channels (scale/rotation)
6. X and Y finish at the same frame
7. The time of each bounce decreases at a constant rate

Each check is a pass/fail spec with **no partial credit** -- "every Y key is
a contact or apex" is a specification, not a tolerance, so one stray key
fails the item outright. That makes the overall score a count, which is why
it is reported as N/7 rather than a weighted total: with no partial credit
the total was always a subset-sum of the weights anyway, and those weights
were near-uniform enough to carry no resolution the count doesn't (29/50 and
4/7 differ by under a point) while obscuring how many specs actually failed.

A single number therefore says little about *behavior* -- two models can
reach the same N by failing entirely different checks. The per-check pass
rate from `analysis/aggregate.py` is the primary output; the scalar is a
convenience.

The rubric items are adapted from this tutorial by Moshe Mahler 
(https://vimeo.com/423284703?fl=pl&fe=vl)

## Findings so far

First multi-model batch: 4 models x 5 seeds on CSS / rubber ball / full
feedback, via OpenRouter, 2026-11-20. 20/20 rollouts completed, none
truncated.

| Model | Score | Per-seed | SD | Cost |
|-------|-------|----------|-----|------|
| `anthropic/claude-opus-5.5` | **4/7** | 4,4,4,4,4 | 0.00 | $1.75 |
| `openai/gpt-6-sol` | **4/7** | 4,4,4,4,4 | 0.00 | $0.41 |
| `openai/gpt-6-luna` | **4/7** | 4,4,4,4,4 | 0.00 | $0.02 |
| `google/gemini-4-hydrogen` | 3.4/7 | 3,3,3,4,4 | 0.55 | $5.24 |

Per-check pass rate (of 5 seeds):

| Check | opus-5.5 | gpt-6-sol | gpt-6-luna | gemini-4-h |
|-------|----------|-----------|------------|------------|
| 1 `contact_convex_hull` | 5/5 | 5/5 | 5/5 | 5/5 |
| 2 `corner_at_contact_flat_apex` | 5/5 | 5/5 | 5/5 | **2/5** |
| 3 `x_shape` | **0/5** | **0/5** | **0/5** | **0/5** |
| 4 `y_key_count` | **0/5** | **0/5** | **0/5** | **0/5** |
| 5 `no_stray_keys` | 5/5 | 5/5 | 5/5 | 5/5 |
| 6 `settle_together` | 5/5 | 5/5 | 5/5 | 5/5 |
| 7 `bounce_timing` | **0/5** | **0/5** | **0/5** | **0/5** |

**The eval does not currently discriminate between frontier models.** Four
checks pass universally and three fail universally (0/20 across every
model), so three different models land on exactly the same score. Reading
the failure details, two structural causes account for most of it:

- **A trailing rest key.** Models end `y` with the ball settled on the floor
  (`...455, 460, 460`). Check 4 flags exactly those last two keys in 11 of
  15 runs, and check 7 fails as "can't split into d_0 plus whole bounces"
  in 11 of 15, because the same extra key makes the gap count odd. One
  artifact breaks two checks, and the brief asks the ball to come to rest.
  Check 7's constant-decrement test is therefore rarely even reached.
- **One timing function per segment, shared across both axes.** Check 3
  fails at `t=0.0000` in 13 of 15 runs: the opening drop needs an ease-in
  for Y, and a single-element `@keyframes` forces X onto that same curve.
  Extracted X and Y key counts are identical in all 20 runs -- (48,48),
  (19,19), (13,13) -- so X cannot be eased independently without splitting
  the transforms across two nested elements. Check 3 may be unsatisfiable
  as the task is currently scaffolded.

Severity is invisible to a pass/fail score but separates the models
sharply: on check 4, one `gpt-6-sol` run has 2 stray keys out of 13 while
an `opus-5.5` run has 33 out of 48. Both score 0. Structured violation
counts (rather than prose `detail` strings) would make that a reportable
axis without introducing partial credit.

Cost note: `gemini-4-hydrogen` ran 14-20 turns and re-sent `render_graph`
images each turn, spending 2.78M input tokens -- 250x `gpt-6-luna` for a
lower score.

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
