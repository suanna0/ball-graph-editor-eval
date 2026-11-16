// Lottie adapter. Pure JSON parse -- no browser needed. Lottie's own
// keyframe `o` (outTangent, leaving this keyframe) / `i` (inTangent,
// arriving at the next keyframe) are already segment-relative, normalized
// bezier control points in exactly the same [0,1]x[0,1] shape as a CSS
// cubic-bezier(x1,y1,x2,y2) -- o.x/o.y is (x1,y1), i.x/i.y is (x2,y2) --
// so they convert the same way as any other preset/hand-placed ease.
import { readFileSync } from "node:fs";
import path from "node:path";

import { buildPropertyKeyframes } from "../curve-builder.js";
import type { SegmentEase } from "../curve-builder.js";
import type { ResolvedEase } from "../ease-to-bezier.js";
import type { CanonicalCurveSet, PropertyName } from "../schema.js";
import { emptyCurveSet } from "../schema.js";

interface LottieTangent {
  x: number[];
  y: number[];
}
interface LottieKeyframe {
  t: number;
  s?: number[];
  h?: number;
  i?: LottieTangent;
  o?: LottieTangent;
}
interface LottieAnimatedProp {
  a: 1;
  k: LottieKeyframe[];
}
interface LottieStaticProp {
  a: 0;
  k: number[] | number;
}
type LottieProp = LottieAnimatedProp | LottieStaticProp;

function isAnimated(p: LottieProp | undefined): p is LottieAnimatedProp {
  return !!p && (p as LottieAnimatedProp).a === 1;
}

function easeFromTangents(
  o: LottieTangent | undefined,
  i: LottieTangent | undefined,
  dim: number,
  warnings: string[],
  label: string,
): ResolvedEase {
  if (!o || !i) return { kind: "linear", presetName: "linear" };
  const x1 = o.x[dim] ?? o.x[0];
  const y1 = o.y[dim] ?? o.y[0];
  const x2 = i.x[dim] ?? i.x[0];
  const y2 = i.y[dim] ?? i.y[0];
  if ([x1, y1, x2, y2].some((v) => typeof v !== "number" || Number.isNaN(v))) {
    warnings.push(`${label}: malformed bezier tangent, falling back to linear`);
    return { kind: "linear", presetName: "linear" };
  }
  const presetName = `bezier(${x1},${y1},${x2},${y2})`;
  return { kind: "bezier", x1, y1, x2, y2, presetName };
}

function extractProperty(
  prop: LottieProp | undefined,
  dim: number,
  fps: number,
  warnings: string[],
  label: string,
  scale = 1,
) {
  if (!prop) return { times: [] as number[], values: [] as number[] };
  if (!isAnimated(prop)) {
    const k = Array.isArray(prop.k) ? prop.k[dim] : prop.k;
    if (typeof k !== "number") return { times: [], values: [] };
    return { times: [0], values: [k * scale] };
  }
  const times: number[] = [];
  const values: number[] = [];
  const eases: SegmentEase[] = [];
  const kfs = prop.k;
  for (const kf of kfs) {
    const v = kf.s?.[dim];
    if (v === undefined) continue;
    times.push(kf.t / fps);
    values.push(v * scale);
  }
  for (let n = 0; n < kfs.length - 1; n++) {
    const kf = kfs[n];
    if (kf.h === 1) {
      warnings.push(`${label}: hold keyframe at frame ${kf.t} treated as unsupported ease`);
      eases.push({ resolved: { kind: "unsupported", presetName: "hold" }, wasExplicitBezier: false });
      continue;
    }
    const resolved = easeFromTangents(kf.o, kf.i, dim, warnings, label);
    eases.push({ resolved, wasExplicitBezier: resolved.kind === "bezier" });
  }
  if (times.length < 2) return { times, values };
  return { times, values, keyframes: buildPropertyKeyframes(times, values, eases) };
}

export function extractLottie(siteDir: string, layerName = "ball", layerFile = "animation.json"): CanonicalCurveSet {
  const warnings: string[] = [];
  const full = path.join(siteDir, layerFile);
  let data: any;
  try {
    data = JSON.parse(readFileSync(full, "utf-8"));
  } catch (e) {
    return { ...emptyCurveSet("lottie", "dom"), extractionWarnings: [`failed to read/parse ${layerFile}: ${e}`] };
  }
  const fps: number = data.fr ?? 30;
  const layer = (data.layers ?? []).find((l: any) => l.nm === layerName);
  if (!layer) {
    return { ...emptyCurveSet("lottie", "dom"), extractionWarnings: [`no layer named "${layerName}" found`] };
  }
  const ks = layer.ks ?? {};

  const result = emptyCurveSet("lottie", "dom");
  const assign = (name: PropertyName, times: number[], values: number[], keyframes?: ReturnType<typeof buildPropertyKeyframes>) => {
    if (times.length === 0) return;
    result.properties[name] = keyframes ?? [
      { time: times[0], value: values[0], inHandle: null, outHandle: null, easeSource: "linear" },
    ];
  };

  const px = extractProperty(ks.p, 0, fps, warnings, "x");
  assign("x", px.times, px.values, px.keyframes);
  const py = extractProperty(ks.p, 1, fps, warnings, "y");
  assign("y", py.times, py.values, py.keyframes);
  const sx = extractProperty(ks.s, 0, fps, warnings, "scaleX", 1 / 100);
  assign("scaleX", sx.times, sx.values, sx.keyframes);
  const sy = extractProperty(ks.s, 1, fps, warnings, "scaleY", 1 / 100);
  assign("scaleY", sy.times, sy.values, sy.keyframes);
  const rot = extractProperty(ks.r, 0, fps, warnings, "rotation");
  assign("rotation", rot.times, rot.values, rot.keyframes);

  const allTimes = Object.values(result.properties).flatMap((kfs) => kfs.map((k) => k.time));
  result.durationSeconds = allTimes.length > 0 ? Math.max(...allTimes) : 0;
  result.extractionWarnings = warnings;
  return result;
}
