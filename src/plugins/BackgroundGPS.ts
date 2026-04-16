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

  /** Set GPS polling interval and enable/disable native adaptive rate. */
  setGpsInterval(options: {
    intervalMs: number;
    adaptive: boolean;
  }): Promise<void>;

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
