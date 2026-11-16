// Renders a CanonicalCurveSet as a graph-editor style plot: one lane per
// property (x, y, scaleX, scaleY, rotation), each showing its keyframes as
// dots and its Bezier handles as short line segments -- the same visual
// grammar as the handle view in a graph editor. Used both by the worker-
// facing `render_graph` tool (preview only) and by the final per-rollout
// artifact renderer (M7/analysis). Rasterization goes through Playwright
// (same dependency extraction already needs) rather than a native canvas
// library.
import path from "node:path";

import { chromium } from "playwright";

import type { CanonicalCurveSet, Keyframe, PropertyName } from "./schema.js";
import { PROPERTY_NAMES } from "./schema.js";

const WIDTH = 820;
const LANE_HEIGHT = 110;
const LANE_GAP = 8;
const MARGIN_LEFT = 90;
const MARGIN_RIGHT = 20;
const MARGIN_TOP = 20;
const MARGIN_BOTTOM = 30;

function laneBounds(kfs: Keyframe[]): [number, number] {
  if (kfs.length === 0) return [0, 1];
  let min = Infinity;
  let max = -Infinity;
  for (const k of kfs) {
    min = Math.min(min, k.value);
    max = Math.max(max, k.value);
    if (k.inHandle) {
      min = Math.min(min, k.value + k.inHandle.dv);
      max = Math.max(max, k.value + k.inHandle.dv);
    }
    if (k.outHandle) {
      min = Math.min(min, k.value + k.outHandle.dv);
      max = Math.max(max, k.value + k.outHandle.dv);
    }
  }
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const pad = (max - min) * 0.15;
  return [min - pad, max + pad];
}

export function renderGraphSvg(curves: CanonicalCurveSet): string {
  const plotWidth = WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
  const duration = Math.max(curves.durationSeconds, 0.001);
  const tToX = (t: number) => MARGIN_LEFT + (t / duration) * plotWidth;

  const lanes: string[] = [];
  let y = MARGIN_TOP;

  for (const prop of PROPERTY_NAMES) {
    const kfs = curves.properties[prop];
    const [vMin, vMax] = laneBounds(kfs);
    const vToY = (v: number) => y + LANE_HEIGHT - ((v - vMin) / (vMax - vMin || 1)) * LANE_HEIGHT;

    const parts: string[] = [
      `<rect x="0" y="${y}" width="${WIDTH}" height="${LANE_HEIGHT}" fill="none" stroke="#ddd" />`,
      `<text x="8" y="${y + 14}" font-size="12" fill="#333">${prop}</text>`,
    ];

    if (kfs.length > 0) {
      const pathD = kfs.map((k, i) => `${i === 0 ? "M" : "L"} ${tToX(k.time).toFixed(1)} ${vToY(k.value).toFixed(1)}`).join(" ");
      parts.push(`<path d="${pathD}" fill="none" stroke="#999" stroke-width="1" />`);

      for (const k of kfs) {
        const px = tToX(k.time);
        const py = vToY(k.value);
        parts.push(`<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="3.5" fill="#2563eb" />`);
        if (k.inHandle) {
          const hx = tToX(k.time + k.inHandle.dt);
          const hy = vToY(k.value + k.inHandle.dv);
          parts.push(`<line x1="${px.toFixed(1)}" y1="${py.toFixed(1)}" x2="${hx.toFixed(1)}" y2="${hy.toFixed(1)}" stroke="#f97316" stroke-width="1.5" />`);
          parts.push(`<rect x="${(hx - 2).toFixed(1)}" y="${(hy - 2).toFixed(1)}" width="4" height="4" fill="#f97316" />`);
        }
        if (k.outHandle) {
          const hx = tToX(k.time + k.outHandle.dt);
          const hy = vToY(k.value + k.outHandle.dv);
          parts.push(`<line x1="${px.toFixed(1)}" y1="${py.toFixed(1)}" x2="${hx.toFixed(1)}" y2="${hy.toFixed(1)}" stroke="#f97316" stroke-width="1.5" />`);
          parts.push(`<rect x="${(hx - 2).toFixed(1)}" y="${(hy - 2).toFixed(1)}" width="4" height="4" fill="#f97316" />`);
        }
      }
    } else {
      parts.push(`<text x="${MARGIN_LEFT}" y="${y + LANE_HEIGHT / 2}" font-size="11" fill="#aaa">(no data)</text>`);
    }

    lanes.push(parts.join(""));
    y += LANE_HEIGHT + LANE_GAP;
  }

  const totalHeight = y + MARGIN_BOTTOM;
  const axisY = totalHeight - MARGIN_BOTTOM + 10;
  const axis = `<line x1="${MARGIN_LEFT}" y1="${axisY - 10}" x2="${WIDTH - MARGIN_RIGHT}" y2="${axisY - 10}" stroke="#333" />` +
    `<text x="${MARGIN_LEFT}" y="${axisY + 5}" font-size="11" fill="#333">0s</text>` +
    `<text x="${WIDTH - MARGIN_RIGHT - 24}" y="${axisY + 5}" font-size="11" fill="#333">${duration.toFixed(2)}s</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${totalHeight}" style="background:#fff;font-family:sans-serif">` +
    lanes.join("") + axis + `</svg>`;
}

export async function renderGraphPng(curves: CanonicalCurveSet): Promise<Buffer> {
  const svg = renderGraphSvg(curves);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><html><body style="margin:0">${svg}</body></html>`);
    const el = await page.$("svg");
    if (!el) throw new Error("render-graph: svg element not found after setContent");
    return await el.screenshot();
  } finally {
    await browser.close();
  }
}

// CLI: node render-graph.ts <curvesJsonPath> <outPngPath>
// Used by analysis/gallery.py to render the final per-rollout graph plot
// from an already-extracted curves.json, independent of the live tool.
async function main() {
  const [curvesPath, outPath] = process.argv.slice(2);
  if (!curvesPath || !outPath) {
    console.error("usage: render-graph.ts <curvesJsonPath> <outPngPath>");
    process.exit(2);
  }
  const fs = await import("node:fs");
  const curves: CanonicalCurveSet = JSON.parse(fs.readFileSync(curvesPath, "utf-8"));
  const png = await renderGraphPng(curves);
  fs.writeFileSync(outPath, png);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  main();
}
