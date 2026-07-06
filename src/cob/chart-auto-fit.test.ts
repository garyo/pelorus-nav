import { describe, expect, it } from "vitest";
import { cobFitBounds } from "./chart-auto-fit";

describe("cobFitBounds", () => {
  it("is symmetric about the vessel and contains the COB point", () => {
    const [[west, south], [east, north]] = cobFitBounds(
      42.36,
      -71.05,
      42.38,
      -71.01,
    );
    // Vessel centered
    expect((west + east) / 2).toBeCloseTo(-71.05, 10);
    expect((south + north) / 2).toBeCloseTo(42.36, 10);
    // COB inside
    expect(42.38).toBeGreaterThanOrEqual(south);
    expect(42.38).toBeLessThanOrEqual(north);
    expect(-71.01).toBeGreaterThanOrEqual(west);
    expect(-71.01).toBeLessThanOrEqual(east);
  });

  it("contains the COB point in any direction from the vessel", () => {
    for (const [dLat, dLon] of [
      [0.02, 0.03],
      [-0.02, 0.03],
      [0.02, -0.03],
      [-0.02, -0.03],
    ]) {
      const [[west, south], [east, north]] = cobFitBounds(
        42.36,
        -71.05,
        42.36 + dLat,
        -71.05 + dLon,
      );
      expect(42.36 + dLat).toBeGreaterThanOrEqual(south);
      expect(42.36 + dLat).toBeLessThanOrEqual(north);
      expect(-71.05 + dLon).toBeGreaterThanOrEqual(west);
      expect(-71.05 + dLon).toBeLessThanOrEqual(east);
    }
  });

  it("never degenerates when vessel sits on the COB point", () => {
    const [[west, south], [east, north]] = cobFitBounds(
      42.36,
      -71.05,
      42.36,
      -71.05,
    );
    expect(north - south).toBeGreaterThan(0);
    expect(east - west).toBeGreaterThan(0);
  });
});
