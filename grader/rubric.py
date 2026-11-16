"""Deterministic rubric over a CanonicalCurveSet. **User-authored** -- this
file is intentionally left as a stub with a fixed interface so the rest of
the pipeline (grade.py, fixtures, tests) can be built and tested against
it independently.

Interface `grade.py` calls:

    score(curves: dict) -> dict

`curves` is the parsed JSON written by `extractor/src/extract.ts` --
see extractor/src/schema.ts:CanonicalCurveSet for its exact shape:

    {
      "framework": "css" | "waa" | "gsap" | "motion" | "lottie",
      "renderTarget": "dom" | "svg" | "three",
      "properties": {
        "x": [ {time, value, inHandle, outHandle, easeSource, presetName}, ... ],
        "y": [...], "scaleX": [...], "scaleY": [...], "rotation": [...]
      },
      "durationSeconds": number,
      "extractionWarnings": string[]
    }

The return value must be:

    {
      "score": float,            # 0..1 overall
      "checks": {                # one entry per rubric check
        "<check_name>": {"score": float, "weight": float, "detail": str}
      }
    }

SIGN CONVENTION. Extracted y is raw DOM/CSS screen space, so y increases
DOWNWARD (task.yaml: floor_y_px = 460, apex = 140). In that raw data a
contact is a local MAXIMUM and an apex is a local MINIMUM, which is
inverted from how the rubric below is worded. Negate y once at the top of
score() -- y_plot = -y -- so contacts become minima and apexes maxima, and
every check below reads in the same orientation a graph editor draws it.
No need for floor_y_px; the negation alone is sufficient. The checks below
all assume this normalization has already been applied.

The graph-editor rubric, for reference (not implemented here):

    1. Translate Y keys sit on contacts and apexes, without excessive
       in-between keys -- exact count: len(y keyframes) must equal
       num_contacts (local minima) + num_apexes (local maxima) in the
       normalized value sequence, zero tolerance for anything extra
    2. Translate Y makes a corner at each contact and a smooth crest at
       each apex. Each key carries two handles -- inHandle pointing back
       at the previous key, outHandle pointing forward at the next -- and
       each handle has a slope of dv/dt. At a contact the two handles must
       form a corner, i.e. their slopes differ (matching slopes would
       round the bounce off instead of reversing it); a linear easeSource
       also produces a corner and passes. At an apex the two handles must
       instead form a straight horizontal line -- matching slopes with
       dv ~= 0 on both -- so the curve crests rather than peaks.
    3. At contacts, the curve stays below the tangent handles and never
       bulges above them -- convex-hull bound: build the 4 absolute
       control points per segment (P0=(time,value), P1=(time+out.dt,
       value+out.dv), P2=(next.time+next.in.dt, next.value+next.in.dv),
       P3=(next.time,next.value)). A cubic Bezier never exits the min/max
       of its 4 control points' values, so the bound reduces to a min/max
       comparison with no curve sampling: for the two segments adjoining a
       contact, no control point's normalized value may fall below the
       contact keyframe's own value. That asserts the contact really is
       the extreme point of the bounce, catching a curve that rounds
       through or under it instead of reversing in a sharp V.
    4. Translate X is linear OR ease-out -- either passes, with no bound
       on how aggressive the ease-out is. Reduces to two conditions over
       the whole x channel: value is monotonic from the first key to the
       last (catches overshoots and backtracking), and velocity
       (dvalue/dtime) is non-increasing throughout, i.e. the curve is
       concave (admits linear's constant velocity and any ease-out's
       decay, rejects ease-in and ease-in-out, which accelerate). The
       "flat spots / steps / overshoots" failure modes need no separate
       rules: a mid-curve flat spot that then picks back up is a velocity
       increase and fails concavity, while an overshoot fails
       monotonicity. A merely decelerating tail is a legitimate ease-out
       and passes.
    5. No stray keys on unused channels (rotate, visibility, etc.)

See tolerances.yaml for where weights/tolerances should live once this is
implemented.
"""
from __future__ import annotations

from typing import Any


def score(curves: dict[str, Any]) -> dict[str, Any]:
    raise NotImplementedError(
        "grader/rubric.py:score() is intentionally unimplemented -- the rubric "
        "is user-authored. See the module docstring for the interface grade.py "
        "expects."
    )
