import { describe, expect, it } from "vitest";
import { isGapGlitch } from "./TrackRecorder";

describe("isGapGlitch", () => {
  // Reference scenario: real bad point from Track 2026-05-22 13_14.gpx (idx 2760).
  // Previous good fix at 21:07:49.752, vessel cruising ~4 kn.
  // Bad fix arrives 79 s later, 697 m from the previous point (17 kn implied).
  const prevLat = 42.351486;
  const prevLon = -71.023647;
  const prevT = Date.parse("2026-05-22T21:07:49.752Z");

  it("rejects the real-world 79s-gap 17kn glitch", () => {
    const badLat = 42.348331;
    const badLon = -71.030973;
    const badT = Date.parse("2026-05-22T21:09:08.743Z");
    expect(isGapGlitch(prevLat, prevLon, prevT, badLat, badLon, badT)).toBe(
      true,
    );
  });

  it("accepts the recovery fix that follows (long gap but plausible speed)", () => {
    // 155 s after prevT, vessel is back on track ~288 m away → ~3.6 kn.
    const goodLat = 42.353058;
    const goodLon = -71.026434;
    const goodT = prevT + 155_000;
    expect(isGapGlitch(prevLat, prevLon, prevT, goodLat, goodLon, goodT)).toBe(
      false,
    );
  });

  it("accepts a fast boat with short gap", () => {
    // Powerboat at 25 kn for 2 s = ~25.7 m. Same start, dt small.
    const fastLat = prevLat + 0.00023; // ~26 m N
    const fastT = prevT + 2_000;
    expect(isGapGlitch(prevLat, prevLon, prevT, fastLat, prevLon, fastT)).toBe(
      false,
    );
  });

  it("accepts a slow point even with a long gap", () => {
    // Long gap (60 s) but tiny distance (< 30 m).
    const slowLat = prevLat + 0.0001;
    const slowT = prevT + 60_000;
    expect(isGapGlitch(prevLat, prevLon, prevT, slowLat, prevLon, slowT)).toBe(
      false,
    );
  });
});
