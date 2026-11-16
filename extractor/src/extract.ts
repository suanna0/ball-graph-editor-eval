#!/usr/bin/env node
// CLI: node extract.ts <siteDir> <framework> [selector]
// Prints the CanonicalCurveSet JSON to stdout, and ONLY that -- diagnostics
// go to stderr so callers (grader/grade.py, runtime/tools.py) can parse
// stdout directly.
import path from "node:path";
import { pathToFileURL } from "node:url";

import { chromium } from "playwright";

import { extractGsapAnimations, installGsapRecorder } from "./adapters/gsap.js";
import { extractDomAnimations } from "./adapters/domAnimations.js";
import { extractLottie } from "./adapters/lottie.js";
import type { CanonicalCurveSet, Framework } from "./schema.js";

async function extractBrowserBased(siteDir: string, framework: Framework, selector: string): Promise<CanonicalCurveSet> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    if (framework === "gsap") await installGsapRecorder(page);

    const url = pathToFileURL(path.join(siteDir, "index.html")).toString();
    await page.goto(url);

    if (framework === "gsap") {
      await page.waitForFunction(() => (window as any).__gsapRecorder?.tweens?.length > 0, { timeout: 5000 }).catch(() => {});
      return await extractGsapAnimations(page, framework, selector);
    }
    await page
      .waitForFunction((sel: string) => {
        const el = document.querySelector(sel);
        return !!el && document.getAnimations().some((a) => (a as any).effect?.target === el);
      }, selector, { timeout: 5000 })
      .catch(() => {});
    return await extractDomAnimations(page, framework, selector);
  } finally {
    await browser.close();
  }
}

export async function extract(siteDir: string, framework: Framework, selector = "#ball"): Promise<CanonicalCurveSet> {
  if (framework === "lottie") return extractLottie(siteDir);
  if (framework === "css" || framework === "waa" || framework === "motion" || framework === "gsap") {
    return extractBrowserBased(siteDir, framework, selector);
  }
  throw new Error(`unknown framework: ${framework}`);
}

async function main() {
  const [siteDir, framework, selector] = process.argv.slice(2);
  if (!siteDir || !framework) {
    console.error("usage: extract.ts <siteDir> <framework> [selector]");
    process.exit(2);
  }
  try {
    const result = await extract(path.resolve(siteDir), framework as Framework, selector);
    process.stdout.write(JSON.stringify(result));
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  main();
}
