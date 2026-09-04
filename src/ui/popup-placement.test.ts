import { describe, expect, it } from "vitest";
import { clampToViewport, placeSubmenu } from "./popup-placement";

const vp = { left: 0, top: 0, width: 360, height: 780 };

describe("clampToViewport", () => {
  it("leaves a popup that fits where it is", () => {
    expect(clampToViewport(100, 200, 180, 120, vp)).toEqual({ x: 100, y: 200 });
  });

  it("pulls a popup back from the right and bottom edges", () => {
    expect(clampToViewport(300, 700, 180, 120, vp)).toEqual({
      x: 360 - 4 - 180,
      y: 780 - 4 - 120,
    });
  });

  it("honours system-UI insets and the viewport's own offset", () => {
    const offsetVp = { left: 0, top: 50, width: 360, height: 700 };
    const insets = { top: 0, right: 48, bottom: 48, left: 0 };
    expect(clampToViewport(300, 740, 180, 120, offsetVp, insets)).toEqual({
      x: 360 - 48 - 4 - 180,
      y: 750 - 48 - 4 - 120,
    });
  });

  it("never pushes a popup past the top-left of the viewport", () => {
    expect(clampToViewport(-20, -20, 180, 120, vp)).toEqual({ x: 4, y: 4 });
  });
});

describe("placeSubmenu", () => {
  const parent = { left: 100, top: 300, width: 180, height: 32 };

  it("opens to the right of the row, aligned with its top", () => {
    const wide = { left: 0, top: 0, width: 1000, height: 780 };
    expect(placeSubmenu(parent, 140, 130, wide)).toEqual({ x: 280, y: 296 });
  });

  it("flips to the left when the right side overflows", () => {
    // 280 + 140 > 356 → flip to 100 − 140 = −40, which does not fit either…
    expect(placeSubmenu(parent, 140, 130, vp).x).toBe(360 - 4 - 140);
    // …but with room on the left it lands there.
    const rightParent = { ...parent, left: 200 };
    expect(placeSubmenu(rightParent, 140, 130, vp)).toEqual({ x: 60, y: 296 });
  });

  it("slides up when the row sits near the bottom", () => {
    const lowParent = { ...parent, top: 720 };
    const wide = { left: 0, top: 0, width: 1000, height: 780 };
    expect(placeSubmenu(lowParent, 140, 130, wide).y).toBe(780 - 4 - 130);
  });
});
