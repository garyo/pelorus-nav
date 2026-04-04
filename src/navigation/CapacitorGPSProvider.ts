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

  setDesiredIntervalMs(ms: number): void {
    BackgroundGPS.setGpsInterval({ intervalMs: ms, adaptive: false }).catch(
      console.error,
    );
  }

  /** Enable native-side adaptive rate (for screen-off recording). */
  enableBackgroundAdaptive(hintIntervalMs: number): void {
    BackgroundGPS.setGpsInterval({
      intervalMs: hintIntervalMs,
      adaptive: true,
    }).catch(console.error);
  }

  /** Disable native adaptive, let JS control the rate. */
  disableBackgroundAdaptive(intervalMs: number): void {
    BackgroundGPS.setGpsInterval({
      intervalMs: intervalMs,
      adaptive: false,
    }).catch(console.error);
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
