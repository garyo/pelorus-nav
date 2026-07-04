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

  /**
   * Pull buffered points from the native SQLite store. Pass `sinceTimestamp`
   * to receive only points strictly newer than that ms-epoch — used by the
   * provider's drain loop to advance through the buffer without re-emitting.
   * Returns points sorted ascending by timestamp.
   */
  getRecordedPoints(options?: {
    sinceTimestamp?: number;
  }): Promise<{ points: TrackPointNative[] }>;

  /**
   * Delete points with timestamp ≤ `beforeTimestamp`. Race-safe: rows the
   * native service writes between read and prune are preserved as long as
   * their timestamp is greater. Pass 0 (or omit) to clear the table.
   */
  pruneRecordedPoints(options?: { beforeTimestamp?: number }): Promise<void>;

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

  /**
   * Set the activity-window brightness. `level` is 0..1, or -1 to release
   * the window-level override and follow the system brightness. Does not
   * change the system brightness setting (per-window only).
   */
  setScreenBrightness(options: { level: number }): Promise<void>;

  /**
   * Read the system-wide SCREEN_OFF_TIMEOUT setting in milliseconds.
   * Returns -1 if the setting could not be read.
   */
  getScreenOffTimeout(): Promise<{ ms: number }>;

  /** Open the system Display settings screen (where SCREEN_OFF_TIMEOUT lives). */
  openDisplaySettings(): Promise<void>;

  /**
   * Append a line to the persistent native diagnostic log
   * (`<externalFilesDir>/diag.log`). Used to trace screen-off recording
   * behaviour across reloads/restarts that outlive the logcat buffer.
   */
  appendDiag(options: { tag: string; message: string }): Promise<void>;

  /**
   * Read the tail of the persistent native diagnostic log (diag.log).
   * `maxBytes` caps the returned tail (default 65536). `truncated` is true
   * when the file was longer; `sizeBytes` is the full on-disk size.
   * Rejects on web (no web implementation) and on native shells older than
   * this method — callers must catch.
   */
  readDiag(options?: {
    maxBytes?: number;
  }): Promise<{ text: string; truncated: boolean; sizeBytes: number }>;

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
