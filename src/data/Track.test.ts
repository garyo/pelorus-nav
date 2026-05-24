import { describe, expect, it } from "vitest";
import {
  computeTrackAggregates,
  isTrivialTrack,
  type TrackMeta,
  type TrackPoint,
} from "./Track";

function meta(over: Partial<TrackMeta> = {}): TrackMeta {
  return {
    id: "t1",
    name: "Test",
    createdAt: 0,
    color: "#fff",
    visible: true,
    pointCount: 10,
    ...over,
  };
}

describe("isTrivialTrack", () => {
  it("flags a track with too few points (no aggregates needed)", () => {
    expect(isTrivialTrack(meta({ pointCount: 0 }))).toBe(true);
    expect(isTrivialTrack(meta({ pointCount: 1 }))).toBe(true);
    expect(isTrivialTrack(meta({ pointCount: 2 }))).toBe(true);
  });

  it("doesn't flag a track that meets minimum points (aggregates absent)", () => {
    // 3 points, no cached aggregates — can't tell yet, give it the benefit
    // of the doubt (cleanup will re-check after lazy fill).
    expect(isTrivialTrack(meta({ pointCount: 3 }))).toBe(false);
  });

  it("flags a track with cached short duration", () => {
    expect(
      isTrivialTrack(
        meta({ pointCount: 10, durationMs: 2_000, totalDistanceNM: 0.1 }),
      ),
    ).toBe(true);
  });

  it("flags a track with cached tiny distance", () => {
    expect(
      isTrivialTrack(
        meta({ pointCount: 10, durationMs: 60_000, totalDistanceNM: 0.001 }),
      ),
    ).toBe(true);
  });

  it("keeps a normal short test track (30 s, ~0.05 nm)", () => {
    expect(
      isTrivialTrack(
        meta({ pointCount: 30, durationMs: 30_000, totalDistanceNM: 0.05 }),
      ),
    ).toBe(false);
  });
});

describe("computeTrackAggregates", () => {
  function pt(over: Partial<TrackPoint>): TrackPoint {
    return {
      lat: 42.0,
      lon: -71.0,
      timestamp: 0,
      sog: null,
      cog: null,
      ...over,
    };
  }

  it("returns zeros for empty input", () => {
    expect(computeTrackAggregates([])).toEqual({
      durationMs: 0,
      totalDistanceNM: 0,
    });
  });

  it("computes duration from first→last timestamp", () => {
    const r = computeTrackAggregates([
      pt({ timestamp: 1000 }),
      pt({ timestamp: 6000 }),
    ]);
    expect(r.durationMs).toBe(5000);
  });

  it("sums haversine segments along the track", () => {
    // 1 degree of latitude ≈ 60 NM
    const r = computeTrackAggregates([
      pt({ lat: 42.0, lon: -71.0, timestamp: 0 }),
      pt({ lat: 42.01, lon: -71.0, timestamp: 1000 }),
      pt({ lat: 42.02, lon: -71.0, timestamp: 2000 }),
    ]);
    // Two segments of 0.01° lat each ≈ 0.6 NM each ≈ 1.2 NM total
    expect(r.totalDistanceNM).toBeCloseTo(1.2, 2);
  });

  it("skips dropped outliers when summing distance", () => {
    const r = computeTrackAggregates([
      pt({ lat: 42.0, lon: -71.0, timestamp: 0 }),
      pt({ lat: 42.5, lon: -71.0, timestamp: 1000, dropped: true }),
      pt({ lat: 42.01, lon: -71.0, timestamp: 2000 }),
    ]);
    // Without skipping, the haversine jumps would add ~60 NM. With
    // skip, the segment is 0.0→0.01 ≈ 0.6 NM.
    expect(r.totalDistanceNM).toBeCloseTo(0.6, 2);
    // Duration still spans first→last regardless of dropped flag.
    expect(r.durationMs).toBe(2000);
  });
});
