import { describe, expect, it } from "vitest";
import type { Route } from "../data/Route";
import {
  computeNavigation,
  pickStartLeg,
  shouldAdvanceLeg,
} from "./ActiveNavigation";

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

describe("pickStartLeg", () => {
  // Route along the equator: wp0 at (0, 0), wp1 at (0, 1) — due east.
  const route: Route = {
    id: "r1",
    name: "Test",
    createdAt: 0,
    color: "#000",
    visible: true,
    waypoints: [
      { lat: 0, lon: 0, name: "WP0" },
      { lat: 0, lon: 1, name: "WP1" },
    ],
  };
  const arrivalRadius = 0.1; // NM

  it("targets waypoint[0] when the vessel is still short of it", () => {
    // Vessel west of wp0 (behind the route start) — wp0 is ahead.
    expect(pickStartLeg(0, -0.5, route, arrivalRadius)).toBe(0);
  });

  it("starts at leg 1 once the vessel has passed waypoint[0]", () => {
    // Vessel between wp0 and wp1 — already past wp0's perpendicular.
    expect(pickStartLeg(0, 0.5, route, arrivalRadius)).toBe(1);
  });

  it("starts at leg 1 when the vessel is within waypoint[0]'s arrival radius", () => {
    // Vessel essentially at wp0 (but a touch west, so not past perpendicular).
    expect(pickStartLeg(0, -0.0001, route, arrivalRadius)).toBe(1);
  });

  it("defaults to leg 1 for a degenerate single-waypoint route", () => {
    const single: Route = { ...route, waypoints: [route.waypoints[0]] };
    expect(pickStartLeg(0, -0.5, single, arrivalRadius)).toBe(1);
  });
});
