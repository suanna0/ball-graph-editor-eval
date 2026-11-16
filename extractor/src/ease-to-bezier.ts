// Converts named eases (CSS keywords, GSAP presets) and CSS
// cubic-bezier(...) strings into normalized [0,1]x[0,1] control points,
// then into absolute {dt, dv} handles for a specific segment.
//
// GSAP's power1/2/3/4 correspond to quad/cubic/quart/quint easing curves.
// The control points below are the standard quad/cubic/quart/quint cubic-
// bezier approximations (as published by easings.net), not an exact
// polynomial match -- GSAP's power eases are pure polynomials, not cubic
// beziers, so any bezier handle representation of them is an
// approximation. `presetName` is always recorded alongside so a rubric
// that wants exactness can compare against the true polynomial instead of
// this approximation.

import type { EaseSource, Handle } from "./schema.js";

export interface ResolvedEase {
  kind: "linear" | "bezier" | "unsupported";
  // Normalized control points, only when kind === "bezier".
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  presetName: string;
}

const CSS_NAMED: Record<string, [number, number, number, number] | "linear"> = {
  linear: "linear",
  ease: [0.25, 0.1, 0.25, 1.0],
  "ease-in": [0.42, 0, 1.0, 1.0],
  "ease-out": [0, 0, 0.58, 1.0],
  "ease-in-out": [0.42, 0, 0.58, 1.0],
};

// Standard quad/cubic/quart/quint cubic-bezier approximations.
const POWER_CURVES: Record<string, [number, number, number, number]> = {
  "power1.in": [0.11, 0, 0.5, 0],
  "power1.out": [0.5, 1, 0.89, 1],
  "power1.inOut": [0.45, 0, 0.55, 1],
  "power2.in": [0.32, 0, 0.67, 0],
  "power2.out": [0.33, 1, 0.68, 1],
  "power2.inOut": [0.65, 0, 0.35, 1],
  "power3.in": [0.5, 0, 0.75, 0],
  "power3.out": [0.25, 1, 0.5, 1],
  "power3.inOut": [0.76, 0, 0.24, 1],
  "power4.in": [0.64, 0, 0.78, 0],
  "power4.out": [0.22, 1, 0.36, 1],
  "power4.inOut": [0.83, 0, 0.17, 1],
};

const CUBIC_BEZIER_RE = /^cubic-bezier\(\s*([\d.+-]+)\s*,\s*([\d.+-]+)\s*,\s*([\d.+-]+)\s*,\s*([\d.+-]+)\s*\)$/;

export function resolveCssEasing(raw: string): ResolvedEase {
  const name = raw.trim();
  const m = CUBIC_BEZIER_RE.exec(name);
  if (m) {
    const [x1, y1, x2, y2] = m.slice(1, 5).map(Number);
    return { kind: "bezier", x1, y1, x2, y2, presetName: name };
  }
  const named = CSS_NAMED[name];
  if (named === "linear") return { kind: "linear", presetName: name };
  if (named) return { kind: "bezier", x1: named[0], y1: named[1], x2: named[2], y2: named[3], presetName: name };
  return { kind: "unsupported", presetName: name };
}

export function resolveGsapEase(raw: string | undefined): ResolvedEase {
  const name = (raw ?? "none").trim();
  if (name === "none" || name === "linear" || name === "Linear.easeNone") {
    return { kind: "linear", presetName: name };
  }
  const curve = POWER_CURVES[name];
  if (curve) return { kind: "bezier", x1: curve[0], y1: curve[1], x2: curve[2], y2: curve[3], presetName: name };
  // CustomEase / plugin-based eases are not resolvable from the name alone.
  return { kind: "unsupported", presetName: name };
}

export function easeSourceFor(resolved: ResolvedEase, wasExplicitBezier: boolean): EaseSource {
  if (resolved.kind === "unsupported") return "unsupported";
  if (resolved.kind === "linear") return "linear";
  return wasExplicitBezier ? "hand-placed" : "preset";
}

/** outHandle at the start of a segment, inHandle at its end, both as
 * absolute {dt, dv} given the segment's actual duration and value delta. */
export function handlesForSegment(
  resolved: ResolvedEase,
  deltaT: number,
  deltaV: number,
): { out: Handle; in: Handle } {
  if (resolved.kind !== "bezier") {
    // Linear or unsupported: fall back to a straight-line (1/3-length,
    // on-the-secant) handle so downstream angle/length checks degrade
    // gracefully instead of crashing on a null.
    return {
      out: { dt: deltaT / 3, dv: deltaV / 3 },
      in: { dt: -deltaT / 3, dv: -deltaV / 3 },
    };
  }
  const { x1 = 0, y1 = 0, x2 = 1, y2 = 1 } = resolved;
  return {
    out: { dt: x1 * deltaT, dv: y1 * deltaV },
    in: { dt: -(1 - x2) * deltaT, dv: -(1 - y2) * deltaV },
  };
}
