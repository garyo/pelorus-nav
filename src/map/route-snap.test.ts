import { describe, expect, it } from "vitest";
import type { Route, Waypoint } from "../data/Route";
import type { StandaloneWaypoint } from "../data/Waypoint";
import {
  collectSnapCandidates,
  findSnap,
  isExcluded,
  type SnapCandidate,
} from "./route-snap";

// Identity-ish projection: 1 degree = 100 px, y flipped like screen coords.
const project = ([lon, lat]: [number, number]) => ({
  x: lon * 100,
  y: -lat * 100,
});

function wp(lat: number, lon: number, name = ""): Waypoint {
  return { lat, lon, name };
}

function standalone(
  lat: number,
  lon: number,
  name: string,
): StandaloneWaypoint {
  return {
    id: name,
    lat,
    lon,
    name,
    notes: "",
    icon: "default",
    createdAt: 0,
    updatedAt: 0,
  };
}

function route(name: string, waypoints: Waypoint[]): Route {
  return {
    id: name,
    name,
    createdAt: 0,
    color: "#4488cc",
    visible: true,
    waypoints,
  };
}

describe("collectSnapCandidates", () => {
  it("gathers other-route, standalone, and own waypoints", () => {
    const cands = collectSnapCandidates(
      [route("A", [wp(1, 1, "A1"), wp(2, 2, "A2")])],
      [standalone(3, 3, "S1")],
      [wp(4, 4, "own")],
    );
    expect(cands).toHaveLength(4);
    expect(cands.filter((c) => c.ownIndex !== undefined)).toEqual([
      { lat: 4, lon: 4, name: "own", ownIndex: 0 },
    ]);
  });
});

describe("isExcluded", () => {
  const own = (i: number): SnapCandidate => ({
    lat: 0,
    lon: 0,
    name: "",
    ownIndex: i,
  });
  const external: SnapCandidate = { lat: 0, lon: 0, name: "ext" };

  it("never excludes external candidates", () => {
    expect(isExcluded(external, { kind: "append", lastIndex: 0 })).toBe(false);
    expect(isExcluded(external, { kind: "drag", index: 1 })).toBe(false);
  });

  it("append excludes only the current last waypoint", () => {
    const op = { kind: "append", lastIndex: 3 } as const;
    expect(isExcluded(own(3), op)).toBe(true);
    expect(isExcluded(own(2), op)).toBe(false);
    expect(isExcluded(own(0), op)).toBe(false); // start stays snappable (loop)
  });

  it("drag excludes the dragged point and its neighbors", () => {
    const op = { kind: "drag", index: 2 } as const;
    expect(isExcluded(own(1), op)).toBe(true);
    expect(isExcluded(own(2), op)).toBe(true);
    expect(isExcluded(own(3), op)).toBe(true);
    expect(isExcluded(own(0), op)).toBe(false);
    expect(isExcluded(own(4), op)).toBe(false);
  });
});

describe("findSnap", () => {
  const cands: SnapCandidate[] = [
    { lat: 0, lon: 0, name: "origin" },
    { lat: 0, lon: 1, name: "east" },
  ];
  const append = { kind: "append", lastIndex: -1 } as const;

  it("returns the nearest candidate within the radius", () => {
    // Cursor at (95, 0) px: 5 px from "east" (100, 0), 95 px from origin.
    const hit = findSnap(cands, append, { x: 95, y: 0 }, project);
    expect(hit?.name).toBe("east");
  });

  it("returns null when nothing is within the radius", () => {
    expect(findSnap(cands, append, { x: 50, y: 0 }, project)).toBeNull();
  });

  it("respects a custom radius", () => {
    expect(findSnap(cands, append, { x: 50, y: 0 }, project, 60)).toBeTruthy();
  });

  it("skips excluded own points even when they are nearest", () => {
    const withOwn: SnapCandidate[] = [
      ...cands,
      { lat: 0, lon: 0.95, name: "own-last", ownIndex: 5 },
    ];
    const hit = findSnap(
      withOwn,
      { kind: "append", lastIndex: 5 },
      { x: 96, y: 0 },
      project,
    );
    expect(hit?.name).toBe("east");
  });
});
