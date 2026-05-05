/**
 * GPS provider that uses the native BackgroundGPS Capacitor plugin.
 * Active only when running inside a Capacitor native app.
 *
 * - Starts a foreground service for background GPS recording.
 * - Receives live location updates via the Capacitor bridge.
 * - Falls back gracefully (isAvailable() returns false in browsers).
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
    this.listenerHandle = await BackgroundGPS.addListener(
      "locationUpdate",
      (point: TrackPointNative) => this.onNativePoint(point),
    );
    await BackgroundGPS.startTracking();
  }

  private async stopNative(): Promise<void> {
    await BackgroundGPS.stopTracking();
    if (this.listenerHandle) {
      await this.listenerHandle.remove();
      this.listenerHandle = null;
    }
  }

  private onNativePoint(point: TrackPointNative): void {
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
