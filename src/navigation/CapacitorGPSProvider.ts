/**
 * GPS provider that uses the native BackgroundGPS Capacitor plugin.
 * Active only when running inside a Capacitor native app.
 *
 * Single-pipeline design: every fix the foreground service produces is
 * written to native SQLite, and a "locationUpdate" bridge event acts purely
 * as a wakeup. This provider drains the SQLite buffer in chronological
 * order on each wakeup and on visibility=visible, emitting fixes through
 * the same `subscribe` callback the browser provider uses. Recovery from
 * screen-off periods is therefore not a separate code path — it's just a
 * longer drain.
 */

import type { PluginListenerHandle } from "@capacitor/core";
import { Capacitor } from "@capacitor/core";
import { BackgroundGPS, type TrackPointNative } from "../plugins/BackgroundGPS";
import { MS_TO_KNOTS } from "../utils/units";
import type {
  NavigationData,
  NavigationDataCallback,
  NavigationDataProvider,
} from "./NavigationData";

export class CapacitorGPSProvider implements NavigationDataProvider {
  readonly id = "capacitor-gps";
  readonly name = "Device GPS";

  private listeners: NavigationDataCallback[] = [];
  private connected = false;
  private listenerHandle: PluginListenerHandle | null = null;
  /** Highest fix timestamp emitted so far. Drives the SQLite since-filter. */
  private lastSeenTimestamp = 0;
  /** Reentrancy guard: prevents overlapping drain calls from racing. */
  private draining = false;
  /** Re-entrancy hint: a wakeup arrived during a drain — drain again on exit. */
  private drainRequested = false;
  private visibilityHandler: (() => void) | null = null;

  /** Returns true when running inside a Capacitor native shell. */
  static isAvailable(): boolean {
    return Capacitor.isNativePlatform();
  }

  isConnected(): boolean {
    return this.connected;
  }

  connect(): void {
    if (this.connected) return;
    this.connected = true;
    this.startNative().catch(console.error);
  }

  disconnect(): void {
    if (!this.connected) return;
    this.connected = false;
    this.stopNative().catch(console.error);
  }

  subscribe(callback: NavigationDataCallback): void {
    this.listeners.push(callback);
  }

  unsubscribe(callback: NavigationDataCallback): void {
    const idx = this.listeners.indexOf(callback);
    if (idx >= 0) this.listeners.splice(idx, 1);
  }

  /**
   * Per-fix HW-rate hints from `NavigationDataManager` would fight the
   * visibility/recording-driven `setPowerMode` decisions made in main.ts,
   * so on this provider they're a no-op. The visibility state machine is
   * the single authority on native rate; the JS adaptive controller still
   * runs as a broadcast throttle, but its hints don't reach the chip.
   */
  setDesiredIntervalMs(_ms: number): void {
    // intentionally empty
  }

  /**
   * Set the GPS power mode. Used by the visibility/recording state machine
   * in main.ts. When `graceMs > 0` (passive only), the transition is deferred
   * on the native side by that many ms — the JS `setTimeout` we'd otherwise
   * use is throttled/suspended when the WebView is hidden.
   */
  setPowerMode(
    mode: "active" | "passive",
    intervalMs?: number,
    graceMs?: number,
  ): void {
    const opts: {
      mode: "active" | "passive";
      intervalMs?: number;
      graceMs?: number;
    } = { mode };
    if (intervalMs !== undefined) opts.intervalMs = intervalMs;
    if (graceMs !== undefined) opts.graceMs = graceMs;
    BackgroundGPS.setPowerMode(opts).catch(console.error);
  }

  /** Stop native GPS without disconnecting the provider (screen-off, not recording). */
  pauseTracking(): void {
    BackgroundGPS.stopTracking().catch(console.error);
  }

  /** Restart native GPS after a pause (screen back on). */
  resumeTracking(): void {
    if (this.connected) {
      BackgroundGPS.startTracking().catch(console.error);
    }
  }

  private async startNative(): Promise<void> {
    // Discard whatever is in the SQLite buffer from previous sessions —
    // we don't want a fresh connect() to replay stale fixes through the
    // filter as if they were live.
    this.lastSeenTimestamp = Date.now();
    await BackgroundGPS.pruneRecordedPoints({
      beforeTimestamp: this.lastSeenTimestamp,
    }).catch(console.error);

    // Bridge events are wakeups, not data: every fix is in SQLite already,
    // and reading back from SQLite is what gives us race-free ordering.
    this.listenerHandle = await BackgroundGPS.addListener(
      "locationUpdate",
      () => this.requestDrain(),
    );

    this.visibilityHandler = () => {
      if (document.visibilityState === "visible") this.requestDrain();
    };
    document.addEventListener("visibilitychange", this.visibilityHandler);

    await BackgroundGPS.startTracking();
  }

  private async stopNative(): Promise<void> {
    if (this.visibilityHandler) {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
      this.visibilityHandler = null;
    }
    await BackgroundGPS.stopTracking();
    if (this.listenerHandle) {
      await this.listenerHandle.remove();
      this.listenerHandle = null;
    }
  }

  /**
   * Fire-and-forget drain. If a drain is already in flight, set a flag so
   * we re-drain after it finishes (catches fixes inserted while we were
   * reading or emitting).
   */
  private requestDrain(): void {
    if (this.draining) {
      this.drainRequested = true;
      return;
    }
    this.drain().catch(console.error);
  }

  /**
   * Read everything newer than `lastSeenTimestamp` from SQLite, emit each
   * point in chronological order, advance `lastSeenTimestamp`, then prune
   * the rows we've consumed. If a wakeup arrives mid-drain, loop again.
   */
  async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      do {
        this.drainRequested = false;
        const { points } = await BackgroundGPS.getRecordedPoints({
          sinceTimestamp: this.lastSeenTimestamp,
        });
        if (points.length === 0) continue;

        // Native already returns ASC by timestamp, but defend against
        // out-of-order writes by sorting here too — cheap insurance.
        points.sort((a, b) => a.timestamp - b.timestamp);

        for (const pt of points) {
          this.emit(pt);
          this.lastSeenTimestamp = pt.timestamp;
        }
        await BackgroundGPS.pruneRecordedPoints({
          beforeTimestamp: this.lastSeenTimestamp,
        });
      } while (this.drainRequested);
    } finally {
      this.draining = false;
    }
  }

  private emit(point: TrackPointNative): void {
    const data: NavigationData = {
      latitude: point.lat,
      longitude: point.lon,
      cog: point.course >= 0 ? point.course : null,
      sog: point.speed >= 0 ? point.speed * MS_TO_KNOTS : null,
      heading: null,
      accuracy: point.accuracy >= 0 ? point.accuracy : null,
      timestamp: point.timestamp,
      source: "capacitor-gps",
    };
    for (const fn of this.listeners) {
      fn(data);
    }
  }
}
