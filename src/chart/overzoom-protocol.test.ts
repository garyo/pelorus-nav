import { describe, expect, it } from "vitest";
import { parentQuadrant } from "./overzoom-protocol";

describe("parentQuadrant", () => {
  it("selects the right quadrant one level up", () => {
    // Tile (z, 5, 3) inside parent (z-1, 2, 1): odd x → right, odd y → bottom
    expect(parentQuadrant(1, 5, 3, 256)).toEqual({
      sx: 128,
      sy: 128,
      size: 128,
    });
    expect(parentQuadrant(1, 4, 2, 256)).toEqual({ sx: 0, sy: 0, size: 128 });
  });

  it("selects a sixteenth two levels up", () => {
    // (z, 7, 5) inside grandparent (z-2, 1, 1): offsets 3,1 of 4 → 192,64
    expect(parentQuadrant(2, 7, 5, 256)).toEqual({ sx: 192, sy: 64, size: 64 });
  });

  it("scales with the parent bitmap size", () => {
    expect(parentQuadrant(1, 1, 1, 512)).toEqual({
      sx: 256,
      sy: 256,
      size: 256,
    });
  });
});
