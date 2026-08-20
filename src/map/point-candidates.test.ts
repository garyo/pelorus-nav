import { describe, expect, it } from "vitest";
import type { Route } from "../data/Route";
import type { StandaloneWaypoint } from "../data/Waypoint";
import { findPointCandidates, type Projector } from "./point-candidates";

// 100 px per degree, y inverted like screen coords.
const project: Projector = ([lon, lat]) => ({ x: lon * 100, y: -lat * 100 });

const wp = (id: string, name: string, lon: number, lat: number) =>
  ({ id, name, lon, lat, visible: true }) as unknown as StandaloneWaypoint;

const route = (id: string, name: string, pts: [number, number][]) =>
  ({
    id,
    name,
    visible: true,
    waypoints: pts.map(([lon, lat], i) => ({ lon, lat, name: `WP${i + 1}` })),
  }) as unknown as Route;

describe("findPointCandidates", () => {
  const nun = wp("w1", "Nun 4", 1.0, 1.0);
  const far = wp("w2", "Far", 5.0, 5.0);
  // Route with a point snapped exactly onto "Nun 4" — the common case the
  // targeted menu exists for.
  const salem = route("r1", "Salem Run", [
    [0.5, 0.5],
    [1.0, 1.0],
    [1.5, 1.5],
  ]);

  it("finds coincident waypoint and route point, nearest first", () => {
    const hits = findPointCandidates(project, 100, -100, [nun, far], [salem]);
    expect(hits).toHaveLength(2);
    expect(hits.map((h) => h.kind).sort()).toEqual(["route-point", "waypoint"]);
    const rp = hits.find((h) => h.kind === "route-point");
    expect(rp && rp.kind === "route-point" && rp.index).toBe(1);
  });

  it("returns one candidate per route (its nearest point)", () => {
    // Press between two points of the same route, both within radius.
    const tight = route("r2", "Tight", [
      [1.0, 1.0],
      [1.1, 1.0], // 10 px away from the first at this scale
    ]);
    const hits = findPointCandidates(project, 105, -100, [], [tight]);
    expect(hits).toHaveLength(1);
  });

  it("excludes everything beyond the radius", () => {
    const hits = findPointCandidates(project, 100, -100, [far], []);
    expect(hits).toHaveLength(0);
  });

  it("empty chart press yields no candidates", () => {
    expect(findPointCandidates(project, 900, -900, [nun], [salem])).toEqual([]);
  });
});
