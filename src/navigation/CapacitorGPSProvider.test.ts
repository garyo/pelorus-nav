import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrackPointNative } from "../plugins/BackgroundGPS";

// vi.mock is hoisted to the top of the file, so any local references it
// uses must come from vi.hoisted (also hoisted) rather than ordinary
// module-level state.
const { mockPlugin } = vi.hoisted(() => ({
  mockPlugin: {
    startTracking: vi.fn(() => Promise.resolve()),
    stopTracking: vi.fn(() => Promise.resolve()),
    getRecordedPoints: vi.fn<
      (opts?: { sinceTimestamp?: number }) => Promise<{
        points: TrackPointNative[];
      }>
    >(() => Promise.resolve({ points: [] })),
    pruneRecordedPoints: vi.fn(() => Promise.resolve()),
    setPowerMode: vi.fn(() => Promise.resolve()),
    setNotificationText: vi.fn(() => Promise.resolve()),
    isTracking: vi.fn(() => Promise.resolve({ tracking: false })),
    keepScreenOn: vi.fn(() => Promise.resolve()),
    allowScreenOff: vi.fn(() => Promise.resolve()),
    addListener: vi.fn(() => Promise.resolve({ remove: vi.fn() })),
    removeAllListeners: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock("../plugins/BackgroundGPS", () => ({
  BackgroundGPS: mockPlugin,
}));

import { CapacitorGPSProvider } from "./CapacitorGPSProvider";
import type { NavigationData } from "./NavigationData";

const pt = (
  timestamp: number,
  lat: number,
  lon: number,
  speed = 0,
  course = -1,
  accuracy = 5,
): TrackPointNative => ({ timestamp, lat, lon, speed, course, accuracy });

/** Direct handle to the provider's private state for assertions. */
type Internals = {
  lastSeenTimestamp: number;
  draining: boolean;
};

describe("CapacitorGPSProvider drain", () => {
  let provider: CapacitorGPSProvider;
  let received: NavigationData[];

  beforeEach(() => {
    for (const fn of Object.values(mockPlugin)) {
      if (typeof fn === "function" && "mockClear" in fn) fn.mockClear();
    }
    mockPlugin.getRecordedPoints.mockResolvedValue({ points: [] });
    provider = new CapacitorGPSProvider();
    received = [];
    provider.subscribe((d) => received.push({ ...d }));
  });

  it("emits nothing when SQLite buffer is empty", async () => {
    await provider.drain();
    expect(received).toEqual([]);
    expect(mockPlugin.pruneRecordedPoints).not.toHaveBeenCalled();
  });

  it("emits a single buffered point and advances lastSeen", async () => {
    mockPlugin.getRecordedPoints.mockResolvedValueOnce({
      points: [pt(1000, 42.0, -71.0, 5, 90, 3)],
    });
    await provider.drain();
    expect(received).toHaveLength(1);
    expect(received[0].latitude).toBe(42.0);
    expect(received[0].longitude).toBe(-71.0);
    expect(received[0].sog).toBeCloseTo(5 * 1.94384, 3);
    expect(received[0].cog).toBe(90);
    expect(received[0].accuracy).toBe(3);
    expect((provider as unknown as Internals).lastSeenTimestamp).toBe(1000);
    expect(mockPlugin.pruneRecordedPoints).toHaveBeenCalledWith({
      beforeTimestamp: 1000,
    });
  });

  it("emits multiple buffered points in chronological order", async () => {
    mockPlugin.getRecordedPoints.mockResolvedValueOnce({
      points: [
        pt(1000, 42.0, -71.0),
        pt(2000, 42.1, -71.1),
        pt(3000, 42.2, -71.2),
      ],
    });
    await provider.drain();
    expect(received.map((d) => d.timestamp)).toEqual([1000, 2000, 3000]);
    expect((provider as unknown as Internals).lastSeenTimestamp).toBe(3000);
  });

  it("sorts out-of-order DB rows before emitting", async () => {
    mockPlugin.getRecordedPoints.mockResolvedValueOnce({
      points: [
        pt(2000, 42.1, -71.1),
        pt(1000, 42.0, -71.0),
        pt(3000, 42.2, -71.2),
      ],
    });
    await provider.drain();
    expect(received.map((d) => d.timestamp)).toEqual([1000, 2000, 3000]);
  });

  it("does not re-emit on a second drain with no new points", async () => {
    mockPlugin.getRecordedPoints.mockResolvedValueOnce({
      points: [pt(1000, 42.0, -71.0)],
    });
    await provider.drain();
    expect(received).toHaveLength(1);

    // Buffer is "empty" because lastSeenTimestamp filter excludes the prior fix.
    mockPlugin.getRecordedPoints.mockResolvedValueOnce({ points: [] });
    await provider.drain();
    expect(received).toHaveLength(1);

    // Provider should pass the advanced sinceTimestamp to the plugin.
    expect(mockPlugin.getRecordedPoints).toHaveBeenLastCalledWith({
      sinceTimestamp: 1000,
    });
  });

  it("appends new points across consecutive drains", async () => {
    mockPlugin.getRecordedPoints.mockResolvedValueOnce({
      points: [pt(1000, 42.0, -71.0)],
    });
    await provider.drain();

    mockPlugin.getRecordedPoints.mockResolvedValueOnce({
      points: [pt(2000, 42.1, -71.1), pt(3000, 42.2, -71.2)],
    });
    await provider.drain();

    expect(received.map((d) => d.timestamp)).toEqual([1000, 2000, 3000]);
    expect((provider as unknown as Internals).lastSeenTimestamp).toBe(3000);
  });

  it("converts m/s speed to knots and treats negatives as null", async () => {
    mockPlugin.getRecordedPoints.mockResolvedValueOnce({
      points: [
        pt(1000, 42.0, -71.0, 10, 45, 5), // 10 m/s
        pt(2000, 42.0, -71.0, -1, -1, -1), // negatives = unavailable
      ],
    });
    await provider.drain();
    expect(received[0].sog).toBeCloseTo(10 * 1.94384, 3);
    expect(received[0].cog).toBe(45);
    expect(received[1].sog).toBeNull();
    expect(received[1].cog).toBeNull();
    expect(received[1].accuracy).toBeNull();
  });

  it("collapses overlapping drain calls (no double-read of the same batch)", async () => {
    let resolveFirst: ((v: { points: TrackPointNative[] }) => void) | null =
      null;
    mockPlugin.getRecordedPoints.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );

    const a = provider.drain();
    const b = provider.drain(); // Should be a no-op while `a` is in flight.

    if (!resolveFirst) throw new Error("getRecordedPoints not invoked");
    (resolveFirst as (v: { points: TrackPointNative[] }) => void)({
      points: [pt(1000, 42.0, -71.0)],
    });
    await Promise.all([a, b]);

    expect(received).toHaveLength(1);
    expect(mockPlugin.getRecordedPoints).toHaveBeenCalledTimes(1);
  });

  it("re-drains when a wakeup arrives mid-drain", async () => {
    let resolveFirst: ((v: { points: TrackPointNative[] }) => void) | null =
      null;
    mockPlugin.getRecordedPoints.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    mockPlugin.getRecordedPoints.mockResolvedValueOnce({
      points: [pt(2000, 42.1, -71.1)],
    });

    const drainPromise = provider.drain();
    // While the first read is pending, a wakeup arrives — provider should
    // remember the request and run a second drain when the first completes.
    (provider as unknown as { requestDrain(): void }).requestDrain();

    if (!resolveFirst) throw new Error("getRecordedPoints not invoked");
    (resolveFirst as (v: { points: TrackPointNative[] }) => void)({
      points: [pt(1000, 42.0, -71.0)],
    });
    await drainPromise;

    expect(received.map((d) => d.timestamp)).toEqual([1000, 2000]);
    expect(mockPlugin.getRecordedPoints).toHaveBeenCalledTimes(2);
    expect(mockPlugin.getRecordedPoints).toHaveBeenNthCalledWith(2, {
      sinceTimestamp: 1000,
    });
  });
});
