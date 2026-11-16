// CSS / Web Animations API / Motion adapter. All three ultimately create
// Animation objects the browser exposes via document.getAnimations(), and
// effect.getKeyframes() returns the AUTHORED transform string per offset
// (not an interpolated matrix), so no bundler-specific handling is needed.
import type { Page } from "playwright";

import type { SegmentEase, Waypoint } from "../curve-builder.js";
import { buildCurveSet } from "../curve-builder.js";
import { resolveCssEasing } from "../ease-to-bezier.js";
import type { CanonicalCurveSet, Framework } from "../schema.js";

type RawTransform = Partial<Record<"x" | "y" | "scaleX" | "scaleY" | "rotation", number>>;

const TRANSFORM_FN_RE = /(translateX|translateY|translate|scaleX|scaleY|scale|rotate)\(([^)]*)\)/g;

function parseTransform(transform: string | undefined | null): RawTransform {
  const out: RawTransform = {};
  if (!transform || transform === "none") return out;
  let m: RegExpExecArray | null;
  TRANSFORM_FN_RE.lastIndex = 0;
  while ((m = TRANSFORM_FN_RE.exec(transform))) {
    const fn = m[1];
    const args = m[2].split(",").map((s) => parseFloat(s.trim()));
    switch (fn) {
      case "translate":
        out.x = args[0];
        if (args.length > 1) out.y = args[1];
        break;
      case "translateX":
        out.x = args[0];
        break;
      case "translateY":
        out.y = args[0];
        break;
      case "scale":
        out.scaleX = args[0];
        out.scaleY = args.length > 1 ? args[1] : args[0];
        break;
      case "scaleX":
        out.scaleX = args[0];
        break;
      case "scaleY":
        out.scaleY = args[0];
        break;
      case "rotate":
        out.rotation = args[0]; // assumes deg; unit is dropped by parseFloat
        break;
    }
  }
  return out;
}

interface RawKeyframe {
  offset: number | null;
  easing: string;
  transform?: string;
}

interface InPageResult {
  error?: string;
  keyframes?: RawKeyframe[];
  durationMs?: number;
}

export async function extractDomAnimations(
  page: Page,
  framework: Framework,
  selector = "#ball",
): Promise<CanonicalCurveSet> {
  const raw: InPageResult = await page.evaluate((sel: string) => {
    const el = document.querySelector(sel);
    if (!el) return { error: `selector not found: ${sel}` };
    const anims = document
      .getAnimations()
      .filter((a) => {
        try {
          return (a as any).effect && (a as any).effect.target === el;
        } catch {
          return false;
        }
      });
    if (anims.length === 0) return { error: `no animations found on ${sel}` };
    const anim = anims.sort((a, b) => {
      const da = (a as any).effect.getTiming().duration;
      const db = (b as any).effect.getTiming().duration;
      return (typeof db === "number" ? db : 0) - (typeof da === "number" ? da : 0);
    })[0] as any;
    const timing = anim.effect.getTiming();
    const durationMs = typeof timing.duration === "number" ? timing.duration : 0;
    const keyframes = anim.effect.getKeyframes().map((k: any) => ({
      offset: k.offset,
      easing: k.easing,
      transform: k.transform,
    }));
    return { keyframes, durationMs };
  }, selector);

  const warnings: string[] = [];
  if (raw.error || !raw.keyframes) {
    warnings.push(raw.error ?? "no keyframes extracted");
    return buildCurveSet(framework, "dom", [], [], warnings);
  }

  const durationSeconds = (raw.durationMs ?? 0) / 1000;
  const keyframes = raw.keyframes;

  const waypoints: Waypoint[] = keyframes.map((k) => ({
    time: (k.offset ?? 0) * durationSeconds,
    values: parseTransform(k.transform),
  }));

  const segmentEases: SegmentEase[] = keyframes.slice(0, -1).map((k) => {
    const easing = k.easing || "linear";
    const resolved = resolveCssEasing(easing);
    const wasExplicitBezier = /^cubic-bezier\(/.test(easing.trim());
    if (resolved.kind === "unsupported") warnings.push(`unsupported easing: ${easing}`);
    return { resolved, wasExplicitBezier };
  });

  return buildCurveSet(framework, "dom", waypoints, segmentEases, warnings);
}
