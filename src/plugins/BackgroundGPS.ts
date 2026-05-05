/**
 * TypeScript interface for the native BackgroundGPS Capacitor plugin.
 * This plugin manages a foreground service that records GPS points
 * even when the app is backgrounded or the screen is off.
 */

import type { PluginListenerHandle } from "@capacitor/core";
import { registerPlugin } from "@capacitor/core";

export interface TrackPointNative {
  timestamp: number;
  lat: number;
  lon: number;
  speed: number;
  course: number;
  accuracy: number;
}

export interface BackgroundGPSPlugin {
  /** Start the foreground service and GPS tracking. */
  startTracking(): Promise<void>;

  /** Stop the foreground service and GPS tracking. */
  stopTracking(): Promise<void>;

  /** Get all points recorded while the WebView was suspended. */
  getRecordedPoints(): Promise<{ points: TrackPointNative[] }>;

  /** Clear the native SQLite buffer after points have been transferred. */
  clearRecordedPoints(): Promise<void>;

  /**
   * Set the GPS power mode.
   * - "active": HIGH_ACCURACY, fast interval (default 1s), bridge events on,
   *   wake lock held continuously.
   * - "passive": BALANCED_POWER_ACCURACY, slow interval (default 15s), bridge
   *   events silenced (fixes go to SQLite for later recovery), wake lock toggled
   *   per-fix.
   *
   * `intervalMs` overrides the default for the chosen mode and is remembered
   * separately for active vs passive on the native side.
   *
   * `graceMs` only applies to mode="passive": when > 0, defer the transition
   * by this many ms using a native Handler (so it survives WebView suspension).
   * The active branch cancels any previously-scheduled grace.
   */
  setPowerMode(options: {
    mode: "active" | "passive";
    intervalMs?: number;
    graceMs?: number;
  }): Promise<void>;

  /** Update the foreground-service notification text (e.g. "Navigating" vs "Recording track"). */
  setNotificationText(options: { text: string }): Promise<void>;

  /** Check whether the foreground service is currently running. */
  isTracking(): Promise<{ tracking: boolean }>;

  /** Keep the device screen on (Android FLAG_KEEP_SCREEN_ON). */
  keepScreenOn(): Promise<void>;

  /** Allow the device screen to turn off normally. */
  allowScreenOff(): Promise<void>;

  /** Listen for live GPS updates delivered via the Capacitor bridge. */
  addListener(
    eventName: "locationUpdate",
    listenerFunc: (data: TrackPointNative) => void,
  ): Promise<PluginListenerHandle>;

  /** Remove all listeners for this plugin. */
  removeAllListeners(): Promise<void>;
}

export const BackgroundGPS =
  registerPlugin<BackgroundGPSPlugin>("BackgroundGPS");
