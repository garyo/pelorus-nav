import { beforeEach, describe, expect, it } from "vitest";
import { onFix, type SandboxArrival, setRoute } from "./route-sandbox";
import { VIBRATE_ARRIVAL, VIBRATE_PASS } from "./waypoint-chime-cues";

const route = {
  waypoints: [
    { lat: 42.35, lon: -71.05, name: "Alpha" },
    { lat: 42.36, lon: -71.05, name: "Bravo" },
    { lat: 42.37, lon: -71.05, name: "Charlie" },
  ],
  legIndex: 1,
  arrivalRadiusNM: 0.05,
};

const arrival = (json: string) => JSON.parse(json) as SandboxArrival;

describe("route sandbox", () => {
  beforeEach(() => setRoute(JSON.stringify(route)));

  it("announces each waypoint once, then the arrival, then nothing", () => {
    expect(onFix(42.355, -71.05, 6, 0)).toBe("");
    expect(arrival(onFix(42.3601, -71.05, 6, 0))).toEqual({
      reached: "Bravo",
      next: "Charlie",
      legIndex: 2,
      vibrate: VIBRATE_PASS,
    });
    expect(onFix(42.3602, -71.05, 6, 0)).toBe("");
    expect(arrival(onFix(42.37005, -71.05, 6, 0))).toEqual({
      reached: "Charlie",
      next: null,
      legIndex: -1,
      vibrate: VIBRATE_ARRIVAL,
    });
    expect(onFix(42.3701, -71.05, 6, 0)).toBe("");
  });

  it("follows nothing once the route is cleared", () => {
    setRoute("");
    expect(onFix(42.3601, -71.05, 6, 0)).toBe("");
  });
});
