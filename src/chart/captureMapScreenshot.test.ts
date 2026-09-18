import { describe, expect, it } from "vitest";
import { flipVertically } from "./captureMapScreenshot";

/** One row of a w×h RGBA image, each pixel tagged with its row index. */
function rows(width: number, height: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      px[i] = y;
      px[i + 1] = x;
      px[i + 2] = 0;
      px[i + 3] = 255;
    }
  }
  return px;
}

/** Row index recorded in the red channel of each row's first pixel. */
function rowOrder(px: Uint8ClampedArray, width: number, height: number) {
  return Array.from({ length: height }, (_, y) => px[y * width * 4]);
}

describe("flipVertically", () => {
  it("reverses row order for an even row count", () => {
    const px = rows(3, 4);
    flipVertically(px, 3, 4);
    expect(rowOrder(px, 3, 4)).toEqual([3, 2, 1, 0]);
  });

  it("reverses row order for an odd row count, keeping the middle row", () => {
    const px = rows(3, 5);
    flipVertically(px, 3, 5);
    expect(rowOrder(px, 3, 5)).toEqual([4, 3, 2, 1, 0]);
  });

  it("keeps pixels within a row in order", () => {
    const px = rows(4, 2);
    flipVertically(px, 4, 2);
    // Row 0 is now the old row 1; its green channel still counts 0..3.
    expect([px[1], px[5], px[9], px[13]]).toEqual([0, 1, 2, 3]);
  });

  it("is a no-op for a single row", () => {
    const px = rows(3, 1);
    const before = Uint8ClampedArray.from(px);
    flipVertically(px, 3, 1);
    expect(px).toEqual(before);
  });

  it("round-trips: flipping twice restores the original", () => {
    const px = rows(5, 7);
    const before = Uint8ClampedArray.from(px);
    flipVertically(px, 5, 7);
    flipVertically(px, 5, 7);
    expect(px).toEqual(before);
  });
});
