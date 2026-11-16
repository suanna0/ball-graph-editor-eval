#!/usr/bin/env node
// CLI: node render-gif.ts <siteDir> <framework> <durationSeconds> <outGifPath> [fps]
// Drives the live page across its own duration (scrubbing whichever
// mechanism the framework exposes) and screenshots each frame, then
// encodes a GIF. This is a per-rollout artifact for the gallery (M7), not
// part of grading -- grading only ever looks at the canonical curves.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// gifenc's CJS build isn't statically analyzable for named ESM exports
// (Node only sees a `default`), so destructure off the default import.
import gifenc from "gifenc";
const { GIFEncoder, quantize, applyPalette } = gifenc;
import { PNG } from "pngjs";
import { chromium } from "playwright";

import type { Framework } from "./schema.js";
import { installGsapRecorder } from "./adapters/gsap.js";

async function scrubTo(page: import("playwright").Page, framework: Framework, t: number, fps: number) {
  if (framework === "gsap") {
    await page.evaluate((tt: number) => {
      const g = (window as any).gsap;
      if (!g) return;
      g.globalTimeline.pause();
      g.globalTimeline.time(tt, false);
    }, t);
    return;
  }
  if (framework === "lottie") {
    await page.evaluate(
      ({ tt, ffps }: { tt: number; ffps: number }) => {
        const anims = (window as any).lottie?.getRegisteredAnimations?.() ?? [];
        for (const a of anims) a.goToAndStop(tt * ffps, true);
      },
      { tt: t, ffps: fps },
    );
    return;
  }
  // css / waa / motion
  await page.evaluate((tt: number) => {
    for (const a of document.getAnimations()) {
      a.pause();
      a.currentTime = tt * 1000;
    }
  }, t);
}

export async function renderGif(
  siteDir: string,
  framework: Framework,
  durationSeconds: number,
  outPath: string,
  fps = 20,
  stageSelector = "#stage",
): Promise<void> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    if (framework === "gsap") await installGsapRecorder(page);
    const url = pathToFileURL(path.join(siteDir, "index.html")).toString();
    await page.goto(url);
    await page.waitForTimeout(100);

    const stage = page.locator(stageSelector).first();
    const frameCount = Math.max(1, Math.round(durationSeconds * fps));

    const frames: { data: Buffer; width: number; height: number }[] = [];
    for (let i = 0; i <= frameCount; i++) {
      const t = (i / frameCount) * durationSeconds;
      await scrubTo(page, framework, t, fps);
      const buf = await stage.screenshot();
      const png = PNG.sync.read(buf);
      frames.push({ data: png.data, width: png.width, height: png.height });
    }

    const { width, height } = frames[0];
    const gif = GIFEncoder();
    for (const f of frames) {
      const palette = quantize(f.data, 256);
      const index = applyPalette(f.data, palette);
      gif.writeFrame(index, width, height, { palette, delay: Math.round(1000 / fps) });
    }
    gif.finish();
    writeFileSync(outPath, gif.bytes());
  } finally {
    await browser.close();
  }
}

async function main() {
  const [siteDir, framework, durationStr, outPath, fpsStr] = process.argv.slice(2);
  if (!siteDir || !framework || !durationStr || !outPath) {
    console.error("usage: render-gif.ts <siteDir> <framework> <durationSeconds> <outGifPath> [fps]");
    process.exit(2);
  }
  await renderGif(siteDir, framework as Framework, parseFloat(durationStr), outPath, fpsStr ? parseInt(fpsStr, 10) : 20);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
