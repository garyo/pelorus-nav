import { describe, expect, it } from "vitest";
import { needsFit, TINY_FRACTION } from "./fit-bounds";

const CANVAS = { canvasWidth: 1000, canvasHeight: 800 };

describe("needsFit", () => {
  it("fits when not fully visible", () => {
    expect(
      needsFit({ fullyVisible: false, pxWidth: 900, pxHeight: 700, ...CANVAS }),
    ).toBe(true);
  });

  it("skips when visible and reasonably sized", () => {
    expect(
      needsFit({ fullyVisible: true, pxWidth: 400, pxHeight: 300, ...CANVAS }),
    ).toBe(false);
  });

  it("fits when visible but tiny in both dimensions", () => {
    expect(
      needsFit({ fullyVisible: true, pxWidth: 50, pxHeight: 40, ...CANVAS }),
    ).toBe(true);
  });

  it("skips a long thin feature — tiny in only one dimension", () => {
    expect(
      needsFit({ fullyVisible: true, pxWidth: 800, pxHeight: 20, ...CANVAS }),
    ).toBe(false);
    expect(
      needsFit({ fullyVisible: true, pxWidth: 20, pxHeight: 600, ...CANVAS }),
    ).toBe(false);
  });

  it("uses the TINY_FRACTION threshold exactly", () => {
    const atThreshold = {
      fullyVisible: true,
      pxWidth: 1000 * TINY_FRACTION,
      pxHeight: 800 * TINY_FRACTION,
      ...CANVAS,
    };
    expect(needsFit(atThreshold)).toBe(false); // at threshold = big enough
    expect(needsFit({ ...atThreshold, pxWidth: 99, pxHeight: 79 })).toBe(true);
  });
});
