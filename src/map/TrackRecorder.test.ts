import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appendTrackPoint } from "../data/db";
import { appErrorLog } from "../diagnostics/errorLog";
import type { NavigationData } from "../navigation/NavigationData";
import type { NavigationDataManager } from "../navigation/NavigationDataManager";
import { isGapGlitch, TrackRecorder } from "./TrackRecorder";

vi.mock("../data/db", () => ({
  appendTrackPoint: vi.fn().mockResolvedValue(undefined),
  saveTrackMeta: vi.fn().mockResolvedValue(undefined),
  deleteTrack: vi.fn().mockResolvedValue(undefined),
  getTrackPoints: vi.fn().mockResolvedValue([]),
  replaceTrackPoints: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../diagnostics/errorLog", () => ({
  appErrorLog: { log: vi.fn() },
  formatErrorDetail: (reason: unknown) => String(reason),
}));

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

/** Minimal fake standing in for NavigationDataManager's subscribe/unsubscribe. */
class FakeNavManager {
  private cb: ((data: NavigationData) => void) | null = null;
  subscribe(cb: (data: NavigationData) => void): void {
    this.cb = cb;
  }
  unsubscribe(): void {
    this.cb = null;
  }
  feed(data: NavigationData): void {
    this.cb?.(data);
  }
}

function fix(lat: number, lon: number, t: number): NavigationData {
  return {
    latitude: lat,
    longitude: lon,
    cog: null,
    sog: null,
    heading: null,
    accuracy: null,
    timestamp: t,
    source: "test",
  };
}

describe("TrackRecorder gap-split distance", () => {
  const fakeStorage = new Map<string, string>();

  beforeEach(() => {
    fakeStorage.clear();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => fakeStorage.get(k) ?? null,
      setItem: (k: string, v: string) => {
        fakeStorage.set(k, v);
      },
      removeItem: (k: string) => {
        fakeStorage.delete(k);
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts the new track at 0 distance instead of charging it the gap-jump", async () => {
    const nav = new FakeNavManager();
    const recorder = new TrackRecorder(nav as unknown as NavigationDataManager);
    recorder.start();
    // No saved active track, so tryResumeTrack resolves on its first check.
    await Promise.resolve();
    await Promise.resolve();

    const t0 = Date.parse("2026-07-01T12:00:00.000Z");
    nav.feed(fix(42.0, -71.0, t0));
    await Promise.resolve();
    await Promise.resolve();

    // 40 min later, ~1.8 nm away — a low implied speed (~2.7 kn), so this
    // isn't flagged as a gap-glitch, but it's well past GAP_THRESHOLD_MS
    // (30 min) and splits off a new track.
    const t1 = t0 + 40 * 60 * 1000;
    nav.feed(fix(42.03, -71.0, t1));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const track = recorder.getCurrentTrack();
    expect(track).not.toBeNull();
    expect(track?.totalDistanceNM).toBe(0);
  });
});

describe("TrackRecorder save-failure handling", () => {
  const fakeStorage = new Map<string, string>();
  /** Flush the microtask queue so an in-flight onNavData settles. */
  const settle = () => new Promise<void>((r) => setTimeout(r, 0));
  const t0 = Date.parse("2026-07-01T12:00:00.000Z");

  beforeEach(() => {
    fakeStorage.clear();
    vi.mocked(appendTrackPoint).mockReset().mockResolvedValue(undefined);
    vi.mocked(appErrorLog.log).mockClear();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => fakeStorage.get(k) ?? null,
      setItem: (k: string, v: string) => {
        fakeStorage.set(k, v);
      },
      removeItem: (k: string) => {
        fakeStorage.delete(k);
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function startRecorder(): Promise<{
    nav: FakeNavManager;
    recorder: TrackRecorder;
  }> {
    const nav = new FakeNavManager();
    const recorder = new TrackRecorder(nav as unknown as NavigationDataManager);
    recorder.start();
    await settle();
    return { nav, recorder };
  }

  it("latches the error state on append failure and logs once, not per point", async () => {
    const { nav, recorder } = await startRecorder();
    vi.mocked(appendTrackPoint).mockRejectedValue(new Error("quota exceeded"));

    nav.feed(fix(42.0, -71.0, t0));
    await settle();
    expect(recorder.isSaveFailing()).toBe(true);
    expect(appErrorLog.log).toHaveBeenCalledTimes(1);
    expect(appErrorLog.log).toHaveBeenCalledWith(
      "track-recorder",
      "error",
      expect.stringContaining("quota exceeded"),
    );

    // Further failing points don't add log entries — the latch holds.
    nav.feed(fix(42.001, -71.0, t0 + 10_000));
    nav.feed(fix(42.002, -71.0, t0 + 20_000));
    await settle();
    expect(recorder.isSaveFailing()).toBe(true);
    expect(appErrorLog.log).toHaveBeenCalledTimes(1);
  });

  it("does not advance the anchor or aggregates on a failed append", async () => {
    const { nav, recorder } = await startRecorder();

    // First point lands normally, establishing the anchor.
    nav.feed(fix(42.0, -71.0, t0));
    await settle();
    expect(recorder.getCurrentTrack()?.pointCount).toBe(1);

    // Next point fails to save: pointCount and distance must not move.
    vi.mocked(appendTrackPoint).mockRejectedValue(new Error("quota exceeded"));
    nav.feed(fix(42.001, -71.0, t0 + 10_000)); // ~111 m north
    await settle();
    const track = recorder.getCurrentTrack();
    expect(track?.pointCount).toBe(1);
    expect(track?.totalDistanceNM).toBe(0);
    expect(track?.durationMs).toBe(0);

    // Recovery: the next fix is measured against the last STORED point
    // (42.0), not the lost one — the full segment distance is preserved.
    vi.mocked(appendTrackPoint).mockResolvedValue(undefined);
    nav.feed(fix(42.002, -71.0, t0 + 20_000)); // ~222 m from the stored point
    await settle();
    const after = recorder.getCurrentTrack();
    expect(after?.pointCount).toBe(2);
    expect(after?.totalDistanceNM ?? 0).toBeCloseTo(0.12, 2); // ~222 m in NM
  });

  it("clears the error state (and notifies) on the next successful save", async () => {
    const { nav, recorder } = await startRecorder();
    let notifiedFailing: boolean | null = null;
    recorder.onRecordingChange(() => {
      notifiedFailing = recorder.isSaveFailing();
    });

    vi.mocked(appendTrackPoint).mockRejectedValue(new Error("quota exceeded"));
    nav.feed(fix(42.0, -71.0, t0));
    await settle();
    expect(recorder.isSaveFailing()).toBe(true);
    expect(notifiedFailing).toBe(true);

    vi.mocked(appendTrackPoint).mockResolvedValue(undefined);
    nav.feed(fix(42.001, -71.0, t0 + 10_000));
    await settle();
    expect(recorder.isSaveFailing()).toBe(false);
    expect(notifiedFailing).toBe(false);
    expect(appErrorLog.log).toHaveBeenCalledWith(
      "track-recorder",
      "diag",
      "track save recovered",
    );
  });
});
