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

  it("never rejects once a fix was already rejected against this anchor", () => {
    // Cascade guard: the second displaced fix after a rejection is real
    // movement (a true glitch snaps back within one fix), so accept it.
    const farLat = prevLat + 0.005; // ~550 m N
    const farT = prevT + 60_000; // 60 s gap, ~18 kn implied
    expect(isGapGlitch(prevLat, prevLon, prevT, farLat, prevLon, farT)).toBe(
      true,
    );
    // Same geometry, but we already rejected one fix against this anchor.
    expect(
      isGapGlitch(prevLat, prevLon, prevT, farLat, prevLon, farT, true),
    ).toBe(false);
  });
});

/**
 * Mirrors TrackRecorder.onNavData's accept/reject + anchor handling so we can
 * test the cascade behaviour without a DB or NavigationDataManager. Returns
 * the fixes that would be recorded. `guard` toggles the reject-at-most-one
 * cascade protection (false reproduces the pre-fix behaviour).
 */
function runRecorder(
  fixes: { lat: number; lon: number; t: number }[],
  guard: boolean,
): { lat: number; lon: number; t: number }[] {
  let anchor: { lat: number; lon: number; t: number } | null = null;
  let rejectedSinceAccept = false;
  const kept: { lat: number; lon: number; t: number }[] = [];
  for (const f of fixes) {
    if (anchor) {
      const already = guard ? rejectedSinceAccept : false;
      if (
        isGapGlitch(
          anchor.lat,
          anchor.lon,
          anchor.t,
          f.lat,
          f.lon,
          f.t,
          already,
        )
      ) {
        rejectedSinceAccept = true;
        continue;
      }
      rejectedSinceAccept = false;
    }
    kept.push(f);
    anchor = f;
  }
  return kept;
}

describe("gap-glitch cascade on a fast vessel", () => {
  // A 30 kn ferry heading due north, sampled in passive mode: mostly 18 s
  // spacing, but a dropped network fix opens a >30 s gap every ~12 fixes.
  // Every gap implies >15 kn, so the single-point detector flags it.
  const KN = 30;
  const startLat = 42.3;
  const lon = -71.0;
  const startT = Date.parse("2026-06-09T16:32:00.000Z");
  const degPerSec = KN / 3600 / 60; // 30 nm/h → deg latitude per second

  const fixes: { lat: number; lon: number; t: number }[] = [];
  let tSec = 0;
  for (let i = 0; i < 80; i++) {
    tSec += i % 12 === 11 ? 60 : 18; // periodic >30 s gap
    fixes.push({
      lat: startLat + degPerSec * tSec,
      lon,
      t: startT + tSec * 1000,
    });
  }

  it("pre-fix behaviour cascades: the track dies at the first gap", () => {
    const kept = runRecorder(fixes, false);
    // Records only up to the first >30 s gap, then every fix is mis-flagged.
    expect(kept.length).toBeLessThan(fixes.length * 0.3);
    // The last recorded fix is near the start, not the end of the trip.
    expect(kept[kept.length - 1].t).toBeLessThan(startT + 12 * 60 * 1000);
  });

  it("with the cascade guard the full trip is recorded (≤1 lost per gap)", () => {
    const kept = runRecorder(fixes, true);
    expect(kept.length).toBeGreaterThan(fixes.length * 0.9);
    // The track now reaches the end of the trip.
    expect(kept[kept.length - 1].t).toBe(fixes[fixes.length - 1].t);
  });
});
