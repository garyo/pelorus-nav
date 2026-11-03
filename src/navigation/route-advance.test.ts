import { describe, expect, it } from "vitest";
import { courseFrom, routeAdvance } from "./route-advance";

const north = [
  { lat: 42.35, lon: -71.05 },
  { lat: 42.36, lon: -71.05 },
  { lat: 42.37, lon: -71.05 },
];
const RADIUS = 0.05;

describe("routeAdvance", () => {
  it("stays short of the target", () => {
    expect(routeAdvance(42.355, -71.05, 0, north, 1, RADIUS)).toBe("stay");
  });

  it("moves on inside the arrival radius only once the target is abeam", () => {
    expect(routeAdvance(42.3596, -71.05, 0, north, 1, RADIUS)).toBe("stay");
    expect(routeAdvance(42.36005, -71.05, 0, north, 1, RADIUS)).toBe("next");
  });

  it("moves on once the target is passed abeam, well off it", () => {
    expect(routeAdvance(42.3601, -71.06, 0, north, 1, RADIUS)).toBe("next");
  });

  it("finishes only on reaching the last waypoint", () => {
    expect(routeAdvance(42.3701, -71.06, 0, north, 2, RADIUS)).toBe("stay");
    expect(routeAdvance(42.3699, -71.05, 0, north, 2, RADIUS)).toBe("stay");
    expect(routeAdvance(42.37005, -71.05, 0, north, 2, RADIUS)).toBe("finish");
    expect(routeAdvance(42.3699, -71.05, null, north, 2, RADIUS)).toBe(
      "finish",
    );
  });
});

describe("courseFrom", () => {
  it("drops the course when all but stopped", () => {
    expect(courseFrom(0.2, 90)).toBeNull();
    expect(courseFrom(null, 90)).toBeNull();
    expect(courseFrom(5, 90)).toBe(90);
    expect(courseFrom(5, null)).toBeNull();
  });
});
