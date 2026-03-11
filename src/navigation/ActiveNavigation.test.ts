import { describe, expect, it } from "vitest";
import { computeNavigation, shouldAdvanceLeg } from "./ActiveNavigation";

describe("computeNavigation", () => {
  it("computes bearing and distance between two points", () => {
    // Boston Harbor to Provincetown (roughly NE)
    const result = computeNavigation(42.36, -71.06, 42.05, -70.19);
    expect(result.distanceNM).toBeGreaterThan(30);
    expect(result.distanceNM).toBeLessThan(50);
    expect(result.bearingDeg).toBeGreaterThan(100);
    expect(result.bearingDeg).toBeLessThan(150);
  });

  it("returns zero distance for same point", () => {
    const result = computeNavigation(42.36, -71.06, 42.36, -71.06);
    expect(result.distanceNM).toBeCloseTo(0, 5);
  });

  it("computes due north bearing", () => {
    const result = computeNavigation(42.0, -71.0, 43.0, -71.0);
    expect(result.bearingDeg).toBeCloseTo(0, 0);
  });

  it("computes due east bearing", () => {
    const result = computeNavigation(42.0, -71.0, 42.0, -70.0);
    expect(result.bearingDeg).toBeGreaterThan(85);
    expect(result.bearingDeg).toBeLessThan(95);
  });
});

describe("shouldAdvanceLeg", () => {
  // Leg: A(0,0) → B(0,1) — due east along equator, ~60 NM
  const fromLat = 0,
    fromLon = 0;
  const toLat = 0,
    toLon = 1;
  const arrivalRadius = 0.1; // 0.1 NM

  it("returns true when inside arrival radius", () => {
    // Vessel very close to target
    expect(
      shouldAdvanceLeg(
        0,
        0.9999,
        fromLat,
        fromLon,
        toLat,
        toLon,
        arrivalRadius,
      ),
    ).toBe(true);
  });

  it("returns true when past perpendicular (sailed past waypoint off-track)", () => {
    // Vessel at 0.05°N, 1.1°E — past B, offset north (missed radius)
    expect(
      shouldAdvanceLeg(
        0.05,
        1.1,
        fromLat,
        fromLon,
        toLat,
        toLon,
        arrivalRadius,
      ),
    ).toBe(true);
  });

  it("returns false when before perpendicular and outside radius", () => {
    // Vessel at 0°, 0.5° — halfway along, not near target
    expect(
      shouldAdvanceLeg(0, 0.5, fromLat, fromLon, toLat, toLon, arrivalRadius),
    ).toBe(false);
  });

  it("returns false when off-track but before the target perpendicular", () => {
    // Vessel at 0.5°N, 0.5°E — way off track but only halfway along
    expect(
      shouldAdvanceLeg(0.5, 0.5, fromLat, fromLon, toLat, toLon, arrivalRadius),
    ).toBe(false);
  });

  it("returns true when on-track and just past the waypoint", () => {
    // Vessel at 0°, 1.01° — just past B on the line
    expect(
      shouldAdvanceLeg(0, 1.01, fromLat, fromLon, toLat, toLon, arrivalRadius),
    ).toBe(true);
  });
});
