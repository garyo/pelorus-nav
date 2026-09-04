/**
 * Random route-join scenarios, shared by the randomised unit tests
 * (route-join.test.ts) and `bun tools/route-join-scenarios.ts`, which
 * prints them for review.
 */

import type { Route } from "../data/Route";
import {
  bearingDelta,
  haversineDistanceNM,
  initialBearingDeg,
} from "../utils/coordinates";
import { DEFAULT_CONE_HALF_ANGLE_DEG, distanceToLegNM } from "./route-join";

/** Deterministic PRNG (mulberry32) so a failing seed can be replayed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Scenario {
  route: Route;
  fix: { lat: number; lon: number; cog: number | null };
}

/**
 * A random route of 3–7 waypoints in a 30 NM box near the equator, and a
 * vessel dropped in or around it — stationary about one time in seven.
 */
export function randomScenario(rand: () => number): Scenario {
  const count = 3 + Math.floor(rand() * 5);
  const waypoints = [];
  for (let i = 0; i < count; i++) {
    waypoints.push({ lat: rand() * 0.5, lon: rand() * 0.5, name: `WP${i}` });
  }
  const cog = rand() < 0.15 ? null : Math.floor(rand() * 360);
  return {
    route: {
      id: "r",
      name: "Random",
      createdAt: 0,
      color: "#000",
      visible: true,
      waypoints,
    },
    fix: { lat: rand() * 0.7 - 0.1, lon: rand() * 0.7 - 0.1, cog },
  };
}

export interface LegDescription {
  leg: number;
  distToDest: number;
  brgToDest: number;
  /** Distance from the leg segment (for leg 0, from its waypoint). */
  xtd: number;
  /** Destination within the forward cone of the course; null when stationary. */
  inCone: boolean | null;
}

/** Brute-force restatement of the rule's per-leg numbers, for cross-checking. */
export function describeLegs(s: Scenario): LegDescription[] {
  const { waypoints } = s.route;
  const { lat, lon, cog } = s.fix;
  return waypoints.map((wp, i) => {
    const distToDest = haversineDistanceNM(lat, lon, wp.lat, wp.lon);
    const brgToDest = initialBearingDeg(lat, lon, wp.lat, wp.lon);
    const from = i === 0 ? null : waypoints[i - 1];
    const xtd = from ? distanceToLegNM(lat, lon, from, wp) : distToDest;
    const inCone =
      cog === null
        ? null
        : Math.abs(bearingDelta(brgToDest, cog)) <= DEFAULT_CONE_HALF_ANGLE_DEG;
    return { leg: i, distToDest, brgToDest, xtd, inCone };
  });
}
