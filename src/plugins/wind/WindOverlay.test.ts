import { describe, expect, it } from "vitest";
import { canReuseGrid } from "./WindOverlay";

const viewport = { width: 1, height: 1 }; // 1° × 1° viewport for easy fractions

describe("canReuseGrid (coarse-snap cache)", () => {
  it("never reuses without prior data or anchor", () => {
    const cur = { lng: 0, lat: 0, zoomBucket: 10 };
    expect(canReuseGrid(null, cur, viewport, true)).toBe(false);
    expect(
      canReuseGrid({ lng: 0, lat: 0, zoomBucket: 10 }, cur, viewport, false),
    ).toBe(false);
  });

  it("reuses for a small pan within the snap fraction", () => {
    const prev = { lng: 0, lat: 0, zoomBucket: 10 };
    // 0.3° < 0.4 × 1° → reuse
    const cur = { lng: 0.3, lat: -0.3, zoomBucket: 10 };
    expect(canReuseGrid(prev, cur, viewport, true)).toBe(true);
  });

  it("re-fetches once the pan exceeds the snap fraction on either axis", () => {
    const prev = { lng: 0, lat: 0, zoomBucket: 10 };
    expect(
      canReuseGrid(
        { ...prev },
        { lng: 0.5, lat: 0, zoomBucket: 10 },
        viewport,
        true,
      ),
    ).toBe(false);
    expect(
      canReuseGrid(
        { ...prev },
        { lng: 0, lat: 0.41, zoomBucket: 10 },
        viewport,
        true,
      ),
    ).toBe(false);
  });

  it("re-fetches when the zoom bucket changes even if centred identically", () => {
    const prev = { lng: 0, lat: 0, zoomBucket: 10 };
    const cur = { lng: 0, lat: 0, zoomBucket: 11 };
    expect(canReuseGrid(prev, cur, viewport, true)).toBe(false);
  });

  it("scales the threshold with viewport size", () => {
    const prev = { lng: 0, lat: 0, zoomBucket: 8 };
    const cur = { lng: 1.5, lat: 0, zoomBucket: 8 };
    // 1.5° pan: reuse in a 5°-wide viewport (1.5 < 2.0), refetch in a 1° one.
    expect(canReuseGrid(prev, cur, { width: 5, height: 5 }, true)).toBe(true);
    expect(canReuseGrid(prev, cur, { width: 1, height: 1 }, true)).toBe(false);
  });
});
