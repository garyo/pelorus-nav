import { describe, expect, it } from "vitest";
import type { Route, Waypoint } from "../data/Route";
import { initialBearingDeg } from "../utils/coordinates";
import {
  DEFAULT_CONE_HALF_ANGLE_DEG,
  distanceToLegNM,
  pickJoinLeg,
  suggestReverse,
} from "./route-join";
import {
  describeLegs,
  mulberry32,
  randomScenario,
} from "./route-join-scenarios";

// Routes along the equator: 1° of longitude is 60 NM, so distances read
// straight off the coordinates.
function route(waypoints: [number, number][]): Route {
  return {
    id: "r",
    name: "Test",
    createdAt: 0,
    color: "#000",
    visible: true,
    waypoints: waypoints.map(([lat, lon], i) => ({ lat, lon, name: `WP${i}` })),
  };
}

const opts = { arrivalRadiusNM: 0.1 };
const fix = (lat: number, lon: number, cog: number | null) => ({
  lat,
  lon,
  cog,
});

describe("pickJoinLeg — the original start-of-route cases", () => {
  const twoLegs = route([
    [0, 0],
    [0, 1],
  ]);

  it("targets waypoint[0] when the vessel is still short of it", () => {
    expect(pickJoinLeg(fix(0, -0.5, 90), twoLegs, opts).legIndex).toBe(0);
    expect(pickJoinLeg(fix(0, -0.5, null), twoLegs, opts).legIndex).toBe(0);
  });

  it("starts at leg 1 once the vessel has passed waypoint[0]", () => {
    expect(pickJoinLeg(fix(0, 0.5, 90), twoLegs, opts)).toEqual({
      legIndex: 1,
      reason: "ahead",
    });
    expect(pickJoinLeg(fix(0, 0.5, null), twoLegs, opts)).toEqual({
      legIndex: 1,
      reason: "nearest",
    });
  });

  it("starts at leg 1 when the vessel is within waypoint[0]'s arrival radius", () => {
    expect(pickJoinLeg(fix(0, -0.0001, null), twoLegs, opts).legIndex).toBe(1);
  });

  it("defaults to leg 1 for a degenerate single-waypoint route", () => {
    expect(pickJoinLeg(fix(0, -0.5, 90), route([[0, 0]]), opts).legIndex).toBe(
      1,
    );
  });
});

describe("pickJoinLeg — joining a route mid-way", () => {
  // Four waypoints due east, 60 NM apart.
  const straight = route([
    [0, 0],
    [0, 1],
    [0, 2],
    [0, 3],
  ]);

  it("picks the leg abeam of the vessel, not the second waypoint (the reported bug)", () => {
    // 0.2 NM north of leg 3, sailing east.
    const choice = pickJoinLeg(fix(0.0033, 2.5, 90), straight, opts);
    expect(choice).toEqual({ legIndex: 3, reason: "ahead" });
  });

  it("takes the nearest leg when stationary", () => {
    expect(pickJoinLeg(fix(0.0033, 2.5, null), straight, opts)).toEqual({
      legIndex: 3,
      reason: "nearest",
    });
  });

  it("sailing the route backwards steers for the waypoint ahead, and suggests reversing", () => {
    // Between WP2 and WP3 heading west: WP3 is astern, WP2 is dead ahead
    // (beyond its own leg's end, but that perpendicular only counts when
    // the vessel is on that leg).
    expect(pickJoinLeg(fix(0, 2.5, 270), straight, opts)).toEqual({
      legIndex: 2,
      reason: "ahead-far",
    });
    expect(suggestReverse(fix(0, 2.5, 270), straight, opts)).toBe(true);
  });

  it("well off the route, picks the destination the course points at", () => {
    // 10 NM south of the route, heading north-east toward WP3.
    const brg = initialBearingDeg(-0.1667, 2.6, 0, 3);
    const choice = pickJoinLeg(fix(-0.1667, 2.6, brg), straight, opts);
    expect(choice).toEqual({ legIndex: 3, reason: "ahead-far" });
  });

  it("past the last waypoint's perpendicular with the course away, never returns out of range", () => {
    const choice = pickJoinLeg(fix(0, 3.5, 90), straight, opts);
    expect(choice.legIndex).toBe(3);
    expect(choice.reason).toBe("nearest");
  });

  it("treats the cone edge inclusively", () => {
    const cone = DEFAULT_CONE_HALF_ANGLE_DEG;
    // On leg 1's track; WP1 bears 090.
    expect(pickJoinLeg(fix(0, 0.5, 90 + cone), straight, opts).reason).toBe(
      "ahead",
    );
    expect(
      pickJoinLeg(fix(0, 0.5, 90 + cone + 1), straight, opts).reason,
    ).not.toBe("ahead");
  });

  it("works across the antimeridian at high latitude", () => {
    const polar = route([
      [60, 179.5],
      [60, -179.5],
      [60, -178.5],
    ]);
    // Just east of the dateline on leg 1, heading east.
    expect(pickJoinLeg(fix(60, -179.8, 90), polar, opts)).toEqual({
      legIndex: 1,
      reason: "ahead",
    });
  });
});

describe("pickJoinLeg — a route that doubles back", () => {
  // W0 (0,0) → W1 (0,1) → W2 (0.1,0): the return leg runs west, 3–6 NM
  // north of the outbound leg.
  const outAndBack = route([
    [0, 0],
    [0, 1],
    [0.1, 0],
  ]);

  it("on the return leg heading west, targets W2 rather than the nearer outbound leg", () => {
    expect(pickJoinLeg(fix(0.05, 0.5, 270), outAndBack, opts)).toEqual({
      legIndex: 2,
      reason: "ahead",
    });
  });

  it("at the turnaround waypoint, tie-breaks to the leg aligned with the course", () => {
    // Within W1's arrival radius, already heading west for home.
    expect(pickJoinLeg(fix(0, 1, 270), outAndBack, opts).legIndex).toBe(2);
  });

  it("outbound heading east targets W1", () => {
    expect(pickJoinLeg(fix(0, 0.5, 90), outAndBack, opts).legIndex).toBe(1);
  });
});

// Gary's review of the random scenario plots (seed 20260904, 2026-09-05):
// the cases he called, replayed exactly from the generator.
describe("pickJoinLeg — reviewed random scenarios", () => {
  const rand = mulberry32(20260904);
  const scenarios = Array.from({ length: 24 }, () => randomScenario(rand));
  const pick = (n: number) => {
    const s = scenarios[n - 1];
    return pickJoinLeg(s.fix, s.route, opts).legIndex;
  };

  it("#4: level with WP1 and heading along leg 2, takes leg 2 rather than the leg arriving at WP1", () => {
    expect(pick(4)).toBe(2);
  });

  it("#6: well past WP1 in leg 1's direction and heading roughly along leg 2, takes leg 2", () => {
    expect(pick(6)).toBe(2);
  });

  it("#8: stationary 4 NM from WP0, approaches WP0 rather than a far leg", () => {
    expect(pick(8)).toBe(0);
  });

  it("#10: stationary 2.5 NM off leg 5, takes leg 5", () => {
    expect(pick(10)).toBe(5);
  });
});

describe("suggestReverse", () => {
  const straight = route([
    [0, 0],
    [0, 1],
    [0, 2],
  ]);

  it("suggests reversing when the course runs along the route backwards", () => {
    expect(suggestReverse(fix(0, 1.5, 270), straight, opts)).toBe(true);
  });

  it("does not suggest it when the course runs with the route", () => {
    expect(suggestReverse(fix(0, 1.5, 90), straight, opts)).toBe(false);
  });

  it("never suggests it without a course, or away from the route", () => {
    expect(suggestReverse(fix(0, 1.5, null), straight, opts)).toBe(false);
    expect(suggestReverse(fix(1, 1.5, 270), straight, opts)).toBe(false);
  });
});

describe("distanceToLegNM", () => {
  const from: Waypoint = { lat: 0, lon: 0, name: "a" };
  const to: Waypoint = { lat: 0, lon: 1, name: "b" };

  it("is the cross-track distance abeam of the leg", () => {
    expect(distanceToLegNM(0.01, 0.5, from, to)).toBeCloseTo(0.6, 1);
  });

  it("is the distance to the nearer endpoint beyond either end", () => {
    expect(distanceToLegNM(0, -0.5, from, to)).toBeCloseTo(30, 0);
    expect(distanceToLegNM(0, 1.5, from, to)).toBeCloseTo(30, 0);
  });

  it("does not blow up for a point sitting on the start waypoint", () => {
    expect(distanceToLegNM(0, 0, from, to)).toBe(0);
  });
});

// ── Randomised scenarios ────────────────────────────────────────────────
//
// Waypoints scattered in a 30 NM box, a vessel dropped anywhere in and
// around it with a random course: the chosen leg must satisfy the rule's
// own promises, checked here by brute force against describeLegs().
// `bun tools/route-join-scenarios.ts` prints the same scenarios for eyeballing.

describe("pickJoinLeg — randomised invariants", () => {
  const rand = mulberry32(20260904);
  const scenarios = Array.from({ length: 400 }, () => randomScenario(rand));
  /** Near-equal cross-track distances are a tie the rule may break either way. */
  const slack = (xtd: number) => Math.max(0.05, 0.1 * xtd) + 1e-9;

  it("always returns a leg of the route", () => {
    for (const s of scenarios) {
      const { legIndex } = pickJoinLeg(s.fix, s.route, opts);
      expect(legIndex).toBeGreaterThanOrEqual(0);
      expect(legIndex).toBeLessThan(s.route.waypoints.length);
    }
  });

  it("under way, an 'ahead' choice is the nearest unpassed leg whose destination is in the cone", () => {
    for (const s of scenarios) {
      const choice = pickJoinLeg(s.fix, s.route, opts);
      if (choice.reason !== "ahead" && choice.reason !== "ahead-far") continue;
      const legs = describeLegs(s);
      const chosen = legs[choice.legIndex];
      expect(chosen.inCone).toBe(true);
      expect(chosen.passed).toBe(false);
      const eligible = legs.filter((l) => l.inCone && !l.passed);
      const nearest = Math.min(...eligible.map((l) => l.xtd));
      expect(chosen.xtd).toBeLessThanOrEqual(nearest + slack(chosen.xtd));
    }
  });

  it("a 'nearest' choice is the nearest unpassed leg, and only when nothing lies ahead", () => {
    for (const s of scenarios) {
      const choice = pickJoinLeg(s.fix, s.route, opts);
      if (choice.reason !== "nearest") continue;
      const legs = describeLegs(s);
      // Nothing was ahead (or the vessel is stationary)…
      if (s.fix.cog !== null) {
        expect(legs.some((l) => l.inCone && !l.passed)).toBe(false);
      }
      // …and the pick is the nearest leg not yet passed, if any is left.
      const unpassed = legs.filter((l) => !l.passed);
      if (unpassed.length === 0) {
        expect(choice.legIndex).toBe(s.route.waypoints.length - 1);
        continue;
      }
      const chosen = legs[choice.legIndex];
      expect(chosen.passed).toBe(false);
      const nearest = Math.min(...unpassed.map((l) => l.xtd));
      expect(chosen.xtd).toBeLessThanOrEqual(nearest + slack(chosen.xtd));
    }
  });
});
