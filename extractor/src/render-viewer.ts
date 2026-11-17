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

/** Embeds JSON in a <script> safely: `<` is escaped so a string containing
 * "</script>" cannot terminate the tag early. */
function embedJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function renderViewerHtml(curves: CanonicalCurveSet): string {
  const title = `${curves.framework} rollout - curve viewer`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>
  :root {
    --bg: #ffffff; --panel: #f8f9fa; --border: #dddddd; --text: #222222;
    --muted: #888888; --key: #2563eb; --handle: #f97316; --curve: #444444;
    --playhead: #dc2626; --ball: #2563eb; --floor: #333333;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 16px; background: var(--bg); color: var(--text);
    font: 13px/1.5 ui-sans-serif, system-ui, sans-serif;
  }
  h1 { font-size: 15px; margin: 0 0 2px; font-weight: 600; }
  .meta { color: var(--muted); font-size: 12px; margin-bottom: 14px; }
  .meta code { font-size: 11px; }
  .panes { display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start; }
  .pane { background: var(--panel); border: 1px solid var(--border); border-radius: 6px; padding: 12px; }
  .pane h2 { font-size: 12px; margin: 0 0 8px; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
  #stage { position: relative; background: #fff; border: 1px solid var(--border); overflow: hidden; }
  #ball { position: absolute; border-radius: 50%; background: var(--ball); will-change: transform; }
  #floorLine { position: absolute; left: 0; width: 100%; height: 0; border-top: 2px solid var(--floor); }
  .controls { display: flex; align-items: center; gap: 10px; margin-top: 12px; flex-wrap: wrap; }
  button { font: inherit; padding: 4px 12px; border: 1px solid var(--border); background: #fff; border-radius: 4px; cursor: pointer; }
  button:hover { background: #f0f0f0; }
  #scrub { flex: 1; min-width: 220px; }
  #readout { font-variant-numeric: tabular-nums; color: var(--muted); font-size: 12px; min-width: 190px; }
  .warn { margin-top: 12px; padding: 8px 10px; border-left: 3px solid var(--handle); background: #fff7ed; font-size: 12px; }
  .legend { margin-top: 10px; display: flex; gap: 14px; font-size: 11px; color: var(--muted); flex-wrap: wrap; }
  .legend i { display: inline-block; width: 10px; height: 10px; vertical-align: -1px; margin-right: 4px; }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #16181c; --panel: #1e2126; --border: #343841; --text: #e6e8ea;
      --muted: #9aa0a8; --curve: #c2c7cd; --floor: #8b919a;
    }
    :root:not([data-theme="light"]) #stage { background: #0f1115; }
    :root:not([data-theme="light"]) button { background: #24282e; color: inherit; }
    :root:not([data-theme="light"]) button:hover { background: #2d323a; }
    :root:not([data-theme="light"]) .warn { background: #2a1f14; }
  }
</style>
</head>
<body>
<h1>${curves.framework} / ${curves.renderTarget}</h1>
<div class="meta">
  duration <code>${curves.durationSeconds.toFixed(3)}s</code> &middot;
  reconstructed entirely from <code>curves.json</code>
</div>

<div class="panes">
  <div class="pane">
    <h2>Reconstructed playback</h2>
    <div id="stage"></div>
    <div class="controls">
      <button id="play">Play</button>
      <button id="prevKey" title="Previous y keyframe">&#9664;&#9666; prev key</button>
      <button id="nextKey" title="Next y keyframe">next key &#9656;&#9656;</button>
    </div>
    <div class="controls">
      <input type="range" id="scrub" min="0" max="1" step="0.0005" value="0" />
    </div>
    <div id="readout"></div>
  </div>

  <div class="pane">
    <h2>Graph editor</h2>
    <div id="graph"></div>
    <div class="legend">
      <span><i style="background:var(--key)"></i>keyframe</span>
      <span><i style="background:var(--handle)"></i>handle</span>
      <span><i style="background:var(--curve)"></i>bezier curve</span>
      <span><i style="background:var(--playhead)"></i>playhead</span>
    </div>
  </div>
</div>

<div id="warnings"></div>

<script>
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
const SCALE = 0.5;
stage.style.width = VIEWPORT.width * SCALE + "px";
stage.style.height = VIEWPORT.height * SCALE + "px";

const floorLine = document.createElement("div");
floorLine.id = "floorLine";
floorLine.style.top = FLOOR_Y * SCALE + "px";
stage.appendChild(floorLine);

const ball = document.createElement("div");
ball.id = "ball";
ball.style.width = BALL_D * SCALE + "px";
ball.style.height = BALL_D * SCALE + "px";
stage.appendChild(ball);

// --------------------------------------------------------------- graph plot
const W = 576, LANE_H = 96, LANE_GAP = 10, ML = 90, MR = 16, MT = 10, MB = 26;
const PLOT_W = W - ML - MR;
const tToX = (t) => ML + (t / DURATION) * PLOT_W;

/** Extracted y is screen space (down-positive), so plotting it raw puts
 * contacts at the TOP of the lane and apexes at the bottom -- the mirror of
 * how the rubric describes the curve ("sharp V at contacts"). The y lane is
 * therefore plotted as HEIGHT ABOVE FLOOR, which puts the origin at the
 * bottom-left and makes contacts read as V's. Other channels pass through. */
function plotValue(prop, v) {
  return prop === "y" ? FLOOR_Y - v : v;
}

function laneBounds(kfs, prop) {
  let min = Infinity, max = -Infinity;
  for (const k of kfs) {
    for (const raw of [k.value,
                       k.inHandle ? k.value + k.inHandle.dv : k.value,
                       k.outHandle ? k.value + k.outHandle.dv : k.value]) {
      const v = plotValue(prop, raw);
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (!isFinite(min)) { min = 0; max = 1; }
  // Pin the floor (height 0) to the bottom of the y lane, unless the ball
  // actually goes below it -- sinking past the floor is a real failure the
  // rubric checks for, so it must stay visible rather than be cropped.
  if (prop === "y") min = Math.min(min, 0);
  if (min === max) { min -= 1; max += 1; }
  const pad = (max - min) * 0.15;
  return [prop === "y" && min === 0 ? 0 : min - pad, max + pad];
}

const svgNS = "http://www.w3.org/2000/svg";
function el(name, attrs) {
  const n = document.createElementNS(svgNS, name);
  for (const k in attrs) n.setAttribute(k, String(attrs[k]));
  return n;
}

const totalH = MT + ACTIVE.length * (LANE_H + LANE_GAP) + MB;
const svg = el("svg", { width: W, height: totalH, style: "display:block" });

ACTIVE.forEach((prop, idx) => {
  const kfs = CURVES.properties[prop];
  const top = MT + idx * (LANE_H + LANE_GAP);
  const [vMin, vMax] = laneBounds(kfs, prop);
  const vToY = (v) => top + LANE_H - ((v - vMin) / (vMax - vMin || 1)) * LANE_H;
  const pv = (raw) => vToY(plotValue(prop, raw));

  svg.appendChild(el("rect", { x: ML, y: top, width: PLOT_W, height: LANE_H,
    fill: "none", stroke: "var(--border)" }));
  const label = el("text", { x: 8, y: top + 14, "font-size": 11, fill: "var(--text)" });
  label.textContent = prop === "y" ? "y (height)" : prop;
  svg.appendChild(label);
  for (const [v, anchor] of [[vMax, top + 10], [vMin, top + LANE_H - 2]]) {
    const t = el("text", { x: ML - 6, y: anchor, "font-size": 9, fill: "var(--muted)", "text-anchor": "end" });
    t.textContent = v.toFixed(0);
    svg.appendChild(t);
  }

  // Floor reference, so contacts are visibly sitting ON something.
  if (prop === "y" && vMin <= 0 && vMax >= 0) {
    svg.appendChild(el("line", { x1: ML, y1: vToY(0), x2: ML + PLOT_W, y2: vToY(0),
      stroke: "var(--floor)", "stroke-width": 1, "stroke-dasharray": "3 3", opacity: 0.7 }));
  }

  // Real cubic segments -- the whole point of this view.
  let d = "";
  for (let i = 0; i < kfs.length - 1; i++) {
    const [p0, p1, p2, p3] = controlPoints(kfs[i], kfs[i + 1]);
    if (i === 0) d += "M " + tToX(p0[0]).toFixed(2) + " " + pv(p0[1]).toFixed(2) + " ";
    d += "C " + tToX(p1[0]).toFixed(2) + " " + pv(p1[1]).toFixed(2) + ", "
              + tToX(p2[0]).toFixed(2) + " " + pv(p2[1]).toFixed(2) + ", "
              + tToX(p3[0]).toFixed(2) + " " + pv(p3[1]).toFixed(2) + " ";
  }
  if (d) svg.appendChild(el("path", { d, fill: "none", stroke: "var(--curve)", "stroke-width": 1.6 }));

  kfs.forEach((k, ki) => {
    const px = tToX(k.time), py = pv(k.value);
    for (const h of [k.inHandle, k.outHandle]) {
      if (!h) continue;
      const hx = tToX(k.time + h.dt), hy = pv(k.value + h.dv);
      svg.appendChild(el("line", { x1: px, y1: py, x2: hx, y2: hy,
        stroke: "var(--handle)", "stroke-width": 1.2 }));
      svg.appendChild(el("rect", { x: hx - 2, y: hy - 2, width: 4, height: 4, fill: "var(--handle)" }));
    }
    const dot = el("circle", { cx: px, cy: py, r: 3.6, fill: "var(--key)",
      style: "cursor:pointer" });
    dot.addEventListener("click", () => { pause(); setTime(k.time); });
    const tip = el("title");
    // Raw value stays visible in the tooltip: the lane plots height, but
    // curves.json stores screen-space y, and those must stay reconcilable.
    const valueText = prop === "y"
      ? "height " + (FLOOR_Y - k.value).toFixed(2) + " (raw y " + k.value.toFixed(2) + ")"
      : k.value.toFixed(2);
    tip.textContent = prop + " key " + ki + " @ " + k.time.toFixed(3) + "s = " + valueText
      + "\\n" + (k.easeSource || "?") + (k.presetName ? " (" + k.presetName + ")" : "");
    dot.appendChild(tip);
    svg.appendChild(dot);
  });
});

const axisY = totalH - MB + 12;
svg.appendChild(el("line", { x1: ML, y1: axisY - 10, x2: W - MR, y2: axisY - 10, stroke: "var(--muted)" }));
for (const [t, anchor] of [[0, "start"], [DURATION, "end"]]) {
  const lab = el("text", { x: tToX(t), y: axisY + 4, "font-size": 10, fill: "var(--muted)", "text-anchor": anchor });
  lab.textContent = t.toFixed(2) + "s";
  svg.appendChild(lab);
}

const playhead = el("line", { x1: ML, y1: MT, x2: ML, y2: totalH - MB,
  stroke: "var(--playhead)", "stroke-width": 1.4 });
svg.appendChild(playhead);
document.getElementById("graph").appendChild(svg);

// --------------------------------------------------------------- playback
const scrub = document.getElementById("scrub");
const readout = document.getElementById("readout");
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
  playhead.setAttribute("x1", tToX(t));
  playhead.setAttribute("x2", tToX(t));
  readout.textContent = "t=" + t.toFixed(3) + "s  x=" + s.x.toFixed(1)
    + "  y=" + s.y.toFixed(1) + "  (" + (FLOOR_Y - s.y).toFixed(1) + "px above floor)";
}

function setTime(t) {
  now = Math.min(Math.max(t, 0), DURATION);
  scrub.value = String(now);
  draw(now);
}

function pause() {
  playing = false;
  playBtn.textContent = "Play";
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
  playBtn.textContent = "Pause";
  lastFrame = 0;
  rafId = requestAnimationFrame(tick);
});
scrub.addEventListener("input", () => { pause(); setTime(parseFloat(scrub.value)); });

// Keyframe stepping walks the y channel, where contacts and apexes live.
const stepTimes = (CURVES.properties.y || []).map((k) => k.time);
document.getElementById("prevKey").addEventListener("click", () => {
  pause();
  const prev = stepTimes.filter((t) => t < now - 1e-4).pop();
  setTime(prev === undefined ? 0 : prev);
});
document.getElementById("nextKey").addEventListener("click", () => {
  pause();
  const next = stepTimes.find((t) => t > now + 1e-4);
  setTime(next === undefined ? DURATION : next);
});

if ((CURVES.extractionWarnings || []).length > 0) {
  const box = document.createElement("div");
  box.className = "warn";
  box.textContent = "Extraction warnings: " + CURVES.extractionWarnings.join(" | ");
  document.getElementById("warnings").appendChild(box);
}

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
  fs.writeFileSync(outPath, renderViewerHtml(curves));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  main();
}
