import { describe, expect, it } from "vitest";
import { bilinearWind, type WindCorners } from "./wind-interp";

describe("bilinearWind", () => {
  it("blends 350°/10° across the 0/360° seam toward ~0°, never ~180°", () => {
    // Left column blows from 350°, right column from 10°, same speed — a
    // naive average of the raw degrees would give 180° (backwards).
    const corners: WindCorners = [
      { speed: 10, dir: 350 },
      { speed: 10, dir: 10 },
      { speed: 10, dir: 350 },
      { speed: 10, dir: 10 },
    ];
    const v = bilinearWind(corners, 0.5, 0.5);
    expect(v).not.toBeNull();
    const dir = v?.dir ?? Number.NaN;
    const distFromZero = Math.min(dir, 360 - dir);
    expect(distFromZero).toBeLessThan(2);
    expect(distFromZero).not.toBeCloseTo(180, 0);
  });

  it("blends speed linearly along an edge when direction is constant", () => {
    const corners: WindCorners = [
      null,
      null,
      { speed: 10, dir: 0 },
      { speed: 20, dir: 0 },
    ];
    const v = bilinearWind(corners, 0.25, 1);
    expect(v).not.toBeNull();
    expect(v?.speed).toBeCloseTo(12.5);
    expect(v?.dir).toBeCloseTo(0);
  });

  it("renormalizes over available corners: two identical corners at mid-edge return their value even with the other two missing", () => {
    const corners: WindCorners = [
      { speed: 15, dir: 200 },
      { speed: 15, dir: 200 },
      null,
      null,
    ];
    const v = bilinearWind(corners, 0.5, 0.5);
    expect(v).not.toBeNull();
    expect(v?.speed).toBeCloseTo(15);
    expect(v?.dir).toBeCloseTo(200);
  });

  it("returns null when all 4 corners are missing", () => {
    const corners: WindCorners = [null, null, null, null];
    expect(bilinearWind(corners, 0.5, 0.5)).toBeNull();
  });

  it("resolves to the corner's own value when the point sits exactly on it", () => {
    const corners: WindCorners = [
      { speed: 5, dir: 45 },
      { speed: 25, dir: 300 },
      { speed: 8, dir: 90 },
      { speed: 12, dir: 180 },
    ];
    const v = bilinearWind(corners, 0, 0);
    expect(v?.speed).toBeCloseTo(5);
    expect(v?.dir).toBeCloseTo(45);
  });
});
