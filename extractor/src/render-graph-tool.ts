#!/usr/bin/env node
// CLI backing the worker-facing `render_graph` tool (runtime/tools.py):
//   node render-graph-tool.ts <siteDir> <framework>
// Extracts curves from the live sandbox files and renders TWO things, so
// the worker sees its work the way a human animator would: the
// graph-editor plot (curve shape), and a filmstrip of the actual rendered
// stage at a few points across the animation (how it looks). A real
// animated preview isn't possible -- a tool-result "image" is a single
// static frame, there's no way to hand the model something it can play --
// so a few evenly-spaced stills stand in for that.
//
// Prints one JSON object to stdout -- nothing else goes to stdout, so the
// Python tool bridge can parse it directly into image content blocks.
// This is a preview aid only; see the module docstring in
// runtime/tools.py for why it cannot influence the official grade.
import { extract } from "./extract.js";
import { renderGraphPng } from "./render-graph.js";
import { renderFilmstrip } from "./filmstrip.js";
import type { Framework } from "./schema.js";

const FILMSTRIP_FRAMES = 6;

async function main() {
  const [siteDir, framework] = process.argv.slice(2);
  if (!siteDir || !framework) {
    console.error("usage: render-graph-tool.ts <siteDir> <framework>");
    process.exit(2);
  }
  const fw = framework as Framework;
  const curves = await extract(siteDir, fw);
  const graphPng = await renderGraphPng(curves);
  const frames = await renderFilmstrip(siteDir, fw, Math.max(curves.durationSeconds, 0.001), FILMSTRIP_FRAMES);
  process.stdout.write(JSON.stringify({
    graph: graphPng.toString("base64"),
    frames: frames.map((f) => ({ t: f.t, png: f.png.toString("base64") })),
  }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
