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

/**
 * What the native service can say about the watch it is running. Mirrors
 * AnchorWatchServiceStatus in AnchorWatch.kt; the two time fields are
 * milliseconds, -1 when no watch is armed natively.
 */
export interface AnchorWatchNativeStatus {
  /** The foreground service exists in this process. */
  serviceRunning: boolean;
  /** …and it is running an anchor watch. */
  armedNatively: boolean;
  /**
   * The service's own GPS has produced at least one accepted fix for this
   * watch. False means screen-off detection has never worked: the service is
   * watching a device that cannot see the boat.
   */
  hadFix: boolean;
  /** Age of the newest accepted fix; -1 before the first one. */
  lastFixAgeMs: number;
  /** Time since the native detector was armed — separates acquiring from blind. */
  armedMs: number;
  /** The continuous wake lock that keeps detection alive in deep sleep. */
  wakeLockHeld: boolean;
  /** Precise location, the foreground service's hard requirement. */
  locationPermission: boolean;
  /** A native alarm is sounding right now. */
  alarmKind?: "drag" | "gps-loss";
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

  /**
   * Arm or update the native anchor watch (Android only for now).
   *
   * The native service distance-tests every accepted fix against the anchor
   * and raises its own alarm — the JS watch is blind once the WebView is
   * suspended and passive mode silences the bridge. Call again on anchor
   * move or radius change; the native hysteresis survives an update.
   *
   * Arming starts the foreground service if it isn't already running (for
   * track recording), and prompts for location permission if needed: the
   * watch needs the device's own GPS, because the app's fixes may come from
   * an external Bluetooth receiver that only reaches the suspended WebView.
   *
   * `warnM` doubles as the re-alarm margin: after an acknowledgment, a
   * further `warnM` of drag alarms again.
   */
  setAnchorWatch(options: {
    lat: number;
    lon: number;
    radiusM: number;
    alarmDelayS?: number;
    gpsLossAlarmS?: number;
    warnM?: number;
  }): Promise<void>;

  /**
   * Disarm the native anchor watch and cancel any sounding native alarm.
   * Also stops the foreground service unless track recording still needs it.
   */
  clearAnchorWatch(): Promise<void>;

  /**
   * Ask whether the screen-off watch is actually watching.
   *
   * The app cannot tell from its own side: where the app's fixes come from an
   * external Bluetooth receiver, the service's separate device-GPS detection
   * can be blind — no GPS hardware, permission declined, antenna below decks —
   * and it stays deliberately silent about that (a watch never proven to work
   * has no basis for a GPS-loss alarm). Without this the user believes they
   * are covered overnight and is not.
   *
   * Rejects on native shells older than this method — callers must catch.
   */
  getAnchorWatchStatus(): Promise<AnchorWatchNativeStatus>;

  /** Silence a sounding native anchor alarm; the native watch keeps running. */
  acknowledgeAnchorAlarm(): Promise<void>;

  /**
   * Stop the native alarm audio because the JS alarm is now audible. Not an
   * acknowledgment: the alarm, its notification and the watch are untouched,
   * only the sound moves. Native takes it back the moment the app leaves the
   * foreground, so this must only be called while JS is genuinely sounding —
   * a WebView returning from suspension has a suspended AudioContext and
   * would otherwise take the alarm over and fall silent.
   */
  handOffAnchorAlarm(): Promise<void>;

  /**
   * Report that the app's own GPS source delivered a fix. That source is
   * often an external Bluetooth receiver the native service can't see, whose
   * fixes would otherwise look like silence and trip the native GPS-loss
   * alarm while the app is wide awake. Position is deliberately not passed:
   * drag detection stays on the service's own consistent source.
   */
  noteExternalFix(): Promise<void>;

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

  /**
   * Fired when the native service stopped OUTSIDE JS control — the
   * notification's Stop action, or a foreground-start failure. Delivered
   * retained, so a hidden/suspended WebView receives it on resume. A
   * JS-initiated stopTracking() never fires this.
   */
  addListener(
    eventName: "trackingStopped",
    listenerFunc: (data: { reason: string }) => void,
  ): Promise<PluginListenerHandle>;

  /**
   * Fired when the NATIVE anchor watch raised an alarm — dragging, or no
   * fix for the GPS-loss timeout. Delivered retained, because the alarm
   * fires precisely when the WebView is suspended: JS consumes it on resume
   * and reconciles its own watch state with what happened while it was away.
   */
  addListener(
    eventName: "anchorAlarm",
    listenerFunc: (data: {
      kind: "drag" | "gps-loss";
      distanceM: number;
      at: number;
    }) => void,
  ): Promise<PluginListenerHandle>;

  /**
   * iOS only: "Precise Location" is off and the temporary full-accuracy
   * request was declined — every fix will fail the 30 m accuracy gate, so
   * location runs but nothing records. Surface it; don't fail silently.
   */
  addListener(
    eventName: "reducedAccuracy",
    listenerFunc: () => void,
  ): Promise<PluginListenerHandle>;

  /** Remove all listeners for this plugin. */
  removeAllListeners(): Promise<void>;
}

export const BackgroundGPS =
  registerPlugin<BackgroundGPSPlugin>("BackgroundGPS");
