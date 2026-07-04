import { describe, expect, it } from "vitest";
import type { TrackPoint } from "../data/Track";
import { capDisplayPoints } from "./TrackLayer";

function point(lat: number, lon: number, timestamp: number): TrackPoint {
  return { lat, lon, timestamp, sog: null, cog: null };
}

describe("capDisplayPoints", () => {
  it("maps stored points to display points in order", () => {
    const points = [point(42.0, -71.0, 1000), point(42.1, -71.1, 2000)];
    expect(capDisplayPoints(points, 10)).toEqual([
      { lat: 42.0, lon: -71.0, timestamp: 1000 },
      { lat: 42.1, lon: -71.1, timestamp: 2000 },
    ]);
  });

  it("filters out points flagged dropped by the RTS post-processor", () => {
    const points = [
      point(42.0, -71.0, 1000),
      { ...point(42.5, -71.5, 1500), dropped: true },
      point(42.1, -71.1, 2000),
    ];
    const result = capDisplayPoints(points, 10);
    expect(result).toHaveLength(2);
    expect(result.map((p) => p.timestamp)).toEqual([1000, 2000]);
  });

  it("caps to the most recent `max` points — resuming a long recording never exceeds the display cap", () => {
    const points = Array.from({ length: 100 }, (_, i) =>
      point(42, -71, i * 1000),
    );
    const result = capDisplayPoints(points, 10);
    expect(result).toHaveLength(10);
    // Keeps the most recent points, not the oldest.
    expect(result[0].timestamp).toBe(90 * 1000);
    expect(result[9].timestamp).toBe(99 * 1000);
  });

  it("returns an empty buffer for an empty or all-dropped track", () => {
    expect(capDisplayPoints([], 10)).toEqual([]);
    expect(
      capDisplayPoints([{ ...point(42, -71, 1000), dropped: true }], 10),
    ).toEqual([]);
  });
});
