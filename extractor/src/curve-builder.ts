// Shared assembly step used by every adapter: turn a list of waypoints
// (absolute time + whatever properties are known at that time) plus a
// resolved ease per segment into the canonical per-property Keyframe[]
// arrays. Adapters differ only in how they produce waypoints/eases.

import type { CanonicalCurveSet, Framework, Keyframe, PropertyName, RenderTarget } from "./schema.js";
import { PROPERTY_NAMES } from "./schema.js";
import type { ResolvedEase } from "./ease-to-bezier.js";
import { easeSourceFor, handlesForSegment } from "./ease-to-bezier.js";

export interface Waypoint {
  time: number;
  values: Partial<Record<PropertyName, number>>;
}

export interface SegmentEase {
  resolved: ResolvedEase;
  wasExplicitBezier: boolean;
}

/** Builds one property's Keyframe[] from its OWN times/values/eases.
 * `segmentEases[k]` is the ease for the segment from times[k] to
 * times[k+1]; length must be times.length - 1. This is the primitive
 * every adapter ultimately calls -- shared-grid adapters (DOM, GSAP) go
 * through `buildCurveSet` below; per-property-grid adapters (Lottie, where
 * each property keeps its own independent keyframe times) call this
 * directly. */
export function buildPropertyKeyframes(
  times: number[],
  values: number[],
  segmentEases: SegmentEase[],
): Keyframe[] {
  if (times.length !== values.length) {
    throw new Error(`curve-builder: times/values length mismatch (${times.length} vs ${values.length})`);
  }
  if (times.length > 0 && segmentEases.length !== times.length - 1) {
    throw new Error(
      `curve-builder: expected ${Math.max(times.length - 1, 0)} segment eases, got ${segmentEases.length}`,
    );
  }
  const kfs: Keyframe[] = values.map((v, i) => ({
    time: times[i],
    value: v,
    inHandle: null,
    outHandle: null,
    easeSource: "linear" as const,
  }));
  for (let k = 0; k < times.length - 1; k++) {
    const se = segmentEases[k];
    const deltaT = times[k + 1] - times[k];
    const deltaV = values[k + 1] - values[k];
    const { out, in: inHandle } = handlesForSegment(se.resolved, deltaT, deltaV);
    kfs[k].outHandle = out;
    kfs[k].easeSource = easeSourceFor(se.resolved, se.wasExplicitBezier);
    kfs[k].presetName = se.resolved.presetName;
    kfs[k + 1].inHandle = inHandle;
  }
  return kfs;
}

/** Shared-grid assembly: every property is sampled on the SAME waypoint
 * timeline, with one ease per gap shared across whichever properties
 * change in that gap (the common case for CSS/WAA/GSAP, where one
 * keyframe "moment" moves several properties together under one easing
 * curve). */
export function buildCurveSet(
  framework: Framework,
  renderTarget: RenderTarget,
  waypoints: Waypoint[],
  segmentEases: SegmentEase[],
  warnings: string[] = [],
): CanonicalCurveSet {
  if (waypoints.length > 0 && waypoints.length !== segmentEases.length + 1) {
    throw new Error(
      `curve-builder: expected ${Math.max(waypoints.length - 1, 0)} segment eases for ${waypoints.length} waypoints, got ${segmentEases.length}`,
    );
  }

  const properties: Record<PropertyName, Keyframe[]> = { x: [], y: [], scaleX: [], scaleY: [], rotation: [] };

  for (const prop of PROPERTY_NAMES) {
    const present = waypoints
      .map((w, i) => ({ i, v: w.values[prop] }))
      .filter((w): w is { i: number; v: number } => w.v !== undefined);
    if (present.length === 0) continue;

    if (present.length === 1) {
      properties[prop] = [
        { time: waypoints[present[0].i].time, value: present[0].v, inHandle: null, outHandle: null, easeSource: "linear" },
      ];
      continue;
    }

    const times: number[] = [];
    const values: number[] = [];
    const eases: SegmentEase[] = [];
    for (let k = 0; k < present.length; k++) {
      times.push(waypoints[present[k].i].time);
      values.push(present[k].v);
      if (k < present.length - 1) {
        const a = present[k];
        const b = present[k + 1];
        if (b.i !== a.i + 1) {
          warnings.push(`${prop}: waypoints ${a.i} and ${b.i} are not adjacent; treating as one segment`);
        }
        eases.push(segmentEases[a.i]);
      }
    }
    properties[prop] = buildPropertyKeyframes(times, values, eases);
  }

  const durationSeconds = waypoints.length > 0 ? waypoints[waypoints.length - 1].time : 0;
  return { framework, renderTarget, properties, durationSeconds, extractionWarnings: warnings };
}
