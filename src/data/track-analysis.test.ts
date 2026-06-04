import { describe, expect, it } from "vitest";
import type { TrackPoint } from "./Track";
import {
  analyzeTrack,
  courseToColor,
  cursorAtFraction,
  cursorAtTime,
  detectManeuvers,
  detectStops,
  movingStats,
  STOP_MIN_MS,
  speedToColor,
  trackGradientStops,
} from "./track-analysis";

const T0 = Date.parse("2026-06-01T12:00:00Z");
const MIN = 60_000;

/** One nautical mile is one minute of latitude. */
const NM_LAT = 1 / 60;

function pt(overrides: Partial<TrackPoint>): TrackPoint {
  return {
    lat: 42,
    lon: -71,
    timestamp: T0,
    sog: null,
    cog: null,
    ...overrides,
  };
}

/** Straight northward run: one fix per minute, `speeds[i]` kn over leg i. */
function northwardTrack(speeds: number[]): TrackPoint[] {
  const points: TrackPoint[] = [pt({ sog: speeds[0] })];
  let lat = 42;
  for (let i = 0; i < speeds.length; i++) {
    lat += (speeds[i] / 60) * NM_LAT; // speed kn for one minute
    points.push(
      pt({
        lat,
        timestamp: T0 + (i + 1) * MIN,
        sog: speeds[Math.min(i + 1, speeds.length - 1)],
      }),
    );
  }
  return points;
}

describe("analyzeTrack", () => {
  it("returns null for fewer than two usable points", () => {
    expect(analyzeTrack([])).toBeNull();
    expect(analyzeTrack([pt({})])).toBeNull();
    expect(analyzeTrack([pt({}), pt({ dropped: true })])).toBeNull();
  });

  it("computes cumulative distance and duration", () => {
    const a = analyzeTrack(northwardTrack([6, 6, 6]));
    expect(a).not.toBeNull();
    if (!a) return;
    expect(a.totalNM).toBeCloseTo(0.3, 3); // 3 min at 6 kn
    expect(a.durationMs).toBe(3 * MIN);
    expect(a.hasTime).toBe(true);
    expect(a.avgSpeedKn).toBeCloseTo(6, 1);
  });

  it("excludes dropped points and sorts by time", () => {
    const pts = northwardTrack([6, 6]);
    pts.push(pt({ lat: 50, timestamp: T0 + 90_000, dropped: true })); // wild outlier
    const shuffled = [pts[2], pts[0], pts[3], pts[1]];
    const a = analyzeTrack(shuffled);
    if (!a) throw new Error("null analysis");
    expect(a.points).toHaveLength(3);
    expect(a.totalNM).toBeCloseTo(0.2, 3);
  });

  it("derives speed from fixes when sog is missing", () => {
    const pts = northwardTrack([6, 6]).map((p) => ({ ...p, sog: null }));
    const a = analyzeTrack(pts);
    if (!a) throw new Error("null analysis");
    expect(a.speedsKn[1]).toBeCloseTo(6, 1);
    expect(a.speedsKn[0]).toBeCloseTo(6, 1); // forward diff for first point
  });

  it("flags timestamp-less imports", () => {
    const pts = northwardTrack([6, 6]).map((p) => ({ ...p, timestamp: 0 }));
    const a = analyzeTrack(pts);
    if (!a) throw new Error("null analysis");
    expect(a.hasTime).toBe(false);
    expect(a.avgSpeedKn).toBe(0);
  });

  it("pads ramp bounds for near-constant speed", () => {
    const a = analyzeTrack(northwardTrack([5, 5, 5]));
    if (!a) throw new Error("null analysis");
    expect(a.rampMaxKn - a.rampMinKn).toBeGreaterThanOrEqual(1);
  });
});

describe("cursorAtTime / cursorAtFraction", () => {
  it("interpolates position, speed, and distance mid-leg", () => {
    const a = analyzeTrack(northwardTrack([4, 8]));
    if (!a) throw new Error("null analysis");
    const c = cursorAtTime(a, T0 + 0.5 * MIN); // halfway through leg 1
    expect(c.index).toBe(0);
    expect(c.lat).toBeCloseTo(42 + (4 / 60 / 2) * NM_LAT, 6);
    expect(c.sogKn).toBeCloseTo(6, 5); // lerp 4→8
    expect(c.distanceNM).toBeCloseTo((4 / 60) * 0.5, 4);
    expect(c.timestamp).toBe(T0 + 0.5 * MIN);
  });

  it("clamps outside the track's time range", () => {
    const a = analyzeTrack(northwardTrack([4, 8]));
    if (!a) throw new Error("null analysis");
    expect(cursorAtTime(a, T0 - MIN).timestamp).toBe(T0);
    expect(cursorAtTime(a, T0 + 99 * MIN).timestamp).toBe(a.endTime);
  });

  it("interpolates COG through the shortest arc, including north wrap", () => {
    const pts = [
      pt({ cog: 350, sog: 5 }),
      pt({ lat: 42.01, timestamp: T0 + MIN, cog: 10, sog: 5 }),
      pt({ lat: 42.02, timestamp: T0 + 2 * MIN, cog: 10, sog: 5 }),
    ];
    const a = analyzeTrack(pts);
    if (!a) throw new Error("null analysis");
    expect(cursorAtTime(a, T0 + 0.5 * MIN).cogDeg).toBeCloseTo(0, 5);
  });

  it("falls back to segment bearing when COG is missing", () => {
    const a = analyzeTrack(northwardTrack([6, 6]));
    if (!a) throw new Error("null analysis");
    // Northward track → bearing ≈ 0°
    expect(Math.abs(cursorAtTime(a, T0 + 30_000).cogDeg)).toBeLessThan(1);
  });

  it("scrubs by fraction of time, or of distance without timestamps", () => {
    const timed = analyzeTrack(northwardTrack([4, 8]));
    if (!timed) throw new Error("null analysis");
    expect(cursorAtFraction(timed, 0.5).timestamp).toBe(T0 + MIN);

    const untimed = analyzeTrack(
      northwardTrack([4, 8]).map((p) => ({ ...p, timestamp: 0, sog: null })),
    );
    if (!untimed) throw new Error("null analysis");
    const mid = cursorAtFraction(untimed, 0.5);
    expect(mid.distanceNM).toBeCloseTo(untimed.totalNM / 2, 5);
  });
});

describe("speedToColor", () => {
  it("clamps to the ramp ends and varies in between", () => {
    const slow = speedToColor(0, 2, 8);
    const fast = speedToColor(99, 2, 8);
    expect(slow).toBe(speedToColor(2, 2, 8));
    expect(fast).toBe(speedToColor(8, 2, 8));
    expect(slow).not.toBe(fast);
    expect(speedToColor(5, 2, 8)).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
  });
});

describe("trackGradientStops", () => {
  it("produces strictly ascending progress stops in [0, 1]", () => {
    const a = analyzeTrack(northwardTrack([2, 4, 6, 8, 6, 4, 2, 5, 7, 3]));
    if (!a) throw new Error("null analysis");
    const stops = trackGradientStops(a, "speed", 5);
    expect(stops.length).toBeGreaterThan(1);
    expect(stops.length).toBeLessThanOrEqual(6);
    for (let i = 0; i < stops.length; i++) {
      expect(stops[i][0]).toBeGreaterThanOrEqual(0);
      expect(stops[i][0]).toBeLessThanOrEqual(1);
      if (i > 0) expect(stops[i][0]).toBeGreaterThan(stops[i - 1][0]);
    }
  });

  it("skips co-located fixes that would repeat a progress value", () => {
    const pts = [
      pt({ sog: 3 }),
      pt({ timestamp: T0 + MIN, sog: 3 }), // same position
      pt({ lat: 42.1, timestamp: T0 + 2 * MIN, sog: 3 }),
    ];
    const a = analyzeTrack(pts);
    if (!a) throw new Error("null analysis");
    const stops = trackGradientStops(a, "speed", 100);
    for (let i = 1; i < stops.length; i++) {
      expect(stops[i][0]).toBeGreaterThan(stops[i - 1][0]);
    }
  });

  it("time mode runs the ramp from start color to end color", () => {
    const a = analyzeTrack(northwardTrack([5, 5, 5, 5, 5, 5, 5, 5]));
    if (!a) throw new Error("null analysis");
    const stops = trackGradientStops(a, "time", 100);
    expect(stops[0][1]).not.toBe(stops[stops.length - 1][1]);
  });
});

describe("courseToColor", () => {
  it("is cyclical and normalizes negatives", () => {
    expect(courseToColor(370)).toBe(courseToColor(10));
    expect(courseToColor(-90)).toBe(courseToColor(270));
    expect(courseToColor(0)).not.toBe(courseToColor(180));
  });
});

describe("detectStops / movingStats", () => {
  /** 6kn sail, then anchored (0.1kn) for `stopMin` minutes, then 6kn again. */
  function trackWithStop(stopMinutes: number): TrackPoint[] {
    const speeds = [6, 6, 6];
    for (let i = 0; i < stopMinutes; i++) speeds.push(0.1);
    speeds.push(6, 6, 6);
    return northwardTrack(speeds);
  }

  it("finds an anchored interval and excludes it from moving time", () => {
    const a = analyzeTrack(trackWithStop(10));
    if (!a) throw new Error("null analysis");
    const stops = detectStops(a);
    expect(stops).toHaveLength(1);
    expect(stops[0].durationMs).toBeGreaterThanOrEqual(STOP_MIN_MS);
    const { movingMs, avgMovingKn } = movingStats(a, stops);
    expect(movingMs).toBeLessThan(a.durationMs);
    expect(avgMovingKn).toBeGreaterThan(a.avgSpeedKn);
  });

  it("ignores brief lulls shorter than the minimum", () => {
    const a = analyzeTrack(trackWithStop(2));
    if (!a) throw new Error("null analysis");
    expect(detectStops(a)).toHaveLength(0);
  });

  it("returns nothing without timestamps", () => {
    const pts = trackWithStop(10).map((p) => ({ ...p, timestamp: 0 }));
    const a = analyzeTrack(pts);
    if (!a) throw new Error("null analysis");
    expect(detectStops(a)).toHaveLength(0);
  });
});

describe("detectManeuvers", () => {
  /** Constant 5kn with given COG per 10-second fix, positions on a line. */
  function trackWithCourses(cogs: number[]): TrackPoint[] {
    return cogs.map((cog, i) =>
      pt({ lat: 42 + i * 0.001, timestamp: T0 + i * 10_000, sog: 5, cog }),
    );
  }

  it("finds a tack-sized course change once", () => {
    const m = (() => {
      const a = analyzeTrack(
        trackWithCourses([30, 30, 30, 30, 110, 110, 110, 110]),
      );
      if (!a) throw new Error("null analysis");
      return detectManeuvers(a);
    })();
    expect(m).toHaveLength(1);
    expect(m[0].turnDeg).toBeCloseTo(80, 0);
  });

  it("ignores small course wander", () => {
    const a = analyzeTrack(trackWithCourses([30, 40, 35, 45, 30, 38, 42, 33]));
    if (!a) throw new Error("null analysis");
    expect(detectManeuvers(a)).toHaveLength(0);
  });

  it("ignores swings while drifting below the speed gate", () => {
    const pts = trackWithCourses([30, 30, 30, 110, 110, 110]).map((p) => ({
      ...p,
      sog: 0.2,
    }));
    const a = analyzeTrack(pts);
    if (!a) throw new Error("null analysis");
    expect(detectManeuvers(a)).toHaveLength(0);
  });
});
