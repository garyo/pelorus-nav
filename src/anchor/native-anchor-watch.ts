/**
 * Keeps the native (Android foreground service) anchor watch in step with
 * the JS one, and folds native alarms back into it.
 *
 * The JS state machine only runs while the WebView is awake: backgrounded
 * JS is suspended and passive GPS mode silences the native→JS bridge, so
 * overnight the service is the only thing watching. This module pushes the
 * armed geometry down on arm / anchor move / radius change, clears it on
 * disarm, forwards acknowledgments, and reconciles the retained
 * `anchorAlarm` event that arrives when the WebView resumes.
 *
 * Native-only: on web every call is skipped, so the JS watch stands alone.
 */

import { Capacitor } from "@capacitor/core";
import { BackgroundGPS } from "../plugins/BackgroundGPS";
import {
  type AnchorAlarmKind,
  type AnchorWatchManager,
  type AnchorWatchSnapshot,
  DEFAULT_ALARM_DELAY_S,
  DEFAULT_GPS_LOSS_ALARM_S,
} from "./AnchorWatchManager";

/** The slice of the native plugin this module drives. */
export interface NativeAnchorPlugin {
  setAnchorWatch(options: {
    lat: number;
    lon: number;
    radiusM: number;
    alarmDelayS?: number;
    gpsLossAlarmS?: number;
    warnM?: number;
  }): Promise<void>;
  clearAnchorWatch(): Promise<void>;
  acknowledgeAnchorAlarm(): Promise<void>;
  addListener(
    eventName: "anchorAlarm",
    listenerFunc: (data: {
      kind: AnchorAlarmKind;
      distanceM: number;
      at: number;
    }) => void,
  ): Promise<unknown>;
}

/** The manager surface this module needs; keeps the unit tests light. */
export type NativeAnchorManager = Pick<
  AnchorWatchManager,
  "subscribe" | "noteNativeAlarm"
>;

export interface NativeAnchorWatchOptions {
  plugin?: NativeAnchorPlugin;
  /** Defaults to Capacitor's platform check; tests pass it explicitly. */
  isNative?: boolean;
  alarmDelayS?: number;
  gpsLossAlarmS?: number;
}

/** Geometry the native side needs; a change means "re-push". */
function geometryKey(snap: AnchorWatchSnapshot): string {
  return `${snap.anchor.lat},${snap.anchor.lon},${snap.radiusM},${snap.warnM}`;
}

/**
 * Wire the manager to the native watch. Safe to call once at startup, before
 * or after {@link AnchorWatchManager.restore} — restore() notifies, which
 * pushes the restored watch down.
 */
export function connectNativeAnchorWatch(
  manager: NativeAnchorManager,
  options: NativeAnchorWatchOptions = {},
): void {
  const isNative = options.isNative ?? Capacitor.isNativePlatform();
  if (!isNative) return;
  const plugin = options.plugin ?? (BackgroundGPS as NativeAnchorPlugin);
  const alarmDelayS = options.alarmDelayS ?? DEFAULT_ALARM_DELAY_S;
  const gpsLossAlarmS = options.gpsLossAlarmS ?? DEFAULT_GPS_LOSS_ALARM_S;

  // Native shells older than these methods reject the call; a dead native
  // watch must never take the JS one down with it.
  const ignore = (err: unknown) => console.warn("native anchor watch", err);

  let pushedGeometry: string | null = null;
  let wasAcknowledged = false;

  manager.subscribe((snap) => {
    if (!snap) {
      wasAcknowledged = false;
      if (pushedGeometry === null) return;
      pushedGeometry = null;
      plugin.clearAnchorWatch().catch(ignore);
      return;
    }
    const key = geometryKey(snap);
    if (key !== pushedGeometry) {
      pushedGeometry = key;
      plugin
        .setAnchorWatch({
          lat: snap.anchor.lat,
          lon: snap.anchor.lon,
          radiusM: snap.radiusM,
          alarmDelayS,
          gpsLossAlarmS,
          warnM: snap.warnM,
        })
        .catch(ignore);
    }
    // Acknowledging in the app silences the native alarm too — otherwise
    // the notification's sound would outlive the tap that stopped the
    // in-app one.
    if (snap.acknowledged && !wasAcknowledged) {
      plugin.acknowledgeAnchorAlarm().catch(ignore);
    }
    wasAcknowledged = snap.acknowledged;
  });

  plugin
    .addListener("anchorAlarm", (data) => manager.noteNativeAlarm(data.kind))
    .catch(ignore);
}
