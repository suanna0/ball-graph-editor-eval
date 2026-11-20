// CSS / Web Animations API / Motion adapter. All three ultimately create
// Animation objects the browser exposes via document.getAnimations(), and
// effect.getKeyframes() returns the AUTHORED transform string per offset
// (not an interpolated matrix), so no bundler-specific handling is needed.
import type { Page } from "playwright";

import type { SegmentEase, Waypoint } from "../curve-builder.js";
import { buildCurveSet } from "../curve-builder.js";
import { resolveCssEasing } from "../ease-to-bezier.js";
import type { CanonicalCurveSet, Framework } from "../schema.js";
import { emptyCurveSet, PROPERTY_NAMES } from "../schema.js";

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
  animations?: RawAnimation[];
}

interface RawAnimation {
  durationMs: number;
  keyframes: RawKeyframe[];
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
    // Every animation on the element, in getAnimations() order -- not just
    // the longest. A submission is free to drive each channel from its own
    // animation (e.g. translateX under one @keyframes and translateY under
    // another, composed with animation-composition: add), which is the only
    // way CSS lets the two axes carry independent keyframe times and
    // easing. Keeping one animation here silently dropped the other
    // channel.
    const animations = anims.map((a) => {
      const anim = a as any;
      const timing = anim.effect.getTiming();
      return {
        durationMs: typeof timing.duration === "number" ? timing.duration : 0,
        keyframes: anim.effect.getKeyframes().map((k: any) => ({
          offset: k.offset,
          easing: k.easing,
          transform: k.transform,
        })),
      };
    });
    return { animations };
  }, selector);

  const warnings: string[] = [];
  if (raw.error || !raw.animations) {
    warnings.push(raw.error ?? "no keyframes extracted");
    return buildCurveSet(framework, "dom", [], [], warnings);
  }

  // Assemble each animation on its own. Within one @keyframes rule every
  // property genuinely does share a single keyframe grid and one ease per
  // gap -- a stop sets the whole transform value -- which is exactly what
  // buildCurveSet assumes. Across animations nothing is shared, so they
  // are merged per channel below rather than flattened onto one timeline.
  const perAnimation = raw.animations.map((a) => {
    const durationSeconds = a.durationMs / 1000;
    const waypoints: Waypoint[] = a.keyframes.map((k) => ({
      time: (k.offset ?? 0) * durationSeconds,
      values: parseTransform(k.transform),
    }));
    const segmentEases: SegmentEase[] = a.keyframes.slice(0, -1).map((k) => {
      const easing = k.easing || "linear";
      const resolved = resolveCssEasing(easing);
      const wasExplicitBezier = /^cubic-bezier\(/.test(easing.trim());
      if (resolved.kind === "unsupported") warnings.push(`unsupported easing: ${easing}`);
      return { resolved, wasExplicitBezier };
    });
    return buildCurveSet(framework, "dom", waypoints, segmentEases, warnings);
  });

  const result = emptyCurveSet(framework, "dom");
  for (const prop of PROPERTY_NAMES) {
    const driving = perAnimation.filter((set) => set.properties[prop].length > 0);
    if (driving.length === 0) continue;
    if (driving.length > 1) {
      // Competing animations on one property resolve in favour of the one
      // later in animation-name, and getAnimations() reports them in that
      // order, so the last is the one actually on screen.
      warnings.push(`${prop}: driven by ${driving.length} animations; using the last`);
    }
    result.properties[prop] = driving[driving.length - 1].properties[prop];
  }

  // An animation that set nothing we read -- it drives `translate`,
  // `left`/`top`, a custom property, something off the transform string.
  // Said out loud, because the alternative is a channel going missing with
  // no explanation and the submission looking simply worse than it is.
  const silent = perAnimation.filter((set) =>
    PROPERTY_NAMES.every((prop) => set.properties[prop].length === 0),
  ).length;
  if (silent > 0) {
    warnings.push(
      `${silent} animation(s) on the target contributed no transform channel; ` +
        `only transform translate/scale/rotate is read`,
    );
  }

  const allTimes = Object.values(result.properties).flatMap((kfs) => kfs.map((k) => k.time));
  result.durationSeconds = allTimes.length > 0 ? Math.max(...allTimes) : 0;
  result.extractionWarnings = warnings;
  return result;
}
