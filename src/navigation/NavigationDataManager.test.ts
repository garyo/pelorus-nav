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
  /** Polling-rate hints received from the manager, in order. */
  hints: number[] = [];
  /** Optional raw-transport capability, settable per test. */
  lastRawDataMs?: () => number;
  private cb: NavigationDataCallback | null = null;
  private connected = false;
  setDesiredIntervalMs(ms: number): void {
    this.hints.push(ms);
  }
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

/** External source (BLE/NMEA/Signal K pod): fixes arrive for free. */
class ExternalFakeProvider extends FakeProvider {
  readonly external = true;
}

describe("NavigationDataManager external-source update rate", () => {
  it("runs an external pod at the fast per-fix ceiling on a non-e-ink screen", () => {
    const mgr = new NavigationDataManager();
    mgr.registerProvider(new ExternalFakeProvider());
    mgr.setActiveProvider("fake");
    mgr.forceFastRate = true; // non-e-ink screen, visible
    expect(mgr.getAdaptiveState().tier).toBe("fast");
    expect(mgr.getAdaptiveState().intervalMs).toBe(250);
  });

  it("keeps internal GPS at the battery-saving 2 s ceiling", () => {
    const mgr = new NavigationDataManager();
    mgr.registerProvider(new FakeProvider());
    mgr.setActiveProvider("fake");
    mgr.forceFastRate = true;
    expect(mgr.getAdaptiveState().intervalMs).toBe(2000);
  });

  it("reports the effective rate from the source, not the throttle ceiling", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      const mgr = new NavigationDataManager();
      const provider = new ExternalFakeProvider();
      mgr.registerProvider(provider);
      mgr.setActiveProvider("fake");
      mgr.forceFastRate = true; // ceiling is 250 ms...

      // ...but a 2 Hz pod only delivers a fix every 500 ms.
      for (let i = 0; i < 6; i++) {
        provider.emit();
        vi.advanceTimersByTime(500);
      }

      // Ceiling stays 250 ms; the displayed effective rate tracks the source.
      expect(mgr.getAdaptiveState().intervalMs).toBe(250);
      expect(mgr.getEffectiveIntervalMs()).toBeGreaterThan(450);
      expect(mgr.getEffectiveIntervalMs()).toBeLessThan(550);
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to the throttle interval before any fixes arrive", () => {
    const mgr = new NavigationDataManager();
    mgr.registerProvider(new ExternalFakeProvider());
    mgr.setActiveProvider("fake");
    mgr.forceFastRate = true;
    expect(mgr.getEffectiveIntervalMs()).toBe(250);
  });

  it("does not spike the effective rate after a long gap (backgrounded tab)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      const mgr = new NavigationDataManager();
      const provider = new ExternalFakeProvider();
      mgr.registerProvider(provider);
      mgr.setActiveProvider("fake");
      mgr.forceFastRate = true;

      for (let i = 0; i < 5; i++) {
        provider.emit();
        vi.advanceTimersByTime(500);
      }
      expect(mgr.getEffectiveIntervalMs()).toBeGreaterThan(450);

      // A 60 s gap (tab hidden), then 2 Hz fixes resume. The gap must not be
      // averaged into the reading — it re-anchors and stays at the source rate.
      vi.advanceTimersByTime(60_000);
      for (let i = 0; i < 3; i++) {
        provider.emit();
        vi.advanceTimersByTime(500);
      }
      expect(mgr.getEffectiveIntervalMs()).toBeGreaterThan(450);
      expect(mgr.getEffectiveIntervalMs()).toBeLessThan(550);
    } finally {
      vi.useRealTimers();
    }
  });
});

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

describe("NavigationDataManager visibility (8b-3)", () => {
  let mgr: NavigationDataManager;
  let provider: FakeProvider;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    mgr = new NavigationDataManager();
    provider = new FakeProvider();
    mgr.registerProvider(provider);
    mgr.setActiveProvider("fake");
    // Adaptive rate (default); "normal" filter keeps the hardware-boost
    // heuristic out of the hint assertions.
    mgr.setFilterMode("normal");
    mgr.forceFastRate = true; // non-e-ink screen policy
  });

  afterEach(() => {
    mgr.dispose();
    vi.useRealTimers();
  });

  /** Stationary fixes: with force-fast released these settle on the slow tier. */
  function emitStationary(): void {
    vi.advanceTimersByTime(2000);
    provider.emit({ sog: 0, cog: null });
  }

  it("hidden releases the force-fast lock so the adaptive tier downgrades", () => {
    provider.emit({ sog: 0, cog: null });
    emitStationary();
    expect(mgr.getAdaptiveState().tier).toBe("fast"); // locked while visible

    mgr.setVisible(false);
    emitStationary();
    expect(mgr.getAdaptiveState().tier).toBe("slow"); // adaptive took over

    mgr.setVisible(true);
    expect(mgr.getAdaptiveState().tier).toBe("fast"); // lock reapplies at once
  });

  it("re-hints the provider polling rate on visibility changes", () => {
    provider.emit({ sog: 0, cog: null });
    mgr.setVisible(false);
    emitStationary();
    emitStationary();
    expect(provider.hints).toContain(10000); // slow tier reached the provider

    mgr.setVisible(true);
    expect(provider.hints.at(-1)).toBe(2000); // fast re-hinted immediately
  });

  it("visibility is a no-op when the screen policy doesn't force fast", () => {
    mgr.forceFastRate = false; // e-ink: adaptive rate even while visible
    const hintsBefore = provider.hints.length;
    mgr.setVisible(false);
    mgr.setVisible(true);
    expect(provider.hints.length).toBe(hintsBefore); // nothing re-hinted
  });
});

describe("NavigationDataManager fixlessState", () => {
  let mgr: NavigationDataManager;
  let provider: FakeProvider;
  /** Raw-transport timestamp for the provider; undefined = capability absent. */
  let rawDataMs: number | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    mgr = new NavigationDataManager();
    provider = new FakeProvider();
    provider.lastRawDataMs = () => rawDataMs as number;
    rawDataMs = undefined;
    mgr.registerProvider(provider);
    mgr.setActiveProvider("fake");
    mgr.setRateMode("manual", 2000); // threshold: 5000 ms (see above)
  });

  afterEach(() => {
    mgr.dispose();
    vi.useRealTimers();
  });

  it("is no-gps when the provider is disconnected", () => {
    provider.disconnect();
    expect(mgr.fixlessState()).toBe("no-gps");
  });

  it("is no-data when connected but the transport has gone silent", () => {
    rawDataMs = 0; // connected, nothing ever received
    vi.setSystemTime(60_000);
    expect(mgr.fixlessState()).toBe("no-data");
  });

  it("is no-fix while raw data is flowing (fixless sentences)", () => {
    vi.setSystemTime(60_000);
    rawDataMs = 59_000; // sentences arriving, just no valid fix
    expect(mgr.fixlessState()).toBe("no-fix");
  });

  it("is no-fix when the provider can't report raw data flow", () => {
    provider.lastRawDataMs = undefined;
    expect(mgr.fixlessState()).toBe("no-fix");
  });

  it("diagnosticsSnapshot names the provider and current state", () => {
    rawDataMs = 0;
    vi.setSystemTime(60_000);
    const snap = mgr.diagnosticsSnapshot();
    expect(snap).toContain("provider: Fake (fake)");
    expect(snap).toContain("connected: true");
    expect(snap).toContain("raw data age: (never this connection)");
    expect(snap).toContain("state: NO-DATA");
  });

  it("requestDeviceDiag resolves null when the provider has no hook", () => {
    return expect(mgr.requestDeviceDiag()).resolves.toBeNull();
  });
});
