// Canonical, framework-agnostic curve schema. Every adapter (CSS/WAA/Motion
// via document.getAnimations(), GSAP via a recorder wrapper, Lottie via
// direct JSON parse) converts into this shape. Units are absolute: px for
// x/y, a unitless ratio for scaleX/scaleY (1 = 100%), degrees for rotation.
//
// Handles are stored RELATIVE TO THEIR OWN KEYFRAME (dt seconds, dv in the
// property's unit), not as normalized 0..1 bezier control points. That
// makes a CSS cubic-bezier(x1,y1,x2,y2), a GSAP named ease, and Lottie's
// own i/o tangents directly comparable to an ideal-parabola handle without
// re-deriving per-segment scale factors downstream in the rubric.

export type EaseSource = "preset" | "hand-placed" | "linear" | "unsupported";

export interface Handle {
  dt: number; // seconds, signed: negative for inHandle, positive for outHandle
  dv: number; // property units, same sign convention
}

export interface Keyframe {
  time: number; // seconds, absolute, from animation start
  value: number;
  inHandle: Handle | null; // null on the first keyframe of the property
  outHandle: Handle | null; // null on the last keyframe of the property
  // easeSource/presetName describe the ease applied to the OUTGOING
  // segment (this keyframe -> the next one). They're meaningless on the
  // last keyframe of a property, which has no outgoing segment.
  easeSource: EaseSource;
  presetName?: string; // e.g. "power2.in", "ease-in-out", "cubic-bezier(...)"
}

export type PropertyName = "x" | "y" | "scaleX" | "scaleY" | "rotation";

export type Framework = "css" | "waa" | "gsap" | "motion" | "lottie";
export type RenderTarget = "dom" | "svg" | "three";

export interface CanonicalCurveSet {
  framework: Framework;
  renderTarget: RenderTarget;
  properties: Record<PropertyName, Keyframe[]>;
  durationSeconds: number;
  extractionWarnings: string[];
}

export const PROPERTY_NAMES: PropertyName[] = ["x", "y", "scaleX", "scaleY", "rotation"];

export function emptyCurveSet(framework: Framework, renderTarget: RenderTarget = "dom"): CanonicalCurveSet {
  return {
    framework,
    renderTarget,
    properties: { x: [], y: [], scaleX: [], scaleY: [], rotation: [] },
    durationSeconds: 0,
    extractionWarnings: [],
  };
}
