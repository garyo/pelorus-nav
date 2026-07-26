import type * as maplibregl from "maplibre-gl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTrackPoints } from "../data/db";
import type { TrackMeta, TrackPoint } from "../data/Track";
import type { NavigationData } from "../navigation/NavigationData";
import type { NavigationDataManager } from "../navigation/NavigationDataManager";
import { capDisplayPoints, TrackLayer } from "./TrackLayer";
import { TrackRecorder } from "./TrackRecorder";

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

// ── TrackLayer live-buffer tests (Finding 8) ────────────────────────────

const { fakeDb } = vi.hoisted(() => ({
  fakeDb: new Map<string, TrackPoint[]>(),
}));

vi.mock("../data/db", () => ({
  getAllTrackMetas: vi.fn().mockResolvedValue([]),
  getTrackPoints: vi.fn(async (id: string) => fakeDb.get(id) ?? []),
  appendTrackPoint: vi.fn(async (id: string, p: TrackPoint) => {
    const arr = fakeDb.get(id) ?? [];
    arr.push(p);
    fakeDb.set(id, arr);
  }),
  saveTrackMeta: vi.fn().mockResolvedValue(undefined),
  deleteTrack: vi.fn().mockResolvedValue(undefined),
  replaceTrackPoints: vi.fn().mockResolvedValue(undefined),
}));

/** Minimal fake standing in for NavigationDataManager's subscribe/unsubscribe,
 *  supporting multiple subscribers (like the real manager) so TrackLayer and
 *  TrackRecorder can both listen and see production-like call ordering. */
class FakeNavManager {
  private listeners: ((data: NavigationData) => void)[] = [];
  subscribe(cb: (data: NavigationData) => void): void {
    this.listeners.push(cb);
  }
  unsubscribe(cb: (data: NavigationData) => void): void {
    const i = this.listeners.indexOf(cb);
    if (i >= 0) this.listeners.splice(i, 1);
  }
  feed(data: NavigationData): void {
    for (const fn of [...this.listeners]) fn(data);
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

/** Fake maplibregl.Map capturing per-source GeoJSON so tests can inspect the
 *  coordinates actually rendered for a given track id. */
class FakeMap {
  sources = new Map<string, GeoJSON.FeatureCollection>();
  layers = new Set<string>();
  on = vi.fn();
  isStyleLoaded = vi.fn(() => false);
  getSource = vi.fn((id: string) => {
    if (!this.sources.has(id)) return undefined;
    return {
      setData: (data: GeoJSON.FeatureCollection) => {
        this.sources.set(id, data);
      },
    };
  });
  addSource = vi.fn((id: string, opts: { data: GeoJSON.FeatureCollection }) => {
    this.sources.set(id, opts.data);
  });
  addLayer = vi.fn((layer: { id: string }) => {
    this.layers.add(layer.id);
  });
  removeLayer = vi.fn((id: string) => {
    this.layers.delete(id);
  });
  removeSource = vi.fn((id: string) => {
    this.sources.delete(id);
  });
  getLayer = vi.fn((id: string) => (this.layers.has(id) ? {} : undefined));
  setPaintProperty = vi.fn();
  getStyle = vi.fn(() => ({ layers: [] }));
}

/** Coordinates rendered for a track's line source, or undefined if never drawn. */
function renderedCoords(
  map: FakeMap,
  trackId: string,
): [number, number][] | undefined {
  const fc = map.sources.get(`_track-${trackId}`);
  const feature = fc?.features[0];
  if (!feature || feature.geometry.type !== "LineString") return undefined;
  return feature.geometry.coordinates as [number, number][];
}

async function flush(times = 20): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

/** Track/NavigationDataManager code touches localStorage (active-track resume
 *  key); stub it so tests run under the "node" vitest environment. */
function useFakeLocalStorage(): void {
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
}

describe("TrackLayer live buffer — gap-split", () => {
  useFakeLocalStorage();

  it("does not mix the old track's pre-gap points into the new track's rendered line", async () => {
    fakeDb.clear();
    const nav = new FakeNavManager();
    const recorder = new TrackRecorder(nav as unknown as NavigationDataManager);
    const map = new FakeMap();
    new TrackLayer(
      map as unknown as maplibregl.Map,
      nav as unknown as NavigationDataManager,
      recorder,
    );

    recorder.start();
    await flush();

    const t0 = Date.parse("2026-07-01T12:00:00.000Z");
    nav.feed(fix(42.0, -71.0, t0));
    await flush();

    const preGapTrack = recorder.getCurrentTrack();
    expect(preGapTrack).not.toBeNull();

    // 40 min later, ~1.8 nm away: low implied speed (not a glitch), but past
    // GAP_THRESHOLD_MS (30 min) — TrackRecorder splits off a new track.
    const t1 = t0 + 40 * 60 * 1000;
    nav.feed(fix(42.03, -71.0, t1));
    await flush();

    const postGapTrack = recorder.getCurrentTrack();
    expect(postGapTrack).not.toBeNull();
    expect(postGapTrack?.id).not.toBe(preGapTrack?.id);

    // The next fix on the new track — this is where the bug (unreset
    // display buffer) leaks the pre-gap history into the new track's line.
    const t2 = t1 + 10_000;
    nav.feed(fix(42.031, -71.001, t2));
    await flush();

    const newTrackId = postGapTrack?.id as string;
    const coords = renderedCoords(map, newTrackId);
    expect(coords).toBeDefined();
    // None of the new track's rendered coordinates should be the old
    // track's pre-gap point.
    const containsPreGapPoint = coords?.some(
      ([lon, lat]) => lon === -71.0 && lat === 42.0,
    );
    expect(containsPreGapPoint).toBe(false);
  });
});

describe("TrackLayer live buffer — seeding race", () => {
  useFakeLocalStorage();

  it("merges live-appended points instead of discarding them, and does not launch duplicate reads", async () => {
    fakeDb.clear();
    const trackId = "track-under-seed";
    const trackMeta: TrackMeta = {
      id: trackId,
      name: "Test Track",
      createdAt: 1_000,
      color: "#ff4444",
      visible: true,
      pointCount: 0,
      durationMs: 0,
      totalDistanceNM: 0,
    };

    let resolveSeed: (points: TrackPoint[]) => void = () => {};
    const seedPromise = new Promise<TrackPoint[]>((resolve) => {
      resolveSeed = resolve;
    });
    const getTrackPointsMock = vi.mocked(getTrackPoints);
    getTrackPointsMock.mockClear();
    getTrackPointsMock.mockImplementation(async (id: string) =>
      id === trackId ? seedPromise : [],
    );

    const nav = new FakeNavManager();
    const listeners: (() => void)[] = [];
    const fakeRecorder = {
      isRecording: () => true,
      getCurrentTrack: () => trackMeta,
      onRecordingChange: (fn: () => void) => listeners.push(fn),
    };
    const notify = () => {
      for (const fn of listeners) fn();
    };

    const map = new FakeMap();
    new TrackLayer(
      map as unknown as maplibregl.Map,
      nav as unknown as NavigationDataManager,
      fakeRecorder as unknown as TrackRecorder,
    );

    // First notify starts the (slow) seed read for this track.
    notify();
    await flush();
    expect(getTrackPointsMock).toHaveBeenCalledTimes(1);

    // A second notify while the read is still pending must not launch a
    // duplicate read of the same track.
    notify();
    await flush();
    expect(getTrackPointsMock).toHaveBeenCalledTimes(1);

    // A live GPS fix arrives while the historical read is still in flight.
    const liveTimestamp = 5_000;
    nav.feed(fix(42.05, -71.05, liveTimestamp));
    await flush();

    // Now the slow historical read resolves with two older points.
    resolveSeed([point(42.0, -71.0, 1000), point(42.01, -71.01, 2000)]);
    await flush();

    const coords = renderedCoords(map, trackId);
    expect(coords).toBeDefined();
    // The live point must survive the seed resolving (merge, not overwrite).
    expect(coords).toEqual([
      [-71.0, 42.0],
      [-71.01, 42.01],
      [-71.05, 42.05],
    ]);
  });
});
