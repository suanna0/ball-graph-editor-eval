// Shared page-scrubbing: load the worker's live page once, then jump its
// animation(s) to specific times and screenshot the stage. Used by
// render-gif.ts (full GIF, for the human-facing gallery) and by
// render-graph-tool.ts (a handful of still frames, for the worker's own
// `render_graph` tool) -- same mechanism, different sampling.
import path from "node:path";
import { pathToFileURL } from "node:url";

import { chromium } from "playwright";

import type { Framework } from "./schema.js";
import { installGsapRecorder } from "./adapters/gsap.js";

export async function scrubTo(page: import("playwright").Page, framework: Framework, t: number, fps: number) {
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

/** N PNG screenshots of the stage, at evenly spaced times from 0 to
 * durationSeconds inclusive (so the first is the start pose, the last is
 * the settled end pose). Raw buffers, not encoded into anything -- the
 * caller decides whether that's frames of a GIF or separate images in a
 * tool result. */
export async function renderFilmstrip(
  siteDir: string,
  framework: Framework,
  durationSeconds: number,
  frameCount: number,
  stageSelector = "#stage",
): Promise<{ t: number; png: Buffer }[]> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    if (framework === "gsap") await installGsapRecorder(page);
    const url = pathToFileURL(path.join(siteDir, "index.html")).toString();
    await page.goto(url);
    await page.waitForTimeout(100);

    const stage = page.locator(stageSelector).first();
    const n = Math.max(2, frameCount);
    const out: { t: number; png: Buffer }[] = [];
    for (let i = 0; i < n; i++) {
      const t = (i / (n - 1)) * durationSeconds;
      await scrubTo(page, framework, t, 30);
      out.push({ t, png: await stage.screenshot() });
    }
    return out;
  } finally {
    await browser.close();
  }
}
