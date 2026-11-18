// Renders a CanonicalCurveSet as a self-contained interactive HTML viewer:
// the animation reconstructed on a stage, a graph-editor plot, and a shared
// playhead that links them. Everything is derived from curves.json -- the
// page never loads the worker's page or any rendered video, so curves.json
// is the single piece of state a rollout's visualization needs.
//
// Unlike render-graph.ts, which polylines between keyframes, this draws the
// real cubic Bezier segments, so curve SHAPE (sharp V at a contact vs. a
// rounded one) is actually visible -- which is what the rubric judges.
//
// Playback is a reconstruction, not ground truth. If the extractor
// misreads a framework's easing, this viewer will faithfully show the
// misreading. render-gif.ts (which scrubs the real page) stays the
// cross-check for that.
import path from "node:path";

import type { CanonicalCurveSet } from "./schema.js";

// Stage geometry, from task/task.yaml:physical. Only affects presentation.
const VIEWPORT = { width: 960, height: 540 };
const BALL_DIAMETER = 48;
const FLOOR_Y = 460;

// Inline SVG rather than text glyphs, so the shape does not depend on the
// font having them. currentColor picks up the button's inherited ink.
const ICON_PLAY =
  '<svg viewBox="0 0 12 12" width="12.1" height="12.1" aria-hidden="true">' +
  '<path d="M4.2 2.6 L9.4 6 L4.2 9.4 Z" fill="currentColor"/></svg>';
const ICON_PAUSE =
  '<svg viewBox="0 0 12 12" width="12.1" height="12.1" aria-hidden="true">' +
  '<rect x="3.6" y="2.6" width="1.9" height="6.8" fill="currentColor"/>' +
  '<rect x="6.5" y="2.6" width="1.9" height="6.8" fill="currentColor"/></svg>';
// Four small corner marks, filled rather than stroked to match the
// play/pause glyphs -- the standard fullscreen / fullscreen-exit icon
// (Material Symbols "fullscreen" / "fullscreen_exit", scaled from its
// 24x24 original to this 12x12 grid). EXPAND's marks sit flush against the
// corners pointing out; COLLAPSE's are pulled in, pointing back at them.
const ICON_EXPAND =
  '<svg viewBox="0 0 12 12" width="12.1" height="12.1" aria-hidden="true">' +
  '<path fill="currentColor" d="M3.5 7 L2.5 7 L2.5 9.5 L5 9.5 L5 8.5 L3.5 8.5 Z ' +
  'M2.5 5 L3.5 5 L3.5 3.5 L5 3.5 L5 2.5 L2.5 2.5 Z ' +
  'M8.5 8.5 L7 8.5 L7 9.5 L9.5 9.5 L9.5 7 L8.5 7 Z ' +
  'M7 2.5 L7 3.5 L8.5 3.5 L8.5 5 L9.5 5 L9.5 2.5 Z"/></svg>';
const ICON_COLLAPSE =
  '<svg viewBox="0 0 12 12" width="12.1" height="12.1" aria-hidden="true">' +
  '<path fill="currentColor" d="M2.5 8 L4 8 L4 9.5 L5 9.5 L5 7 L2.5 7 Z ' +
  'M4 4 L2.5 4 L2.5 5 L5 5 L5 2.5 L4 2.5 Z ' +
  'M7 9.5 L8 9.5 L8 8 L9.5 8 L9.5 7 L7 7 Z ' +
  'M8 4 L8 2.5 L7 2.5 L7 5 L9.5 5 L9.5 4 Z"/></svg>';

/** Embeds JSON in a <script> safely: `<` is escaped so a string containing
 * "</script>" cannot terminate the tag early. */
function embedJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

// runLabel identifies the rollout in the page title -- callers outside the
// CLI (there are none yet) can omit it and fall back to the framework name.
export function renderViewerHtml(curves: CanonicalCurveSet, runLabel?: string): string {
  const title = `Curve Viewer - ${runLabel ?? curves.framework}`;
  // One card per channel that actually carries keys, so a stray channel
  // shows up as an extra column instead of hiding inside a shared plot.
  const activeProps = (["x", "y", "scaleX", "scaleY", "rotation"] as const)
    .filter((prop) => (curves.properties[prop] ?? []).length > 0);
  const graphPanes = activeProps
    .map((prop) => `  <div class="pane">
    <h2>${prop}</h2>
    <div class="graph" data-prop="${prop}"></div>
    <button class="expand-btn" aria-label="expand">${ICON_EXPAND}</button>
  </div>`)
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>
  /* Palette fixed to the given swatches, used literally rather than
     derived tints -- the five neutrals read as one light-to-dark ramp
     (surface/panel/line/faint/ink). --key (keyframes, their handles,
     the ball) is the one red; --playhead is the one pale pink, and
     --select aliases it rather than repeating the same hex, since a
     selection wash is just that pink used for a different mark. */
  :root {
    --ink: #000000;
    --key: #D13836;
    --playhead: #F1B9C1;
    --surface: #FCFCFC;
    --panel: #F4F3F1;
    --line: #CFCDCB;
    --faint: #403C38;
    --select: var(--playhead);

    /* ONE TYPE STYLE, set once on body. Everything inherits it, SVG text
       included, so no other rule names a font. Hierarchy comes from color,
       case and position -- never size or weight. ui-rounded is a CSS Fonts
       Level 4 generic family, not a webfont -- WebKit resolves it to SF Pro
       Rounded on Apple platforms with no network request, and other
       engines fall through to the system sans-serif stack. */
    --type: 400 12px/1.5 ui-rounded, "SF Pro Rounded", ui-sans-serif, system-ui, sans-serif;
  }
  * { box-sizing: border-box; letter-spacing: 0; }
  /* Cards sit centred in the window. The "safe" keyword keeps the top
     reachable if content ever outgrows the viewport, where plain centring
     would clip it out of scroll range. (No backticks in here -- this CSS
     lives inside a TS template literal and one would terminate it.) */
  body { margin: 0; padding: 32px; min-height: 100vh; display: flex; flex-direction: column;
         justify-content: center; justify-content: safe center;
         font: var(--type); background: var(--panel); color: var(--ink); }
  h2 { font: inherit; margin: 0; }
  button, input { font: inherit; color: inherit; }

  /* Equal columns across the full window. auto-fit rather than a fixed
     count, because the cards come from whichever channels carry keys. */
  .panes { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
           grid-auto-rows: 1fr; gap: 16px; }
  .pane { position: relative; display: flex; flex-direction: column; min-width: 0; padding: 8px;
          background: var(--surface); }
  .pane h2 { margin-bottom: 6px; color: var(--faint); text-align: center; }

  /* Sits over the card's own content, so it needs the surface fill behind
     it to stay legible rather than blending into the curve or tick labels
     it overlaps. */
  .expand-btn { position: absolute; right: 8px; bottom: 8px; z-index: 1; }

  /* Fullscreen lightbox: the clicked pane itself (same DOM node, including
     its live stage/graph and listeners) is moved in here rather than
     cloned, so playback and zoom state keep working at the larger size. */
  #lightbox { position: fixed; inset: 0; z-index: 1000; display: none;
              align-items: center; justify-content: center;
              padding: 32px; background: rgba(0, 0, 0, 0.55); }
  #lightbox.open { display: flex; }
  /* #lightbox's own 32px padding (64px per axis) isn't implied by a bare
     92vw/92vh -- without subtracting it, the pane's declared size can
     exceed the flex container's content box on a narrow viewport, and
     flexbox silently shrinks the pane to fit. That decouples the pane's
     RENDERED size from what the plot math below assumes, which is what
     let a tick label drift into the expand button's reserved corner. */
  #lightbox .pane { width: min(1100px, calc(92vw - 64px)); height: min(820px, calc(92vh - 64px)); }
  /* The stage's height comes from its own width via a fixed aspect ratio
     (layoutStage), not from flex-grow like a graph's plot -- so forcing it
     to the same tall box as a graph pane would just leave dead space below
     the controls. Let it size to its own content instead. */
  #lightbox .pane-stage { height: auto; }

  #stage { position: relative; width: 100%; overflow: hidden;
           background: var(--surface); border: 1px solid var(--line); }
  #ball { position: absolute; border-radius: 50%; background: var(--key); }

  /* Right padding reserves the expand button's own corner (28px + its 8px
     offset) so the absolutely-positioned button doesn't sit on top of the
     scrub bar and cover its rounded end. */
  .controls { display: flex; align-items: center; gap: 10px; margin-top: 12px; flex-wrap: wrap;
              padding-right: 36px; }
  /* Circular, fixed size, so nothing shifts when the icon toggles. Flat --
     no hover state, so clicking it is the only feedback. */
  button { width: 28px; height: 28px; padding: 0; display: grid; place-items: center;
           background: var(--surface); border: none;
           border-radius: 50%; cursor: pointer; }

  /* Appearance reset so the native track/thumb chrome (a bordered groove in
     WebKit, a hover halo on the thumb) can't show through -- flat, static,
     no hover state, matching the play button. */
  #scrub { flex: 1; min-width: 220px; -webkit-appearance: none; appearance: none;
           background: transparent; cursor: pointer; }
  /* Progress reads from the track fill itself (--pct, written in setTime),
     not a thumb marker -- so the thumb stays only as an invisible drag
     handle. Vendor pseudo-elements can't be grouped in one selector list --
     an engine that doesn't recognize one drops the whole rule, track
     included. */
  #scrub::-webkit-slider-runnable-track {
    -webkit-appearance: none; height: 4px; border: none; border-radius: 2px;
    background: linear-gradient(to right, var(--ink) var(--pct, 0%), var(--line) var(--pct, 0%)); }
  #scrub::-moz-range-track {
    height: 4px; border: none; border-radius: 2px;
    background: linear-gradient(to right, var(--ink) var(--pct, 0%), var(--line) var(--pct, 0%)); }
  #scrub::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px;
           margin-top: -5px; border: none; border-radius: 50%; background: transparent;
           box-shadow: none; }
  #scrub::-moz-range-thumb { width: 14px; height: 14px; border: none; border-radius: 50%;
           background: transparent; box-shadow: none; }

  /* Plot absorbs the card, rather than sitting centred in spare room. */
  .graph { flex: 1; min-width: 0; min-height: 0; }
  .graph svg { display: block; }

  .hint { margin: 10px 0 0; text-align: center; color: var(--faint); }
  .warn { margin-top: 12px; padding: 8px 10px; background: var(--panel); border-left: 3px solid var(--playhead); }
</style>
</head>
<body>
<div class="panes">
  <div class="pane pane-stage">
    <h2>Viewport</h2>
    <div id="stage"></div>
    <div class="controls">
      <button id="play" aria-label="play">${ICON_PLAY}</button>
      <input type="range" id="scrub" min="0" max="1" step="0.0005" value="0" />
    </div>
    <button class="expand-btn" aria-label="expand">${ICON_EXPAND}</button>
  </div>

${graphPanes}
</div>

<p class="hint">drag across graph to zoom<br>'r' to reset zoom</p>


<div id="warnings"></div>
<div id="lightbox"></div>

<script>
const ICON_PLAY = ${embedJson(ICON_PLAY)};
const ICON_PAUSE = ${embedJson(ICON_PAUSE)};
const ICON_EXPAND = ${embedJson(ICON_EXPAND)};
const ICON_COLLAPSE = ${embedJson(ICON_COLLAPSE)};
const CURVES = ${embedJson(curves)};
const VIEWPORT = ${embedJson(VIEWPORT)};
const BALL_D = ${BALL_DIAMETER};
const FLOOR_Y = ${FLOOR_Y};
const PROPS = ["x", "y", "scaleX", "scaleY", "rotation"];
const DEFAULTS = { x: 0, y: FLOOR_Y, scaleX: 1, scaleY: 1, rotation: 0 };

// ---------------------------------------------------------------- curve math
function cubic(a, b, c, d, u) {
  const m = 1 - u;
  return m * m * m * a + 3 * m * m * u * b + 3 * m * u * u * c + u * u * u * d;
}

/** The 4 absolute control points of the segment between two keyframes.
 * Handles are stored relative to their own keyframe (schema.ts), and a
 * missing handle collapses onto its anchor, which yields a straight line. */
function controlPoints(k0, k1) {
  const p0 = [k0.time, k0.value];
  const p3 = [k1.time, k1.value];
  const p1 = k0.outHandle ? [k0.time + k0.outHandle.dt, k0.value + k0.outHandle.dv] : p0;
  const p2 = k1.inHandle ? [k1.time + k1.inHandle.dt, k1.value + k1.inHandle.dv] : p3;
  return [p0, p1, p2, p3];
}

/** Bisect for the bezier parameter u whose TIME component equals t. Time is
 * monotonic for any sane handle placement; bisection stays stable even when
 * it is not, which matters because bad model output is the common case. */
function paramAtTime(cp, t) {
  const [p0, p1, p2, p3] = cp;
  let lo = 0, hi = 1;
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2;
    if (cubic(p0[0], p1[0], p2[0], p3[0], mid) < t) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

function valueAt(kfs, t) {
  if (!kfs || kfs.length === 0) return null;
  if (kfs.length === 1) return kfs[0].value;
  if (t <= kfs[0].time) return kfs[0].value;
  if (t >= kfs[kfs.length - 1].time) return kfs[kfs.length - 1].value;
  for (let i = 0; i < kfs.length - 1; i++) {
    if (t >= kfs[i].time && t <= kfs[i + 1].time) {
      const cp = controlPoints(kfs[i], kfs[i + 1]);
      const u = paramAtTime(cp, t);
      return cubic(cp[0][1], cp[1][1], cp[2][1], cp[3][1], u);
    }
  }
  return kfs[kfs.length - 1].value;
}

const DURATION = Math.max(CURVES.durationSeconds, 0.001);
const ACTIVE = PROPS.filter((p) => (CURVES.properties[p] || []).length > 0);

// ------------------------------------------------------------------- stage
const stage = document.getElementById("stage");
const ball = document.createElement("div");
ball.id = "ball";
stage.appendChild(ball);

// The stage spans its card, so the scale is whatever that width implies
// rather than a constant. Height follows from the viewport aspect ratio.
let SCALE = 0.4;
function layoutStage() {
  const w = stage.clientWidth;
  if (!w) return;
  SCALE = w / VIEWPORT.width;
  stage.style.height = Math.round(VIEWPORT.height * SCALE) + "px";
  ball.style.width = BALL_D * SCALE + "px";
  ball.style.height = BALL_D * SCALE + "px";
}

// --------------------------------------------------------------- graph plot
// Each channel has its own card, so a plot holds exactly one lane: no lane
// gap, and no in-SVG lane name because the card heading carries it. That
// frees vertical room for the curve. The gutter only fits axis numbers.
// Width is measured from the card at render time, not fixed, so graphs
// fill whatever column width the grid gives them. Re-rendering at the
// real pixel width (rather than scaling one SVG with a viewBox) keeps
// label text at a true 11px instead of scaling it off the type ramp.
// MR reserves the expand button's own footprint (28px + its 8px offset)
// in the plot's bottom-right corner. The rightmost time tick is drawn
// with text-anchor="end" at x = ML + PLOT_W (W - MR), so its text only
// ever extends LEFTWARD from that point -- as long as MR is at least the
// button's width, the label can never reach under it, regardless of how
// wide that label's text is.
const MIN_W = 280, MIN_H = 150, ML = 60, MR = 36, MT = 14, MB = 30;
const plotW = (w) => Math.max(w - ML - MR, 40);
// The visible time window. Brushing a range on any graph narrows it for
// ALL graphs, so the cards always share one time axis.
let viewT0 = 0, viewT1 = DURATION;
const viewSpan = () => Math.max(viewT1 - viewT0, 1e-6);
const isZoomed = () => viewT0 > 0 || viewT1 < DURATION;
const tToXw = (t, w) => ML + ((t - viewT0) / viewSpan()) * plotW(w);
const xToTw = (x, w) => viewT0 + ((x - ML) / plotW(w)) * viewSpan();

/** Extracted y is screen space (down-positive), so plotting it raw puts
 * contacts at the TOP of the lane and apexes at the bottom -- the mirror of
 * how the rubric describes the curve ("sharp V at contacts"). The y lane is
 * therefore plotted as HEIGHT ABOVE FLOOR, which puts the origin at the
 * bottom-left and makes contacts read as V's. Other channels pass through. */
function plotValue(prop, v) {
  return prop === "y" ? FLOOR_Y - v : v;
}

function laneBounds(kfs, prop) {
  // Fit the value axis to the keys inside the window, plus one neighbour
  // each side so a segment entering or leaving the view still fits.
  let lo = kfs.length, hi = -1;
  kfs.forEach((k, i) => {
    if (k.time >= viewT0 && k.time <= viewT1) { if (i < lo) lo = i; if (i > hi) hi = i; }
  });
  if (hi < 0) { lo = 0; hi = kfs.length - 1; }
  const inView = kfs.slice(Math.max(0, lo - 1), Math.min(kfs.length, hi + 2));

  let min = Infinity, max = -Infinity;
  for (const k of inView) {
    for (const raw of [k.value,
                       k.inHandle ? k.value + k.inHandle.dv : k.value,
                       k.outHandle ? k.value + k.outHandle.dv : k.value]) {
      const v = plotValue(prop, raw);
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (!isFinite(min)) { min = 0; max = 1; }
  // Keep the floor (height 0) visible in the y lane, unless the ball
  // actually goes below it -- sinking past the floor is a real failure the
  // rubric checks for, so it must stay visible rather than be cropped. It
  // still gets the normal padding below it, rather than sitting flush
  // against the bottom edge, so contact keyframes and their handles aren't
  // clipped.
  if (prop === "y") min = Math.min(min, 0);
  if (min === max) { min -= 1; max += 1; }
  const pad = (max - min) * 0.15;
  return [min - pad, max + pad];
}

// Units are absolute per schema.ts: px for x/y, a unitless ratio for
// scale, degrees for rotation.
const UNITS = { x: "px", y: "px", scaleX: "", scaleY: "", rotation: "\u00b0" };

/** Tick positions on a 1/2/5 x 10^n ladder -- the steps people read
 * without doing arithmetic. Returns [] rather than looping forever on a
 * degenerate range. */
function ticks(min, max, target) {
  const span = max - min;
  if (!isFinite(span) || span <= 0 || target < 1) return [];
  const mag = Math.pow(10, Math.floor(Math.log10(span / target)));
  const norm = span / target / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) {
    out.push({ v, step });
    if (out.length > 40) break;
  }
  return out;
}

const tickLabel = (v, step, unit) =>
  v.toFixed(Math.max(0, -Math.floor(Math.log10(step)))) + unit;

const svgNS = "http://www.w3.org/2000/svg";
function el(name, attrs) {
  const n = document.createElementNS(svgNS, name);
  for (const k in attrs) n.setAttribute(k, String(attrs[k]));
  return n;
}

// {prop, host, ph, width} per graph -- width is needed to place the
// playhead, since each card can be a different size.
const graphs = [];

// One SVG per channel, each in its own card. The cards share a playhead
// position so scrubbing moves every graph together.
function buildGraph(prop, host, W, H) {
  const tToX = (t) => tToXw(t, W);
  const PLOT_W = plotW(W);
  const LANE_H = Math.max(H - MT - MB, 60);
  const GRAPH_H = MT + LANE_H + MB;
  host.textContent = "";

  const kfs = CURVES.properties[prop];
  const top = MT;
  const [vMin, vMax] = laneBounds(kfs, prop);
  const vToY = (v) => top + LANE_H - ((v - vMin) / (vMax - vMin || 1)) * LANE_H;
  const pv = (raw) => vToY(plotValue(prop, raw));

  const svg = el("svg", { width: W, height: GRAPH_H });
  svg.appendChild(el("rect", { x: ML, y: top, width: PLOT_W, height: LANE_H,
    fill: "none", stroke: "var(--line)" }));

  // Grid first, so the curve and keys paint over it. Target spacing in
  // pixels, like the time axis below, rather than a flat tick count -- so
  // a small card stays uncluttered but the lightbox's much taller lane
  // gets proportionally more horizontal gridlines instead of just 1-2.
  const unit = UNITS[prop] ?? "";
  for (const { v, step } of ticks(vMin, vMax, Math.max(2, Math.round(LANE_H / 60)))) {
    const y = vToY(v);
    svg.appendChild(el("line", { x1: ML, y1: y, x2: ML + PLOT_W, y2: y, stroke: "var(--line)" }));
    const lab = el("text", { x: ML - 6, y: y + 4, fill: "var(--faint)", "text-anchor": "end" });
    lab.textContent = tickLabel(v, step, unit);
    svg.appendChild(lab);
  }
  for (const { v, step } of ticks(viewT0, viewT1, Math.max(2, Math.round(PLOT_W / 90)))) {
    const x = tToX(v);
    svg.appendChild(el("line", { x1: x, y1: top, x2: x, y2: top + LANE_H, stroke: "var(--line)" }));
    // A "middle" anchor draws half the label's width to either side of x,
    // so a tick landing merely close to the right edge -- not just AT it --
    // can still poke a label past the plot boundary (and into the expand
    // button's reserved corner there). 24px safely covers a label's half
    // width at this font size; "end" anchor only ever draws LEFTWARD from
    // x, so switching this early can't itself cause an overflow.
    const anchor = x <= ML + 2 ? "start" : x >= ML + PLOT_W - 24 ? "end" : "middle";
    const lab = el("text", { x, y: top + LANE_H + 16, fill: "var(--faint)", "text-anchor": anchor });
    lab.textContent = tickLabel(v, step, "s");
    svg.appendChild(lab);
  }

  // Floor reference, so contacts are visibly sitting ON something.
  if (prop === "y" && vMin <= 0 && vMax >= 0) {
    svg.appendChild(el("line", { x1: ML, y1: vToY(0), x2: ML + PLOT_W, y2: vToY(0),
      stroke: "var(--faint)", "stroke-width": 1, "stroke-dasharray": "3 3" }));
  }

  // Clip the data marks: once zoomed, segments run past the lane and would
  // otherwise paint over the axis labels.
  const clipId = "clip-" + prop;
  const defs = el("defs", {});
  const clip = el("clipPath", { id: clipId });
  clip.appendChild(el("rect", { x: ML, y: top, width: PLOT_W, height: LANE_H }));
  defs.appendChild(clip);
  svg.appendChild(defs);
  const marks = el("g", { "clip-path": "url(#" + clipId + ")" });

  // Real cubic segments -- the whole point of this view. A keyframe list
  // doesn't have to span [0, DURATION]: valueAt() holds the first/last
  // keyframe's value outside that range, so the curve is drawn flat there
  // too, rather than just stopping at the last keyframe.
  let d = "";
  if (kfs.length > 0 && kfs[0].time > 0) {
    d += "M " + tToX(0).toFixed(2) + " " + pv(kfs[0].value).toFixed(2) + " "
       + "L " + tToX(kfs[0].time).toFixed(2) + " " + pv(kfs[0].value).toFixed(2) + " ";
  }
  for (let i = 0; i < kfs.length - 1; i++) {
    const [p0, p1, p2, p3] = controlPoints(kfs[i], kfs[i + 1]);
    if (i === 0 && !d) d += "M " + tToX(p0[0]).toFixed(2) + " " + pv(p0[1]).toFixed(2) + " ";
    d += "C " + tToX(p1[0]).toFixed(2) + " " + pv(p1[1]).toFixed(2) + ", "
              + tToX(p2[0]).toFixed(2) + " " + pv(p2[1]).toFixed(2) + ", "
              + tToX(p3[0]).toFixed(2) + " " + pv(p3[1]).toFixed(2) + " ";
  }
  if (kfs.length > 0) {
    const last = kfs[kfs.length - 1];
    if (last.time < DURATION) {
      if (!d) d += "M " + tToX(last.time).toFixed(2) + " " + pv(last.value).toFixed(2) + " ";
      d += "L " + tToX(DURATION).toFixed(2) + " " + pv(last.value).toFixed(2) + " ";
    }
  }
  if (d) marks.appendChild(el("path", { d, fill: "none", stroke: "var(--ink)", "stroke-width": 1.28 }));

  const keyPts = [];
  kfs.forEach((k, ki) => {
    const px = tToX(k.time), py = pv(k.value);
    keyPts.push({ t: k.time, x: px, y: py });
    for (const h of [k.inHandle, k.outHandle]) {
      if (!h) continue;
      const hx = tToX(k.time + h.dt), hy = pv(k.value + h.dv);
      marks.appendChild(el("line", { x1: px, y1: py, x2: hx, y2: hy,
        stroke: "var(--key)", "stroke-width": 1.2 }));
      marks.appendChild(el("rect", { x: hx - 2, y: hy - 2, width: 4, height: 4, fill: "var(--key)" }));
    }
    const dot = el("circle", { cx: px, cy: py, r: 3.6, fill: "var(--key)" });
    const tip = el("title");
    // Raw value stays visible in the tooltip: the lane plots height, but
    // curves.json stores screen-space y, and those must stay reconcilable.
    const valueText = prop === "y"
      ? "height " + (FLOOR_Y - k.value).toFixed(2) + " (raw y " + k.value.toFixed(2) + ")"
      : k.value.toFixed(2);
    tip.textContent = prop + " key " + ki + " @ " + k.time.toFixed(3) + "s = " + valueText
      + "\\n" + (k.easeSource || "?") + (k.presetName ? " (" + k.presetName + ")" : "");
    dot.appendChild(tip);
    marks.appendChild(dot);
  });

  svg.appendChild(marks);

  const ph = el("line", { x1: ML, y1: top, x2: ML, y2: top + LANE_H,
    stroke: "var(--playhead)", "stroke-width": 1.4, "pointer-events": "none",
    "clip-path": "url(#" + clipId + ")" });
  svg.appendChild(ph);

  // Drag a box over the plot: the keys that fall INSIDE it are the
  // selection, and releasing zooms every graph to the time span those keys
  // cover. Hit-testing the box (rather than just its x range) means a key
  // that is in the right time range but far off in value is not dragged in.
  const brush = el("rect", { fill: "var(--select)", "fill-opacity": 0.5, stroke: "var(--key)",
    "stroke-width": 1, "pointer-events": "none", visibility: "hidden" });
  svg.appendChild(brush);
  svg.style.cursor = "crosshair";

  let dragFrom = null;
  const localPt = (e) => {
    const r = svg.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const boxOf = (pt) => ({
    x0: Math.max(Math.min(dragFrom.x, pt.x), ML),
    x1: Math.min(Math.max(dragFrom.x, pt.x), ML + PLOT_W),
    y0: Math.max(Math.min(dragFrom.y, pt.y), top),
    y1: Math.min(Math.max(dragFrom.y, pt.y), top + LANE_H),
  });
  svg.addEventListener("pointerdown", (e) => {
    dragFrom = localPt(e);
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener("pointermove", (e) => {
    if (!dragFrom) return;
    const b = boxOf(localPt(e));
    brush.setAttribute("x", b.x0);
    brush.setAttribute("y", b.y0);
    brush.setAttribute("width", Math.max(b.x1 - b.x0, 0));
    brush.setAttribute("height", Math.max(b.y1 - b.y0, 0));
    brush.setAttribute("visibility", (b.x1 - b.x0 > 1 || b.y1 - b.y0 > 1) ? "visible" : "hidden");
  });
  const endDrag = (e) => {
    if (!dragFrom) return;
    const pt = localPt(e);
    const moved = Math.hypot(pt.x - dragFrom.x, pt.y - dragFrom.y);
    const b = boxOf(pt);
    dragFrom = null;
    brush.setAttribute("visibility", "hidden");
    if (svg.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);
    if (moved < 4) return;
    const picked = keyPts.filter((k) => k.x >= b.x0 && k.x <= b.x1 && k.y >= b.y0 && k.y <= b.y1);
    if (picked.length === 0) return;   // empty box: leave the view alone
    const lo = Math.min(...picked.map((k) => k.t));
    const hi = Math.max(...picked.map((k) => k.t));
    // Pad so the outermost keys are not pinned to the lane edge, and so a
    // single selected key still yields a usable window.
    const pad = Math.max((hi - lo) * 0.1, DURATION * 0.02);
    zoomTo(lo - pad, hi + pad);
  };
  svg.addEventListener("pointerup", endDrag);
  svg.addEventListener("pointercancel", endDrag);
  svg.addEventListener("dblclick", resetZoom);
  host.appendChild(svg);
  return ph;
}

// MR and the tick anchor threshold above keep a label's SVG-local position
// clear of the expand button under normal sizing -- but the button is
// positioned relative to the PANE, not the SVG, and at the extreme end of
// the responsive range (a lightbox pane squeezed below MIN_W, say) the two
// can decouple: the SVG renders at its floor width even though its real
// container is narrower. Rather than extend the margin math to cover every
// such case, check the one thing that actually matters -- the rendered
// boxes, post-layout -- and hide whatever truly collides. This is the
// backstop that holds even when the geometry assumptions above don't.
//
// Called every layoutGraphs() pass, not just when buildGraph reruns: a
// resize can move the button (it's sized off the pane) without changing
// the SVG's own clamped width, which would otherwise skip the rebuild
// that this check used to ride along with and leave it stale.
function hideLabelsUnderExpandButton(svg, host) {
  const pane = host.closest(".pane");
  const btn = pane && pane.querySelector(".expand-btn");
  if (!btn) return;
  const b = btn.getBoundingClientRect();
  if (b.width === 0) return; // not laid out yet (e.g. display:none ancestor)
  svg.querySelectorAll("text").forEach((t) => {
    const r = t.getBoundingClientRect();
    const overlaps = r.right > b.left && r.left < b.right && r.bottom > b.top && r.top < b.bottom;
    t.style.visibility = overlaps ? "hidden" : "";
  });
}

function rebuildAll() {
  for (const g of graphs) { g.width = 0; g.height = 0; }
  layoutGraphs();
}

function zoomTo(t0, t1) {
  const lo = Math.max(0, Math.min(t0, t1));
  const hi = Math.min(DURATION, Math.max(t0, t1));
  if (hi - lo < 1e-3) return;
  viewT0 = lo; viewT1 = hi;
  rebuildAll();
}

function resetZoom() {
  if (!isZoomed()) return;
  viewT0 = 0; viewT1 = DURATION;
  rebuildAll();
}

function layoutGraphs() {
  layoutStage();
  for (const g of graphs) {
    const w = Math.max(Math.round(g.host.clientWidth), MIN_W);
    const h = Math.max(Math.round(g.host.clientHeight), MIN_H);
    if (w === g.width && h === g.height) continue;
    g.width = w;
    g.height = h;
    g.ph = buildGraph(g.prop, g.host, w, h);
  }
  // Unconditional, even for graphs the loop above just skipped: the
  // button can move on its own (it's sized off the pane, not the SVG).
  for (const g of graphs) {
    const svg = g.host.querySelector("svg");
    if (svg) hideLabelsUnderExpandButton(svg, g.host);
  }
  draw(now);
}

// .panes uses grid-auto-rows: 1fr, which with no definite container height
// sizes the row to its tallest item's own content height -- so a graph's
// SVG (sized to fill its card, per buildGraph) and the row height it sits
// in are circular: whatever height the SVG already has is what the row
// (and therefore every clientHeight read in layoutGraphs) reports back,
// so a still-oversized SVG from the lightbox never shrinks on its own.
// Clearing every host first breaks the loop by letting the row settle on
// real content (the viewport stage, sized from width alone) before the
// graphs measure and rebuild against that settled height.
function resetGraphs() {
  for (const g of graphs) { g.host.textContent = ""; g.width = 0; g.height = 0; }
}

ACTIVE.forEach((prop) => {
  const host = document.querySelector('[data-prop="' + prop + '"]');
  if (host) graphs.push({ prop, host, ph: null, width: 0, height: 0 });
});

// ------------------------------------------------------------------ lightbox
// The clicked pane is relocated into #lightbox and back, not cloned --
// cloning would leave the clone's #ball and SVG listeners dead, since draw()
// and the brush handlers reference the one node that already exists.
const lightbox = document.getElementById("lightbox");
let expandedPane = null, homeParent = null, placeholder = null;

function openLightbox(pane) {
  if (expandedPane) return;
  expandedPane = pane;
  homeParent = pane.parentElement;
  // .panes uses grid-template-columns: auto-fit, which collapses a track
  // that has no item in it -- so just removing the pane would let the
  // other cards stretch to fill the gap. A same-class placeholder left
  // behind keeps the column count (and the siblings' width) unchanged.
  placeholder = document.createElement("div");
  placeholder.className = "pane";
  placeholder.style.visibility = "hidden";
  homeParent.replaceChild(placeholder, pane);
  lightbox.appendChild(pane);
  lightbox.classList.add("open");
  const btn = pane.querySelector(".expand-btn");
  btn.innerHTML = ICON_COLLAPSE;
  btn.setAttribute("aria-label", "collapse");
  resetGraphs(); // break the grid row-height feedback loop before remeasuring
  layoutGraphs();
}

function closeLightbox() {
  if (!expandedPane) return;
  const pane = expandedPane;
  expandedPane = null;
  homeParent.replaceChild(pane, placeholder);
  placeholder = null;
  lightbox.classList.remove("open");
  const btn = pane.querySelector(".expand-btn");
  btn.innerHTML = ICON_EXPAND;
  btn.setAttribute("aria-label", "expand");
  resetGraphs();
  layoutGraphs();
}

document.querySelectorAll(".expand-btn").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const pane = btn.closest(".pane");
    if (expandedPane === pane) closeLightbox(); else openLightbox(pane);
  });
});
// Click the backdrop, not the pane sitting on it, to close.
lightbox.addEventListener("click", (e) => { if (e.target === lightbox) closeLightbox(); });

// --------------------------------------------------------------- playback
const scrub = document.getElementById("scrub");
const playBtn = document.getElementById("play");
scrub.max = String(DURATION);

let now = 0, playing = false, rafId = null, lastFrame = 0;

function sample(t) {
  const out = {};
  for (const p of PROPS) {
    const v = valueAt(CURVES.properties[p], t);
    out[p] = v === null ? DEFAULTS[p] : v;
  }
  return out;
}

function draw(t) {
  const s = sample(t);
  // y is screen space (task.yaml: y increases downward), so it maps
  // straight to a top offset; the ball is positioned by its CENTER.
  const left = (s.x - BALL_D / 2) * SCALE;
  const top = (s.y - BALL_D / 2) * SCALE;
  ball.style.transform = "translate(" + left + "px," + top + "px) scale("
    + s.scaleX + "," + s.scaleY + ") rotate(" + s.rotation + "deg)";
  for (const g of graphs) {
    if (!g.ph) continue;
    const phx = tToXw(t, g.width);
    g.ph.setAttribute("x1", phx);
    g.ph.setAttribute("x2", phx);
  }
}

function setTime(t) {
  now = Math.min(Math.max(t, 0), DURATION);
  scrub.value = String(now);
  scrub.style.setProperty("--pct", (now / DURATION * 100) + "%");
  draw(now);
}

function pause() {
  playing = false;
  playBtn.innerHTML = ICON_PLAY;
  playBtn.setAttribute("aria-label", "play");
  if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
}

function tick(ts) {
  if (!playing) return;
  const dt = lastFrame ? (ts - lastFrame) / 1000 : 0;
  lastFrame = ts;
  let next = now + dt;
  if (next >= DURATION) next = 0; // loop
  setTime(next);
  rafId = requestAnimationFrame(tick);
}

playBtn.addEventListener("click", () => {
  if (playing) { pause(); return; }
  playing = true;
  playBtn.innerHTML = ICON_PAUSE;
  playBtn.setAttribute("aria-label", "pause");
  lastFrame = 0;
  rafId = requestAnimationFrame(tick);
});
scrub.addEventListener("input", () => { pause(); setTime(parseFloat(scrub.value)); });

if ((CURVES.extractionWarnings || []).length > 0) {
  const box = document.createElement("div");
  box.className = "warn";
  box.textContent = "Extraction warnings: " + CURVES.extractionWarnings.join(" | ");
  document.getElementById("warnings").appendChild(box);
}

layoutGraphs();
// Modifiers are guarded so this never shadows the browser's own reload.
document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "r" || e.key === "R") resetZoom();
  if (e.key === " " || e.code === "Space") {
    e.preventDefault(); // stop the page from scrolling on spacebar
    playBtn.click();
  }
  if (e.key === "Escape") closeLightbox();
});
// Re-render on resize so the plots keep filling their column.
let resizePending = false;
new ResizeObserver(() => {
  if (resizePending) return;
  resizePending = true;
  requestAnimationFrame(() => { resizePending = false; layoutGraphs(); });
}).observe(document.querySelector(".panes"));

setTime(0);
</script>
</body>
</html>
`;
}

// CLI: render-viewer.ts <curvesJsonPath> <outHtmlPath>
async function main() {
  const [curvesPath, outPath] = process.argv.slice(2);
  if (!curvesPath || !outPath) {
    console.error("usage: render-viewer.ts <curvesJsonPath> <outHtmlPath>");
    process.exit(2);
  }
  const fs = await import("node:fs");
  const curves: CanonicalCurveSet = JSON.parse(fs.readFileSync(curvesPath, "utf-8"));
  // Pipeline output always lands at <runDir>/extracted/curves.json -- use
  // the run directory's own name there, since "curves" (the file's own
  // basename) is the same for every run and tells you nothing. Ad-hoc
  // sample/fixture files don't have that shape, so fall back to their
  // own basename instead.
  const runLabel = path.basename(path.dirname(curvesPath)) === "extracted"
    ? path.basename(path.dirname(path.dirname(curvesPath)))
    : path.basename(curvesPath, ".json");
  fs.writeFileSync(outPath, renderViewerHtml(curves, runLabel));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  main();
}
