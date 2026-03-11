import { describe, expect, it } from "vitest";
import { computeNavigation } from "./ActiveNavigation";

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
