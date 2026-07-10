import { describe, expect, it } from "vitest";
import { opaqueByHeader, parentQuadrant } from "./overzoom-protocol";

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

describe("opaqueByHeader", () => {
  it("JPEG is always opaque", () => {
    expect(opaqueByHeader(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
  });

  it("PNG colour types without alpha are opaque", () => {
    const png = (colorType: number) => {
      const b = new Uint8Array(30);
      b[0] = 0x89;
      b[1] = 0x50;
      b[25] = colorType;
      return b;
    };
    expect(opaqueByHeader(png(2))).toBe(true); // RGB
    expect(opaqueByHeader(png(0))).toBe(true); // greyscale
    expect(opaqueByHeader(png(6))).toBe(null); // RGBA — must decode
    expect(opaqueByHeader(png(3))).toBe(null); // palette — may have tRNS
  });

  it("unknown formats need a decode", () => {
    expect(opaqueByHeader(new Uint8Array([1, 2, 3, 4]))).toBe(null);
  });
});
