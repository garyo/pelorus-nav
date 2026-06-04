import { describe, expect, it } from "vitest";
import type { Route } from "./Route";
import { routeToTrackPoints } from "./route-preview";

const T0 = Date.parse("2026-06-04T10:00:00Z");

function route(waypoints: Array<[number, number]>): Route {
  return {
    id: "r1",
    name: "Test Route",
    createdAt: T0,
    color: "#3388ff",
    visible: true,
    waypoints: waypoints.map(([lat, lon], i) => ({ lat, lon, name: `WP${i}` })),
  };
}

describe("routeToTrackPoints", () => {
  it("returns [] for unsailable routes", () => {
    expect(routeToTrackPoints(route([[42, -71]]), 5, T0)).toHaveLength(0);
    expect(
      routeToTrackPoints(
        route([
          [42, -71],
          [42.1, -71],
        ]),
        0,
        T0,
      ),
    ).toHaveLength(0);
  });

  it("times waypoints by leg distance at the planning speed", () => {
    // Two 6 NM northward legs at 6 kn → one hour each
    const pts = routeToTrackPoints(
      route([
        [42, -71],
        [42.1, -71],
        [42.2, -71],
      ]),
      6,
      T0,
    );
    expect(pts).toHaveLength(3);
    expect(pts[0].timestamp).toBe(T0);
    expect(pts[1].timestamp).toBeCloseTo(T0 + 3_600_000, -4);
    expect(pts[2].timestamp).toBeCloseTo(T0 + 7_200_000, -4);
    expect(pts[1].sog).toBe(6);
  });

  it("sets COG to the outgoing leg bearing, final point keeps last leg", () => {
    const pts = routeToTrackPoints(
      route([
        [42, -71],
        [42.1, -71], // due north
        [42.1, -70.9], // due east
      ]),
      5,
      T0,
    );
    expect(pts[0].cog).toBeCloseTo(0, 0);
    expect(pts[1].cog).toBeCloseTo(90, 0);
    expect(pts[2].cog).toBeCloseTo(90, 0);
  });
});
