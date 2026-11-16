// GSAP adapter. Per the brief: inject a wrapper around gsap.to/timeline
// *before* the page's own script runs, so every tween and its authored
// ease is recorded regardless of how the worker structured its code.
//
// The wrapper can only patch a GLOBAL `window.gsap` (via a defineProperty
// get/set trap set up before gsap's own CDN <script> tag assigns it), so
// the gsap scaffold requires loading gsap from the pinned CDN tag, not a
// bundled ESM import -- documented in the scaffold, not a rubric hint.
//
// Ease + duration + end-value come straight from the intercepted `vars`.
// Start values for each segment are read by pausing the relevant timeline
// and scrubbing it to each tween's own start/end time, then reading
// GSAP's own rendered property values (gsap.getProperty) -- this handles
// relative ("+=50") and chained tweens correctly without simulating
// anything; it's GSAP's own renderer, just driven synchronously before
// real playback.
//
// Both scripts below are written as plain-JS STRING literals, not actual
// TS functions passed to addInitScript/evaluate. Playwright injects a
// function into the page by calling `.toString()` on it, but tsx/esbuild's
// "keep names" pass rewrites every named function/const-arrow in this
// module into `const x = __name(() => {...}, "x")` so `.name` survives --
// and that `__name` helper doesn't exist in the browser, so any function
// object serialized this way throws `__name is not defined` the moment it
// runs. Plain strings are never parsed by esbuild, so they're immune.
import type { Page } from "playwright";

import type { SegmentEase, Waypoint } from "../curve-builder.js";
import { buildCurveSet } from "../curve-builder.js";
import { resolveGsapEase } from "../ease-to-bezier.js";
import type { CanonicalCurveSet, Framework } from "../schema.js";

const INSTALL_RECORDER_SRC = `
(function () {
  window.__gsapRecorder = { tweens: [] };
  var real;
  function safeClone(vars) {
    var out = {};
    if (!vars) return out;
    for (var k in vars) {
      var v = vars[k];
      if (typeof v === "function" || (typeof v === "object" && v !== null)) continue;
      out[k] = v;
    }
    return out;
  }
  function describeTarget(target) {
    try {
      if (typeof target === "string") return target;
      if (target && target.nodeType === 1) {
        return target.id ? "#" + target.id : (target.tagName || "unknown").toLowerCase();
      }
    } catch (e) {}
    return "unknown";
  }
  function record(target, vars, tween) {
    window.__gsapRecorder.tweens.push({ target: describeTarget(target), vars: safeClone(vars), tween: tween });
  }
  function wrapTimeline(tl) {
    var origTo = tl.to.bind(tl);
    tl.to = function (target, vars, position) {
      // Timeline.to() returns the TIMELINE itself (for chaining), not the
      // child tween it just created, so grab the actual tween off the
      // timeline's own children list -- it's always appended last.
      var result = origTo(target, vars, position);
      var children = tl.getChildren ? tl.getChildren() : [];
      var tween = children.length > 0 ? children[children.length - 1] : result;
      record(target, vars, tween);
      return result;
    };
    return tl;
  }
  function wrapGsap(g) {
    if (g.__ballBounceWrapped) return g;
    g.__ballBounceWrapped = true;
    var origTo = g.to.bind(g);
    var origTimeline = g.timeline.bind(g);
    g.to = function (target, vars) {
      var tween = origTo(target, vars);
      record(target, vars, tween);
      return tween;
    };
    g.timeline = function (vars) { return wrapTimeline(origTimeline(vars)); };
    try { g.globalTimeline.pause(0); } catch (e) {}
    return g;
  }
  Object.defineProperty(window, "gsap", {
    configurable: true,
    get: function () { return real; },
    set: function (v) { real = wrapGsap(v); }
  });
})();
`;

function extractSrc(selector: string): string {
  return `(function () {
  var selector = ${JSON.stringify(selector)};
  var rec = window.__gsapRecorder;
  var gsap = window.gsap;
  if (!rec || !gsap) return { error: "gsap recorder not installed or gsap not loaded" };
  var el = document.querySelector(selector);
  if (!el) return { error: "selector not found: " + selector };
  if (rec.tweens.length === 0) return { error: "no gsap tweens recorded" };
  function readProps() {
    return {
      x: gsap.getProperty(el, "x"),
      y: gsap.getProperty(el, "y"),
      scaleX: gsap.getProperty(el, "scaleX"),
      scaleY: gsap.getProperty(el, "scaleY"),
      rotation: gsap.getProperty(el, "rotation")
    };
  }
  var parents = [];
  for (var idx = 0; idx < rec.tweens.length; idx++) {
    var tw = rec.tweens[idx].tween;
    if (tw && tw.parent && parents.indexOf(tw.parent) === -1) parents.push(tw.parent);
  }
  var master = parents.length === 1 ? parents[0] : gsap.globalTimeline;
  var wasPaused = master.paused();
  master.pause(0);
  var segments = rec.tweens.map(function (t) {
    var tween = t.tween;
    var startTime = tween.startTime();
    var endTime = startTime + tween.duration();
    master.time(startTime, false);
    var startVals = readProps();
    master.time(endTime, false);
    var endVals = readProps();
    var ease = typeof t.vars.ease === "string" ? t.vars.ease : (t.vars.ease ? "function" : "none");
    return { startTime: startTime, endTime: endTime, ease: ease, startVals: startVals, endVals: endVals };
  });
  master.time(0, false);
  if (!wasPaused) master.play();
  segments.sort(function (a, b) { return a.startTime - b.startTime; });
  return { segments: segments };
})()`;
}

interface RawSegment {
  startTime: number;
  endTime: number;
  ease: string;
  startVals: Record<string, number>;
  endVals: Record<string, number>;
}

interface InPageResult {
  error?: string;
  segments?: RawSegment[];
}

export async function installGsapRecorder(page: Page): Promise<void> {
  await page.addInitScript({ content: INSTALL_RECORDER_SRC });
}

export async function extractGsapAnimations(
  page: Page,
  framework: Framework = "gsap",
  selector = "#ball",
): Promise<CanonicalCurveSet> {
  const raw: InPageResult = await page.evaluate(extractSrc(selector));
  const warnings: string[] = [];

  if (raw.error || !raw.segments || raw.segments.length === 0) {
    warnings.push(raw.error ?? "no segments extracted");
    return buildCurveSet(framework, "dom", [], [], warnings);
  }

  const segs = raw.segments;

  // Build one waypoint per distinct segment boundary time, with values
  // taken from whichever segment starts/ends there.
  const times = new Set<number>();
  for (const s of segs) {
    times.add(s.startTime);
    times.add(s.endTime);
  }
  const sortedTimes = [...times].sort((a, b) => a - b);

  const valuesAtTime = new Map<number, Record<string, number>>();
  for (const s of segs) {
    valuesAtTime.set(s.startTime, { ...(valuesAtTime.get(s.startTime) ?? {}), ...s.startVals });
    valuesAtTime.set(s.endTime, { ...(valuesAtTime.get(s.endTime) ?? {}), ...s.endVals });
  }

  const waypoints: Waypoint[] = sortedTimes.map((t) => ({
    time: t,
    values: valuesAtTime.get(t) ?? {},
  }));

  // A segment's ease applies to properties that changed in THAT segment
  // only; properties untouched in a gap keep their previous waypoint value
  // implicitly via buildCurveSet skipping non-adjacent indices, so we
  // build one SegmentEase per boundary-to-boundary gap using the segment
  // (if any) whose [startTime, endTime] matches that gap.
  const segmentEases: SegmentEase[] = [];
  for (let i = 0; i < sortedTimes.length - 1; i++) {
    const t0 = sortedTimes[i];
    const t1 = sortedTimes[i + 1];
    const seg = segs.find((s) => s.startTime === t0 && s.endTime === t1);
    const resolved = resolveGsapEase(seg?.ease);
    if (resolved.kind === "unsupported") warnings.push(`unsupported ease: ${seg?.ease}`);
    segmentEases.push({ resolved, wasExplicitBezier: false });
  }

  return buildCurveSet(framework, "dom", waypoints, segmentEases, warnings);
}
