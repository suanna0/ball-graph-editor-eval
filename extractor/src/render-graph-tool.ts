#!/usr/bin/env node
// CLI backing the worker-facing `render_graph` tool (runtime/tools.py):
//   node render-graph-tool.ts <siteDir> <framework>
// Extracts curves from the live sandbox files and prints a base64 PNG of
// the graph-editor plot to stdout -- nothing else goes to stdout, so the
// Python tool bridge can use it directly as an image content block. This
// is a preview aid only; see the module docstring in runtime/tools.py for
// why it cannot influence the official grade.
import { extract } from "./extract.js";
import { renderGraphPng } from "./render-graph.js";
import type { Framework } from "./schema.js";

async function main() {
  const [siteDir, framework] = process.argv.slice(2);
  if (!siteDir || !framework) {
    console.error("usage: render-graph-tool.ts <siteDir> <framework>");
    process.exit(2);
  }
  const curves = await extract(siteDir, framework as Framework);
  const png = await renderGraphPng(curves);
  process.stdout.write(png.toString("base64"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
