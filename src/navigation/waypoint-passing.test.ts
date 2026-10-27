import { describe, expect, it } from "vitest";
import { initialBearingDeg, projectPoint } from "../utils/coordinates";
import { type LatLon, waypointPassNM } from "./waypoint-passing";

const WP: LatLon = { lat: 42.36, lon: -71.05 };

/** A point `north` and `east` NM from the waypoint. */
function at(north: number, east: number): LatLon {
  const lat = WP.lat + north / 60;
  return { lat, lon: WP.lon + east / (60 * Math.cos((lat * Math.PI) / 180)) };
}

/** A point `distNM` from the waypoint on bearing `brgDeg`. */
function toward(brgDeg: number, distNM: number): LatLon {
  const [lon, lat] = projectPoint(WP.lat, WP.lon, brgDeg, distNM);
  return { lat, lon };
}

function passes(
  vessel: LatLon,
  cog: number | null,
  prev: LatLon | null,
  next: LatLon | null,
): boolean {
  return waypointPassNM(vessel.lat, vessel.lon, cog, prev, WP, next) >= 0;
}

/** Course from `from` straight for `to`. */
const course = (from: LatLon, to: LatLon) =>
  initialBearingDeg(from.lat, from.lon, to.lat, to.lon);

describe("waypointPassNM", () => {
  describe("abeam", () => {
    const prev = at(0, -1);
    const next = at(0, 1);

    it("passes once the waypoint is abeam, with or without a course", () => {
      expect(passes(at(0, -0.01), null, prev, next)).toBe(false);
      expect(passes(at(0, 0.01), null, prev, next)).toBe(true);
      expect(passes(at(0.5, 0.01), 90, prev, next)).toBe(true);
      expect(passes(at(-0.5, 0.01), 0, prev, next)).toBe(true);
    });

    it("measures the distance beyond the line", () => {
      const beyond = (n: number, e: number) => {
        const v = at(n, e);
        return waypointPassNM(v.lat, v.lon, null, prev, WP, next);
      };
      expect(beyond(0.2, 0.3)).toBeCloseTo(0.3, 3);
      expect(beyond(0.2, -0.3)).toBeCloseTo(-0.3, 3);
    });
  });

  describe("a right-angle turn (north, then east)", () => {
    const prev = at(-1, 0);
    const next = at(0, 1);

    it("passes a vessel inside the turn once the waypoint is abaft the beam", () => {
      // 0.12 NM short of abeam, twice that inside: nearer the next leg.
      const v = at(-0.12, 0.24);
      expect(passes(v, 0, prev, next)).toBe(false); // waypoint 63° off the bow
      expect(passes(v, course(v, next), prev, next)).toBe(true);
      expect(passes(v, null, prev, next)).toBe(false);
    });

    it("keeps the waypoint astern of a vessel still nearer the arriving leg", () => {
      expect(passes(at(-0.24, 0.12), 90, prev, next)).toBe(false);
    });

    it("keeps a waypoint the vessel heads for, however near the next leg", () => {
      // Run up the arriving leg far off its line, as after overshooting the
      // previous waypoint: across the bisector, bow on to the waypoint.
      const v = at(-0.2, 0.4);
      expect(passes(v, course(v, WP), prev, next)).toBe(false);
    });
  });

  it("passes the waypoint in the field report: inside a turn, abaft the beam", () => {
    // 2026-10-27, Boston Inner Harbor, from the report's screenshot (NM to
    // an arbitrary scale): the route turns ~65° to starboard; the vessel ran
    // up its inside heading north, short of abeam with the waypoint abaft
    // its port beam.
    const prev = at(-0.33, 0.08);
    const next = at(0.237, 0.195);
    const vessel = at(0.055, 0.26);
    expect(passes(vessel, null, prev, next)).toBe(false);
    expect(passes(vessel, 0, prev, next)).toBe(true);
  });

  describe("a hairpin (out east, back west)", () => {
    const prev = at(0, -6);
    const next = at(0.6, -6);

    it("keeps the mark while approaching it, inside or out", () => {
      for (const v of [at(0.06, -0.3), at(-0.06, -0.3), at(0.06, -0.03)]) {
        expect(passes(v, 90, prev, next)).toBe(false);
      }
    });

    it("passes a mark cut short once turned back on the inside", () => {
      const v = at(0.06, -0.3);
      expect(passes(v, course(v, next), prev, next)).toBe(true);
    });
  });

  describe("an out-and-back (the route turns straight back)", () => {
    const prev = at(0, -2);
    const next = prev;

    it("passes the turn on turning back short of it, on either side", () => {
      expect(passes(at(0.05, -0.3), 270, prev, next)).toBe(true);
      expect(passes(at(-0.05, -0.3), 270, prev, next)).toBe(true);
      expect(passes(at(0.05, -0.3), 90, prev, next)).toBe(false);
    });

    it("keeps the turn while leaving the start headed away from it", () => {
      expect(passes(at(0, -2.1), 270, prev, next)).toBe(false);
      expect(passes(at(0.02, -1.8), 270, prev, next)).toBe(false);
    });
  });

  it("never passes from the previous waypoint headed for this one", () => {
    for (let turn = -180; turn <= 180; turn += 5) {
      const prev = toward(180, 1);
      const next = toward(turn, 1);
      expect(passes(prev, 0, prev, next)).toBe(false);
    }
  });

  it("passes on reaching the next waypoint headed onward", () => {
    // Beyond ±135° the next waypoint lies back in the arriving leg's first
    // quarter, where the turn no longer counts (see TURN_MIN_PROGRESS).
    for (let turn = -135; turn <= 135; turn += 5) {
      const prev = toward(180, 1);
      const next = toward(turn, 1);
      expect(passes(next, turn, prev, next)).toBe(true);
    }
  });

  it("uses the line square to the leaving leg at a route's first waypoint", () => {
    const next = at(0, 1);
    expect(passes(at(0.5, 0.01), null, null, next)).toBe(true);
    expect(passes(at(0.5, -0.01), 90, null, next)).toBe(false);
  });

  it("uses only the abeam line at a route's last waypoint", () => {
    const prev = at(-1, 0);
    expect(passes(at(-0.01, 0.5), 180, prev, null)).toBe(false);
    expect(passes(at(0.01, 0.5), 0, prev, null)).toBe(true);
  });

  it("never passes a lone waypoint", () => {
    const v = at(5, 5);
    expect(waypointPassNM(v.lat, v.lon, 0, null, WP, null)).toBe(
      Number.NEGATIVE_INFINITY,
    );
  });
});
