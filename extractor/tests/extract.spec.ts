import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { extractDomAnimations } from "../src/adapters/domAnimations.js";
import { extractLottie } from "../src/adapters/lottie.js";
import { extractGsapAnimations, installGsapRecorder } from "../src/adapters/gsap.js";
import { chromium } from "playwright";

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

// Every fixture here encodes the SAME intended bounce: 80,140 -> 480,320/300
// -> 880,140 over 2s, first half eased with cubic-bezier(0.33,0,0.67,0.33)
// (the ideal-parabola "fall" shape), second half with
// cubic-bezier(0.33,0.67,0.67,1) (the ideal-parabola "rise" shape) -- so all
// three adapters can be checked against the same expected numbers.

function approx(a: number, b: number, eps = 0.5) {
  expect(Math.abs(a - b)).toBeLessThanOrEqual(eps);
}

describe("CSS/WAA adapter (document.getAnimations)", () => {
  it("extracts keyframe values and converts cubic-bezier easing to absolute handles", async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(`file://${path.join(FIXTURES, "css-bounce", "index.html")}`);
      await page.waitForFunction(() => document.getAnimations().length > 0);
      const curves = await extractDomAnimations(page, "css");

      expect(curves.extractionWarnings).toEqual([]);
      expect(curves.durationSeconds).toBeCloseTo(2, 5);

      // y=140 (small, i.e. high on screen) is the apex at both ends;
      // y=320 (larger, i.e. low on screen) is the contact point in the
      // middle -- apex -> contact -> apex, one full bounce.
      const y = curves.properties.y;
      expect(y).toHaveLength(3);
      approx(y[0].value, 140);
      approx(y[1].value, 320);
      approx(y[2].value, 140);

      // Apex handles (first/last keyframe) should be flat (dv ~ 0).
      approx(y[0].outHandle!.dv, 0, 1);
      approx(y[2].inHandle!.dv, 0, 1);
      // Contact handles (middle keyframe) should be sharp, not flat.
      expect(Math.abs(y[1].inHandle!.dv)).toBeGreaterThan(50);
      expect(Math.abs(y[1].outHandle!.dv)).toBeGreaterThan(50);

      expect(y[0].easeSource).toBe("hand-placed");
      expect(y[0].presetName).toContain("cubic-bezier");
    } finally {
      await browser.close();
    }
  });
});

describe("Lottie adapter (direct JSON parse)", () => {
  it("extracts the same bounce shape from bezier i/o tangents", () => {
    const curves = extractLottie(path.join(FIXTURES, "lottie-bounce"), "ball");
    expect(curves.extractionWarnings).toEqual([]);

    const y = curves.properties.y;
    expect(y).toHaveLength(3);
    approx(y[0].value, 140);
    approx(y[1].value, 320);
    approx(y[2].value, 140);
    approx(y[0].outHandle!.dv, 0, 1);
    approx(y[2].inHandle!.dv, 0, 1);
    expect(Math.abs(y[1].inHandle!.dv)).toBeGreaterThan(50);
    expect(Math.abs(y[1].outHandle!.dv)).toBeGreaterThan(50);
    expect(y[0].easeSource).toBe("hand-placed");
  });
});

describe("GSAP adapter (wrapper + timeline scrub)", () => {
  it(
    "records tweens via the window.gsap wrapper and resolves power2 eases",
    async () => {
      const browser = await chromium.launch();
      try {
        const page = await browser.newPage();
        await installGsapRecorder(page);
        await page.goto(`file://${path.join(FIXTURES, "gsap-bounce", "index.html")}`);
        await page.waitForFunction(() => (window as any).__gsapRecorder?.tweens?.length > 0);
        const curves = await extractGsapAnimations(page, "gsap");

        expect(curves.extractionWarnings).toEqual([]);
        expect(curves.durationSeconds).toBeCloseTo(2, 5);

        const x = curves.properties.x;
        expect(x).toHaveLength(3);
        approx(x[0].value, 80);
        approx(x[1].value, 480);
        approx(x[2].value, 880);
        expect(x[0].presetName).toBe("power2.in");
        expect(x[1].presetName).toBe("power2.out");
      } finally {
        await browser.close();
      }
    },
    20_000,
  );
});
