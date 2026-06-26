import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  NavigationData,
  NavigationDataCallback,
  NavigationDataProvider,
} from "./NavigationData";
import {
  GPS_STALE_FLOOR_MS,
  gpsStaleThresholdMs,
  NavigationDataManager,
} from "./NavigationDataManager";

class FakeProvider implements NavigationDataProvider {
  readonly id = "fake";
  readonly name = "Fake";
  private cb: NavigationDataCallback | null = null;
  private connected = false;
  isConnected(): boolean {
    return this.connected;
  }
  connect(): void {
    this.connected = true;
  }
  disconnect(): void {
    this.connected = false;
  }
  subscribe(cb: NavigationDataCallback): void {
    this.cb = cb;
  }
  unsubscribe(): void {
    this.cb = null;
  }
  emit(partial?: Partial<NavigationData>): void {
    this.cb?.({
      latitude: 42,
      longitude: -71,
      cog: 90,
      sog: 5,
      heading: null,
      accuracy: 5,
      timestamp: Date.now(),
      source: "fake",
      ...partial,
    });
  }
}

describe("gpsStaleThresholdMs", () => {
  it("floors at GPS_STALE_FLOOR_MS for fast broadcast rates", () => {
    expect(gpsStaleThresholdMs(1000)).toBe(GPS_STALE_FLOOR_MS);
    expect(gpsStaleThresholdMs(500)).toBe(GPS_STALE_FLOOR_MS);
  });
  it("scales to 2.5x the interval for slow broadcast rates", () => {
    expect(gpsStaleThresholdMs(4000)).toBe(10000);
  });
});

describe("NavigationDataManager fix staleness", () => {
  let mgr: NavigationDataManager;
  let provider: FakeProvider;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    mgr = new NavigationDataManager();
    provider = new FakeProvider();
    mgr.registerProvider(provider);
    mgr.setActiveProvider("fake");
    // Manual rate → deterministic threshold: max(4000, 2000*2.5) = 5000 ms.
    mgr.setRateMode("manual", 2000);
  });

  afterEach(() => {
    mgr.dispose();
    vi.useRealTimers();
  });

  it("reports stale before any fix arrives", () => {
    expect(mgr.isFixStale()).toBe(true);
    expect(mgr.getFixAgeMs()).toBe(Number.POSITIVE_INFINITY);
  });

  it("is fresh right after a fix, stale once past the threshold", () => {
    provider.emit();
    expect(mgr.isFixStale()).toBe(false);

    vi.advanceTimersByTime(4000);
    expect(mgr.isFixStale()).toBe(false); // 4 s < 5 s threshold

    vi.advanceTimersByTime(1500); // 5.5 s total
    expect(mgr.isFixStale()).toBe(true);
  });

  it("recovers to fresh when fixes resume", () => {
    provider.emit();
    vi.advanceTimersByTime(6000);
    expect(mgr.isFixStale()).toBe(true);

    provider.emit();
    expect(mgr.isFixStale()).toBe(false);
  });

  it("goes stale immediately on a provider switch", () => {
    provider.emit();
    expect(mgr.isFixStale()).toBe(false);

    mgr.setActiveProvider("fake"); // re-activate clears the last-fix time
    expect(mgr.isFixStale()).toBe(true);
  });
});
