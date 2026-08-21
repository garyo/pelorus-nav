/**
 * Keeps the native (Android foreground service) anchor watch in step with
 * the JS one, and folds native alarms back into it.
 *
 * The JS state machine only runs while the WebView is awake: backgrounded
 * JS is suspended and passive GPS mode silences the native→JS bridge, so
 * overnight the service is the only thing watching. This module pushes the
 * armed geometry down on arm / anchor move / radius change, clears it on
 * disarm, forwards acknowledgments, reconciles the retained `anchorAlarm`
 * event that arrives when the WebView resumes, and owns the alarm handoff
 * (see {@link connectNativeAnchorWatch}).
 *
 * Native-only: on web every call is skipped, so the JS watch stands alone.
 */

import { Capacitor } from "@capacitor/core";
import type { CobAlarm } from "../cob/CobAlarm";
import type { NavigationDataManager } from "../navigation/NavigationDataManager";
import { BackgroundGPS } from "../plugins/BackgroundGPS";
import {
  type AnchorAlarmKind,
  type AnchorWatchManager,
  type AnchorWatchSnapshot,
  DEFAULT_ALARM_DELAY_S,
  DEFAULT_GPS_LOSS_ALARM_S,
} from "./AnchorWatchManager";

/**
 * How often a fix from the app's own GPS is reported to the native watch.
 * Only the GPS-loss deadline (2 min by default) depends on it, so this can
 * be far slower than the fix rate.
 */
const EXTERNAL_FIX_REPORT_MS = 10_000;

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
  handOffAnchorAlarm(): Promise<void>;
  noteExternalFix(): Promise<void>;
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

/** The alarm surface the handoff decision needs. */
export type NativeAnchorAlarm = Pick<CobAlarm, "isBlocked" | "onBlockedChange">;

export interface NativeAnchorWatchOptions {
  plugin?: NativeAnchorPlugin;
  /** Defaults to Capacitor's platform check; tests pass it explicitly. */
  isNative?: boolean;
  alarmDelayS?: number;
  gpsLossAlarmS?: number;
  /**
   * The JS alarms this watch sounds. Their blocked state decides when the
   * native alarm may stop: with none passed the native alarm never hands
   * over, which is the safe reading of "no JS alarm is known to be audible".
   */
  alarms?: readonly NativeAnchorAlarm[];
  /**
   * The app's fix feed, reported to the native watch so an external GPS
   * doesn't read as silence. Omitted in tests that don't exercise it.
   */
  navManager?: Pick<NavigationDataManager, "subscribe">;
  /** Foreground test; defaults to the document's visibility. */
  isForeground?: () => boolean;
  /** Clock override for tests. */
  now?: () => number;
}

/** Geometry the native side needs; a change means "re-push". */
function geometryKey(snap: AnchorWatchSnapshot): string {
  return `${snap.anchor.lat},${snap.anchor.lon},${snap.radiusM},${snap.warnM}`;
}

/**
 * Wire the manager to the native watch. Safe to call once at startup, before
 * or after {@link AnchorWatchManager.restore} — restore() notifies, which
 * pushes the restored watch down.
 *
 * Alarm handoff: the native alarm is the one that survives a suspended
 * WebView, so it keeps sounding until this side proves it is making noise
 * itself. A WebView returning from suspension has a suspended AudioContext
 * and beats silently until a user gesture unlocks it, so "the app is in the
 * foreground" is not proof — `CobAlarm.isBlocked()` is. While it is blocked
 * both sides sound (a moment of overlap is a far better failure than a
 * silenced anchor alarm); the handoff happens on the blocked→unblocked edge
 * when the user finally taps.
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
  const alarms = options.alarms ?? [];
  const now = options.now ?? (() => Date.now());
  const isForeground =
    options.isForeground ??
    (() =>
      typeof document === "undefined" || document.visibilityState !== "hidden");

  // Native shells older than these methods reject the call; a dead native
  // watch must never take the JS one down with it.
  const ignore = (err: unknown) => console.warn("native anchor watch", err);

  let pushedGeometry: string | null = null;
  let wasAcknowledged = false;
  let armed = false;
  let alarming = false;
  /** The native alarm has been told to stop sounding for this alarm event. */
  let handedOff = false;
  let lastExternalFixReport = 0;

  const tryHandOff = (): void => {
    if (!alarming || handedOff || !isForeground()) return;
    if (alarms.length === 0 || alarms.some((a) => a.isBlocked())) return;
    handedOff = true;
    plugin.handOffAnchorAlarm().catch(ignore);
  };

  manager.subscribe((snap) => {
    if (!snap) {
      wasAcknowledged = false;
      armed = false;
      alarming = false;
      handedOff = false;
      if (pushedGeometry === null) return;
      pushedGeometry = null;
      plugin.clearAnchorWatch().catch(ignore);
      return;
    }
    armed = true;
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
    alarming = snap.alarming;
    // The next alarm event has to earn its own handoff.
    if (!alarming) handedOff = false;
    tryHandOff();
  });

  // The user tapping to unlock audio is exactly the moment the JS alarm
  // becomes audible, and it arrives on this edge rather than as a snapshot.
  for (const alarm of alarms) alarm.onBlockedChange(() => tryHandOff());

  options.navManager?.subscribe(() => {
    if (!armed) return;
    if (now() - lastExternalFixReport < EXTERNAL_FIX_REPORT_MS) return;
    lastExternalFixReport = now();
    plugin.noteExternalFix().catch(ignore);
  });

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      // Going hidden hands the alarm back: the native side restarts its own
      // audio, so returning has to hand off again.
      if (document.visibilityState === "hidden") handedOff = false;
      else tryHandOff();
    });
  }

  plugin
    .addListener("anchorAlarm", (data) => manager.noteNativeAlarm(data.kind))
    .catch(ignore);
}
