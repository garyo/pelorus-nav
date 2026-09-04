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
import { diag } from "../utils/diag";
import { MS_TO_KNOTS } from "../utils/units";
import { connectionLog } from "./ConnectionEventLog";
import type {
  NavigationData,
  NavigationDataCallback,
  NavigationDataProvider,
} from "./NavigationData";
import type { ProviderNotice } from "./ProviderNotice";

/**
 * Receives the fixes the native service buffered while no JS was alive to
 * drain them (a process kill under way; see startNative). They are history,
 * not live data: the sink records them but never broadcasts them.
 */
export type BacklogSink = (points: NavigationData[]) => Promise<void>;

/** Buffered fixes older than this are stale beyond use, whatever their span. */
const MAX_BACKLOG_AGE_MS = 24 * 60 * 60 * 1000;
/** Bounds the ingest cost at boot; passive recording adds ~4 points/min. */
const MAX_BACKLOG_POINTS = 10_000;

export class CapacitorGPSProvider implements NavigationDataProvider {
  readonly id = "capacitor-gps";
  readonly name = "Device GPS";

  private listeners: NavigationDataCallback[] = [];
  private connected = false;
  private listenerHandle: PluginListenerHandle | null = null;
  private stoppedHandle: PluginListenerHandle | null = null;
  private accuracyHandle: PluginListenerHandle | null = null;
  /** Highest fix timestamp emitted so far. Drives the SQLite since-filter. */
  private lastSeenTimestamp = 0;
  /** Reentrancy guard: prevents overlapping drain calls from racing. */
  private draining = false;
  /** Re-entrancy hint: a wakeup arrived during a drain — drain again on exit. */
  private drainRequested = false;
  private visibilityHandler: (() => void) | null = null;
  private backlogSink: BacklogSink | null = null;
  /**
   * Serializes start/stop chains: connect() and disconnect() spawn async
   * native calls, and a quick toggle (or resetActiveProvider's
   * disconnect-then-connect) must not interleave stopNative with a
   * startNative still in flight — that can leave `connected=true` with the
   * native GPS actually stopped, or leak a bridge listener.
   */
  private ops: Promise<unknown> = Promise.resolve();
  private readonly onNotice?: (notice: ProviderNotice) => void;

  constructor(onNotice?: (notice: ProviderNotice) => void) {
    this.onNotice = onNotice;
  }

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
    connectionLog.log(this.id, "connect-request");
    this.enqueue(() => this.startNative()).catch((err) =>
      this.handleStartFailure(err),
    );
  }

  disconnect(): void {
    if (!this.connected) return;
    this.connected = false;
    connectionLog.log(this.id, "disconnected", "user");
    this.enqueue(() => this.stopNative()).catch(console.error);
  }

  /**
   * Manual reconnect (banner Retry / Settings button): full native restart.
   * Recovers from a native-side stop (notification Stop) and re-runs the
   * permission/precision checks on both platforms.
   */
  async reconnect(): Promise<void> {
    connectionLog.log(this.id, "connect-attempt", "manual");
    this.connected = true;
    this.enqueue(() => this.stopNative()).catch(() => {});
    await this.enqueue(() => this.startNative()).catch((err) =>
      this.handleStartFailure(err),
    );
  }

  /** Chain a native operation behind whatever is already in flight. */
  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    const run = this.ops.then(op, op);
    this.ops = run.catch(() => {});
    return run;
  }

  private handleStartFailure(err: unknown): void {
    console.error("Device GPS start failed:", err);
    this.connected = false;
    const message = err instanceof Error ? err.message : String(err);
    connectionLog.log(this.id, "error", `start: ${message}`);
    this.onNotice?.({ kind: "connect-failed", detail: message });
  }

  /** Native reported a stop we didn't ask for (notification Stop action). */
  private handleTrackingStopped(reason: string): void {
    if (!this.connected) return; // our own stopTracking during disconnect
    this.connected = false;
    connectionLog.log(this.id, "disconnected", reason);
    this.onNotice?.({
      kind: "connect-failed",
      detail:
        reason === "notification"
          ? "tracking stopped from the notification"
          : `tracking stopped (${reason})`,
    });
  }

  subscribe(callback: NavigationDataCallback): void {
    this.listeners.push(callback);
  }

  /** Where a connect-time backlog goes; without one it is discarded. */
  setBacklogSink(sink: BacklogSink | null): void {
    this.backlogSink = sink;
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
    // Everything in the SQLite buffer from before this connect is history:
    // fixes the service kept recording after the last JS died mid-trip (an
    // OS kill under way, a WebView reload). It must not replay through the
    // filter as if it were live, but it is the missing piece of the track,
    // so it goes to the backlog sink — before the live listener is
    // registered, so no drain can interleave with it — and is then pruned.
    const connectTimestamp = Date.now();
    this.lastSeenTimestamp = connectTimestamp;

    const existing = await BackgroundGPS.getRecordedPoints({
      sinceTimestamp: 0,
    }).catch(() => ({ points: [] as TrackPointNative[] }));
    if (existing.points.length > 0) {
      const backlog = existing.points
        .filter(
          (p) =>
            p.timestamp <= connectTimestamp &&
            p.timestamp >= connectTimestamp - MAX_BACKLOG_AGE_MS,
        )
        .sort((a, b) => a.timestamp - b.timestamp)
        .slice(-MAX_BACKLOG_POINTS);
      const oldest = existing.points[0].timestamp;
      const newest = existing.points[existing.points.length - 1].timestamp;
      const fate =
        this.backlogSink && backlog.length > 0 ? "recover" : "discard";
      diag(
        "drain",
        `connect ${fate} n=${existing.points.length} ageMs=${connectTimestamp - newest} spanMs=${newest - oldest}`,
      );
      if (fate === "recover" && this.backlogSink) {
        try {
          await this.backlogSink(backlog.map(toNavigationData));
        } catch (err) {
          console.error("Backlog recovery failed:", err);
          diag("drain", `backlog recovery failed: ${String(err)}`);
        }
      }
    }

    await BackgroundGPS.pruneRecordedPoints({
      beforeTimestamp: this.lastSeenTimestamp,
    }).catch(console.error);

    // Bridge events are wakeups, not data: every fix is in SQLite already,
    // and reading back from SQLite is what gives us race-free ordering.
    // Loud degradation: a native-side stop (notification action) and an
    // iOS reduced-accuracy state both mean "GPS looks alive but records
    // nothing" — surface them instead of silently losing the voyage.
    // The three registrations are independent, so run them concurrently.
    [this.listenerHandle, this.stoppedHandle, this.accuracyHandle] =
      await Promise.all([
        BackgroundGPS.addListener("locationUpdate", () => this.requestDrain()),
        BackgroundGPS.addListener("trackingStopped", (data) =>
          this.handleTrackingStopped(data.reason),
        ),
        BackgroundGPS.addListener("reducedAccuracy", () => {
          connectionLog.log(this.id, "error", "precise location off");
          this.onNotice?.({
            kind: "connect-failed",
            detail: "Precise Location is off — enable it in Settings",
          });
        }),
      ]);

    this.visibilityHandler = () => {
      if (document.visibilityState === "visible") this.requestDrain();
    };
    document.addEventListener("visibilitychange", this.visibilityHandler);

    await BackgroundGPS.startTracking();
    connectionLog.log(this.id, "connected");
    this.onNotice?.({ kind: "connected" });
  }

  private async stopNative(): Promise<void> {
    if (this.visibilityHandler) {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
      this.visibilityHandler = null;
    }
    await BackgroundGPS.stopTracking();
    for (const handle of [
      this.listenerHandle,
      this.stoppedHandle,
      this.accuracyHandle,
    ]) {
      await handle?.remove();
    }
    this.listenerHandle = null;
    this.stoppedHandle = null;
    this.accuracyHandle = null;
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

        // One line per drain batch: size + how far behind real time the
        // oldest buffered fix is. A large backlog/lag means the SQLite→
        // IndexedDB drain is falling behind (slow device, passive recovery).
        diag(
          "drain",
          `n=${points.length} lagMs=${Date.now() - points[0].timestamp}`,
        );

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
    const data = toNavigationData(point);
    for (const fn of this.listeners) {
      fn(data);
    }
  }
}

function toNavigationData(point: TrackPointNative): NavigationData {
  return {
    latitude: point.lat,
    longitude: point.lon,
    cog: point.course >= 0 ? point.course : null,
    sog: point.speed >= 0 ? point.speed * MS_TO_KNOTS : null,
    heading: null,
    accuracy: point.accuracy >= 0 ? point.accuracy : null,
    timestamp: point.timestamp,
    source: "capacitor-gps",
  };
}
