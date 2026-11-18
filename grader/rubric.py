"""Deterministic rubric over a CanonicalCurveSet. The graph-editor checks
below are user-designed -- every weight, tolerance, and rule is a choice
the user made over the course of several sessions, not something Claude
invented. The score() implementation (2026-11-18) is a direct, mechanical
transcription of that fully-specified design, written by Claude at the
user's explicit request once the spec below was complete, so the rest of
the pipeline (grade.py, fixtures, tests) had something real to run against.

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

SCORING. Every check's "score" is strictly 0.0 or 1.0 -- no partial
credit, even for the multi-condition checks (3's monotonic AND concave,
7's pairing AND constant-difference both need to hold for a 1.0; either
failing is a 0.0 for that check, not a half-credit). "weight" is the raw
point value from the (N pts) tag below (8 or 5). The overall `score` is
sum(check["score"] * check["weight"] for check in checks.values()) / 50.

SIGN CONVENTION. Extracted y is raw DOM/CSS screen space, so y increases
DOWNWARD (task.yaml: floor_y_px = 460, apex = 140). In that raw data a
contact is a local MAXIMUM and an apex is a local MINIMUM, which is
inverted from how the rubric below is worded. Negate y once at the top of
score() -- y_plot = -y -- so contacts become minima and apexes maxima, and
every check below reads in the same orientation a graph editor draws it.
No need for floor_y_px; the negation alone is sufficient. The checks below
all assume this normalization has already been applied.

EXTREMA CLASSIFICATION. Checks 1, 2, and 4 all need to know which
Translate Y keyframes are contacts (local minima of y_plot) vs. apexes
(local maxima), so it's defined once here instead of per-check. For each
keyframe i in the y_plot sequence:
  - Interior keys (0 < i < len-1): contact if y_plot[i] is strictly lower
    than BOTH neighbors; apex if strictly higher than BOTH.
  - Boundary keys (i=0 or i=len-1, only one neighbor): classify off that
    one neighbor alone -- contact if lower than it, apex if higher.
  - A key tied with either neighbor (y_plot[i] == y_plot[i-1] or
    == y_plot[i+1]) is NEITHER a contact nor an apex. This isn't a gap in
    the rule: a flat plateau -- e.g. a submission that adds an explicit
    trailing hold keyframe at the same value, instead of just letting the
    animation end -- is exactly the kind of excess key check 4 is meant
    to catch. An unclassified plateau key shows up as an uncounted extra
    keyframe and fails check 4's exact-count comparison on its own, no
    special case needed.

The graph-editor rubric, for reference (not implemented here). Ordered by
necessity -- how diagnostic each check is of "did the model actually
produce a correct bounce" -- most to least, and weighted accordingly:
checks 1-5 are 8 points each (40), checks 6-7 are 5 points each (10), for
a 50-point total. Divide by 50 for the 0..1 `score` the interface above
expects. See tolerances.yaml for where these weights/tolerances should
actually live once this is implemented.

FRAME UNIT. Checks 6 and 7 size their time tolerances in frames at an
assumed 24fps (1 frame ~= 0.041667s). This is purely a human-friendly unit
for sizing an epsilon -- the schema has no frame-rate field, times are
plain seconds, and css/waa/gsap/motion output is continuous-time, not
actually quantized to any frame grid (only Lottie natively is). "Within 1
frame" just means "within ~0.0417s"; it is not a claim that submissions
snap to a 24fps grid.

    1. (8 pts) At contacts, the curve stays below the tangent handles and
       never bulges above them -- convex-hull bound: build the 4 absolute
       control points per segment (P0=(time,value), P1=(time+out.dt,
       value+out.dv), P2=(next.time+next.in.dt, next.value+next.in.dv),
       P3=(next.time,next.value)). A cubic Bezier never exits the min/max
       of its 4 control points' values, so the bound reduces to a min/max
       comparison with no curve sampling: for the two segments adjoining a
       contact, no control point's normalized value may fall below the
       contact keyframe's own value. That asserts the contact really is
       the extreme point of the bounce, catching a curve that rounds
       through or under it instead of reversing in a sharp V. The single
       most diagnostic check: a curve that fails this doesn't read as a
       bounce at all.
    2. (8 pts) Translate Y makes a corner at each contact and a smooth
       crest at each apex. Each key carries two handles -- inHandle
       pointing back at the previous key, outHandle pointing forward at
       the next -- and each handle has a slope of dv/dt. At a contact the
       two handles must form a corner, i.e. their slopes differ (matching
       slopes would round the bounce off instead of reversing it); a
       linear easeSource also produces a corner and passes. At an apex the
       two handles must instead form a straight horizontal line --
       matching slopes with dv ~= 0 on both -- so the curve crests rather
       than peaks.
    3. (8 pts) Translate X is linear OR ease-out -- either passes, with no
       bound on how aggressive the ease-out is. Reduces to two conditions
       over the whole x channel: value is monotonic from the first key to
       the last (catches overshoots and backtracking), and velocity
       (dvalue/dtime) is non-increasing throughout, i.e. the curve is
       concave (admits linear's constant velocity and any ease-out's
       decay, rejects ease-in and ease-in-out, which accelerate). The
       "flat spots / steps / overshoots" failure modes need no separate
       rules: a mid-curve flat spot that then picks back up is a velocity
       increase and fails concavity, while an overshoot fails
       monotonicity. A merely decelerating tail is a legitimate ease-out
       and passes.
    4. (8 pts) Translate Y keys sit on contacts and apexes, without
       excessive in-between keys -- exact count: len(y keyframes) must
       equal num_contacts (local minima) + num_apexes (local maxima) in
       the normalized value sequence, zero tolerance for anything extra.
       Graph-editor craftsmanship -- a submission can still look right
       with extra keys as long as checks 1-2 hold, so this is more about
       doing it the efficient way than about correctness of the result.
    5. (8 pts) No stray keys on unused channels (rotate, visibility,
       etc.). As of 2026-11-17 the brief scopes the task to POSITION ONLY
       and explicitly forbids keying scale/rotation/opacity, so scaleX,
       scaleY and rotation are all genuinely stray here and this check can
       be strict: each of those channels must have 0 or 1 keyframes.
       Before that the brief invited scale and rotation, which would have
       made penalizing them unfair -- if the brief is ever widened again,
       loosen this.

    6. (5 pts) Translate X and Translate Y come to rest together: the LAST
       keyframe of the x channel and the LAST keyframe of the y channel
       must land on the same frame -- within 1 frame (~0.0417s). The ball
       shouldn't still be rolling after it's done bouncing, or still be
       settling its bounce after it's stopped moving sideways -- both
       channels' motion ends at once. (The `perfect` fixtures were
       regenerated on 2026-11-17 so x's only keyframe after the start is at
       the same time as y's last contact, 4.083333s / frame 98 @24fps.)
    7. (5 pts) Bounce timing decelerates at a CONSTANT RATE -- not uniform
       gaps, and not physical sqrt(h) decay, but an arithmetic progression
       of half-periods. Each bounce i (i=0 for the initial fall from the
       start pose, i=1,2,... for each full bounce after) has a half-period
       d_i: the time from contact to the next apex equals the time from
       that apex back down to the next contact, i.e. each apex sits at the
       exact time midpoint of its two bracketing contacts. Across bounces,
       d_i itself decreases by the same constant step every time:
       d_i - d_(i+1) = constant for all i -- the STEP ITSELF is never
       fixed to any number; it's whatever the submission picks, as long as
       it stays constant. (Example A: half-periods of 14, 12, 10, 8, 6, ...
       frames, each bounce 2 frames shorter than the last. Example B,
       equally valid: 20, 15, 10, 5, ... frames, step 5 instead of 2 --
       both pass, a geometric decay like 14, 10, 7, 5, ... would not,
       since its first differences aren't constant.) Concretely: let
       g_1..g_n be consecutive gaps between Translate Y keyframes
       (alternating apex/contact). g_1 is d_0 on its own; g_2,g_3 must be
       equal (both d_1), g_4,g_5 equal (both d_2), and so on; and the
       resulting sequence d_0, d_1, d_2, ... must have a constant first
       difference. Two tolerances, both on the EQUALITY checks, not on the
       step size: pairing (g_2 ~= g_3, etc.) within 1 frame; the
       constant-difference comparison within 1.5-2 frames, since it's a
       difference of differences and small errors compound across
       bounces.

       NOTE this is the lowest-weighted check because it's purely
       STYLISTIC (an animation-class convention: pacing that decelerates
       smoothly rather than either staying perfectly even or decaying
       geometrically the way real gravity would -- sqrt(h) is NOT linear
       in the bounce index), not physics. A model that nails the shape
       (checks 1-2) with realistic physical timing instead is still doing
       something defensible. The `perfect` fixtures were regenerated on
       2026-11-17 with d_i = 14, 12, 10, 8, 6, 4 frames (24fps assumed --
       the schema has no frame-rate field, times are plain seconds) to
       satisfy this.
"""
from __future__ import annotations

import math
from pathlib import Path
from typing import Any

import yaml

_TOLERANCES_PATH = Path(__file__).resolve().parent / "tolerances.yaml"


def _load_tolerances() -> dict[str, Any]:
    return yaml.safe_load(_TOLERANCES_PATH.read_text())


# ------------------------------------------------------------------ setup

def _negate_y(y_kfs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """y_plot = -y, per SIGN CONVENTION above. A handle's dv is a value
    OFFSET from its keyframe, so it negates too; dt (time) doesn't."""
    out = []
    for kf in y_kfs:
        in_h, out_h = kf.get("inHandle"), kf.get("outHandle")
        out.append({
            "time": kf["time"],
            "value": -kf["value"],
            "inHandle": {"dt": in_h["dt"], "dv": -in_h["dv"]} if in_h else None,
            "outHandle": {"dt": out_h["dt"], "dv": -out_h["dv"]} if out_h else None,
            "easeSource": kf.get("easeSource"),
        })
    return out


def _classify_extrema(y_plot: list[dict[str, Any]]) -> list[str | None]:
    """Per EXTREMA CLASSIFICATION above: 'contact' (local min), 'apex'
    (local max), or None (tied with a neighbor -- unclassified, e.g. a
    flat plateau key)."""
    n = len(y_plot)
    labels: list[str | None] = []
    for i in range(n):
        v = y_plot[i]["value"]
        if n == 1:
            labels.append(None)
            continue
        if i == 0:
            nb = y_plot[1]["value"]
            labels.append("contact" if v < nb else "apex" if v > nb else None)
        elif i == n - 1:
            nb = y_plot[i - 1]["value"]
            labels.append("contact" if v < nb else "apex" if v > nb else None)
        else:
            left, right = y_plot[i - 1]["value"], y_plot[i + 1]["value"]
            if v < left and v < right:
                labels.append("contact")
            elif v > left and v > right:
                labels.append("apex")
            else:
                labels.append(None)
    return labels


def _control_points(a: dict[str, Any], b: dict[str, Any]) -> list[tuple[float, float]]:
    """4 absolute control points for the cubic Bezier segment a->b, per
    check 1's definition. Requires a['outHandle'] and b['inHandle']."""
    return [
        (a["time"], a["value"]),
        (a["time"] + a["outHandle"]["dt"], a["value"] + a["outHandle"]["dv"]),
        (b["time"] + b["inHandle"]["dt"], b["value"] + b["inHandle"]["dv"]),
        (b["time"], b["value"]),
    ]


# ----------------------------------------------------------------- checks
# Each returns (passed, detail). Every check is strictly binary, per
# SCORING above. Tiny fixed epsilons below (1e-9, 1e-6) are float-noise
# guards, not real tolerances -- the real ones come from tolerances.yaml.

def _check_contact_convex_hull(y_plot, labels) -> tuple[bool, str]:
    violations = []
    n = len(y_plot)
    for i, label in enumerate(labels):
        if label != "contact":
            continue
        contact_v = y_plot[i]["value"]
        segments = []
        if i > 0:
            segments.append((y_plot[i - 1], y_plot[i]))
        if i < n - 1:
            segments.append((y_plot[i], y_plot[i + 1]))
        for a, b in segments:
            if not a.get("outHandle") or not b.get("inHandle"):
                violations.append(f"key {i} (t={y_plot[i]['time']}): missing handle(s)")
                continue
            for px, pv in _control_points(a, b):
                if pv < contact_v - 1e-9:
                    violations.append(
                        f"key {i} (t={y_plot[i]['time']:.4f}): control point at t={px:.4f} "
                        f"has value {pv:.4f} < contact value {contact_v:.4f}"
                    )
    if violations:
        return False, "curve bulges past a contact: " + "; ".join(violations)
    return True, "every contact's adjoining control points stay at/above its own value"


def _check_corner_and_crest(y_plot, labels, flat_apex_dv, corner_slope_eps) -> tuple[bool, str]:
    violations = []
    for i, label in enumerate(labels):
        kf = y_plot[i]
        in_h, out_h = kf.get("inHandle"), kf.get("outHandle")
        if label == "apex":
            for name, h in (("inHandle", in_h), ("outHandle", out_h)):
                if h and abs(h["dv"]) > flat_apex_dv:
                    violations.append(f"apex at key {i}: {name}.dv={h['dv']:.4f} isn't flat")
        elif label == "contact" and in_h and out_h:
            # A single-handled (boundary) contact has nothing to compare
            # against, so it passes vacuously.
            slope_in = (in_h["dv"] / in_h["dt"]) if in_h["dt"] else math.inf
            slope_out = (out_h["dv"] / out_h["dt"]) if out_h["dt"] else math.inf
            is_linear = kf.get("easeSource") == "linear"
            if not is_linear and abs(slope_in - slope_out) <= corner_slope_eps:
                violations.append(f"contact at key {i}: handles are smooth, no corner")
    if violations:
        return False, "; ".join(violations)
    return True, "every contact is a corner, every apex a flat crest"


def _check_x_shape(x_kfs) -> tuple[bool, str]:
    if len(x_kfs) < 2:
        return True, "fewer than 2 x keyframes, trivially monotonic/concave"
    direction = 1.0 if x_kfs[-1]["value"] >= x_kfs[0]["value"] else -1.0
    for i in range(len(x_kfs) - 1):
        if (x_kfs[i + 1]["value"] - x_kfs[i]["value"]) * direction < -1e-9:
            return False, f"x value overshoots/backtracks between keys {i} and {i + 1}"

    # Directed velocity: slope projected onto the direction of travel, so
    # decelerating reads as a decreasing sequence regardless of whether x
    # is increasing or decreasing overall.
    samples: list[tuple[float, float]] = []
    for kf in x_kfs:
        for h in (kf.get("inHandle"), kf.get("outHandle")):
            if h:
                slope = (h["dv"] / h["dt"]) if h["dt"] else 0.0
                samples.append((kf["time"], slope * direction))
    samples.sort(key=lambda s: s[0])
    for i in range(len(samples) - 1):
        if samples[i + 1][1] - samples[i][1] > 1e-6:
            return False, (
                f"x velocity increases between t={samples[i][0]:.4f} and "
                f"t={samples[i + 1][0]:.4f} -- not concave"
            )
    return True, "x is monotonic with non-increasing (directed) velocity"


def _check_y_key_count(labels) -> tuple[bool, str]:
    extra = [i for i, l in enumerate(labels) if l is None]
    if extra:
        return False, f"{len(extra)} y keyframe(s) are neither a contact nor an apex (indices {extra})"
    contacts = sum(1 for l in labels if l == "contact")
    apexes = sum(1 for l in labels if l == "apex")
    return True, f"{contacts} contacts + {apexes} apexes, no excess keys"


def _check_no_stray_keys(props) -> tuple[bool, str]:
    bad = [ch for ch in ("scaleX", "scaleY", "rotation") if len(props.get(ch) or []) > 1]
    if bad:
        return False, f"stray keys on: {', '.join(bad)}"
    return True, "no stray keys on unused channels"


def _check_settle_together(x_kfs, y_kfs, tolerance_s) -> tuple[bool, str]:
    if not x_kfs or not y_kfs:
        return False, "x or y channel has no keyframes"
    x_end, y_end = x_kfs[-1]["time"], y_kfs[-1]["time"]
    if abs(x_end - y_end) > tolerance_s:
        return False, f"x ends at t={x_end:.4f}, y ends at t={y_end:.4f} (off by {abs(x_end - y_end):.4f}s)"
    return True, f"x and y both end at ~t={y_end:.4f}"


def _check_bounce_timing(y_plot, pairing_tolerance_s, diff_tolerance_s) -> tuple[bool, str]:
    times = [kf["time"] for kf in y_plot]
    if len(times) < 2:
        return True, "fewer than 2 y keyframes, no timing pattern to evaluate"
    gaps = [times[i + 1] - times[i] for i in range(len(times) - 1)]
    if len(gaps) % 2 == 0:
        return False, f"{len(gaps)} gaps between y keys -- can't split into d_0 plus whole bounces"

    d = [gaps[0]]
    for k in range(1, len(gaps), 2):
        g_a, g_b = gaps[k], gaps[k + 1]
        if abs(g_a - g_b) > pairing_tolerance_s:
            return False, f"bounce half-periods don't match: {g_a:.4f}s vs {g_b:.4f}s (gaps {k + 1},{k + 2})"
        d.append((g_a + g_b) / 2)

    if len(d) <= 2:
        return True, "fewer than 2 full bounces, trivially constant"

    diffs = [d[i] - d[i + 1] for i in range(len(d) - 1)]
    if max(diffs) - min(diffs) > diff_tolerance_s:
        return False, f"half-period decrements aren't constant: {[round(x, 4) for x in diffs]}"
    return True, f"half-periods {[round(x, 4) for x in d]} decrease by a constant ~{diffs[0]:.4f}s/bounce"


# --------------------------------------------------------------------- API

def score(curves: dict[str, Any]) -> dict[str, Any]:
    tol = _load_tolerances()
    frame_s = 1.0 / float(tol["fps"])
    weights = tol["weights"]
    t = tol["tolerances"]

    props = curves.get("properties", {})
    x_kfs = props.get("x") or []
    y_kfs = props.get("y") or []
    y_plot = _negate_y(y_kfs)
    labels = _classify_extrema(y_plot)

    checks: dict[str, dict[str, Any]] = {}

    def _add(name: str, result: tuple[bool, str]) -> None:
        passed, detail = result
        checks[name] = {"score": 1.0 if passed else 0.0, "weight": float(weights[name]), "detail": detail}

    _add("contact_convex_hull", _check_contact_convex_hull(y_plot, labels))
    _add("corner_at_contact_flat_apex", _check_corner_and_crest(
        y_plot, labels, t["flat_apex_dv"], t["corner_slope_eps"]))
    _add("x_shape", _check_x_shape(x_kfs))
    _add("y_key_count", _check_y_key_count(labels))
    _add("no_stray_keys", _check_no_stray_keys(props))
    _add("settle_together", _check_settle_together(
        x_kfs, y_kfs, t["settle_together_frames"] * frame_s))
    _add("bounce_timing", _check_bounce_timing(
        y_plot, t["bounce_timing_pairing_frames"] * frame_s, t["bounce_timing_diff_frames"] * frame_s))

    total_weight = sum(c["weight"] for c in checks.values())
    overall = (sum(c["score"] * c["weight"] for c in checks.values()) / total_weight) if total_weight else 0.0

    return {"score": overall, "checks": checks}
