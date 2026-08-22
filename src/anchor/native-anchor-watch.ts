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
 * It also answers the question the app cannot answer for itself — whether
 * that native watch is actually seeing the boat, i.e. whether there is any
 * screen-off cover at all (see {@link assessScreenOffCover}).
 *
 * Native-only: on web every call is skipped, so the JS watch stands alone.
 */

import { Capacitor } from "@capacitor/core";
import type { CobAlarm } from "../cob/CobAlarm";
import type { NavigationDataManager } from "../navigation/NavigationDataManager";
import {
  type AnchorWatchNativeStatus,
  BackgroundGPS,
} from "../plugins/BackgroundGPS";
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
  getAnchorWatchStatus(): Promise<AnchorWatchNativeStatus>;
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
  "subscribe" | "noteNativeAlarm" | "getState"
>;

/** Handle returned by {@link connectNativeAnchorWatch}. */
export interface NativeAnchorWatchHandle {
  /**
   * Push the JS side's current armed state down, adopting or ending a native
   * watch that outlived it. Call once after {@link AnchorWatchManager.restore}:
   * the native watch now survives a process kill on its own, so the two sides
   * can start up disagreeing, and JS — which owns the geometry, the storage
   * slot and the user's disarm — is the authority that settles it.
   */
  reconcile(): void;
}

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
): NativeAnchorWatchHandle {
  const isNative = options.isNative ?? Capacitor.isNativePlatform();
  if (!isNative) return { reconcile: () => {} };
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

  /** What was last pushed down: a geometry key, "cleared", or nothing yet. */
  let pushed: string | "cleared" | null = null;
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

  const apply = (snap: AnchorWatchSnapshot | null, force = false): void => {
    if (!snap) {
      wasAcknowledged = false;
      armed = false;
      alarming = false;
      handedOff = false;
      // Nothing was ever armed this session, so ordinarily there is nothing
      // to clear — except on the reconcile pass, where the point is exactly
      // to end a native watch that outlived the JS one.
      if (pushed === null && !force) return;
      if (pushed === "cleared") return;
      pushed = "cleared";
      plugin.clearAnchorWatch().catch(ignore);
      return;
    }
    armed = true;
    const key = geometryKey(snap);
    if (key !== pushed) {
      pushed = key;
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
  };

  manager.subscribe((snap) => apply(snap));

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

  return { reconcile: () => apply(manager.getState(), true) };
}

// --- Screen-off cover ------------------------------------------------------

/**
 * How long the app gives the native watch to come up — the foreground service
 * to start and adopt the watch, then its GNSS to produce a first fix — before
 * calling the screen-off cover missing. A cold chip under a marina's masts can
 * take tens of seconds; nothing legitimate takes a minute.
 */
export const SCREEN_OFF_COVER_GRACE_MS = 60_000;

/** Whether the watch survives the screen going off, and if not, why not. */
export type ScreenOffCover =
  | { state: "unknown" }
  | { state: "covered" }
  | { state: "none"; reason: "permission" };

/**
 * The one disclosure worth making, because it is the one the user can act
 * on. Everything else the native side can report about itself — no GNSS
 * chip, no fix, service still starting — describes the redundant watchdog,
 * not the watch: field testing showed the JS watch running through
 * screen-off and a closed cover on a device with no GNSS at all, because an
 * armed watch keeps a foreground service and wake lock that hold the
 * process awake. Reporting those states would frighten the user about a
 * watch that is working, with nothing to do about it.
 */
export const SCREEN_OFF_COVER_TEXT: Record<
  Extract<ScreenOffCover, { state: "none" }>["reason"],
  string
> = {
  permission:
    "Location permission is off — the watch may stop when the screen is off. Turn it on in Settings.",
};

/**
 * Read a native status as a cover verdict.
 *
 * The silent-failure case this exists for: the service runs, holds its wake
 * lock, and never sees a position — a tablet with no GPS hardware, a declined
 * permission, an antenna below decks. It raises no GPS-loss alarm in that
 * state by design (`hadFix` false: a watch never proven to work has no basis
 * for alarming on silence, and alarming two minutes after every screen-off
 * would be intolerable), so nothing but this tells the user they are not
 * covered.
 *
 * "unknown" is the honest answer while the watch is still coming up, and on
 * any platform or shell that cannot answer — never a warning we can't stand
 * behind. Two of the four failures are decisive as soon as they can be read
 * (a denied permission, a device with no GNSS at all — waiting changes
 * neither); the other two are indistinguishable from a watch that is still
 * coming up, so they wait out {@link SCREEN_OFF_COVER_GRACE_MS} first.
 *
 * @param armedForMs how long the JS watch has been armed. The service takes a
 *   second or two to start and adopt the watch, during which it honestly reads
 *   as "not running" — reported immediately, that flashed a false "no
 *   screen-off cover" on every arm. Callers that don't track it get the
 *   immediate verdict.
 */
export function assessScreenOffCover(
  status: AnchorWatchNativeStatus | null,
  armedForMs: number = Number.POSITIVE_INFINITY,
): ScreenOffCover {
  if (!status) return { state: "unknown" };
  // The only actionable state: without location permission the foreground
  // service cannot start, and it is that service — not its GNSS fixes —
  // that keeps the process awake for the JS watch while the screen is off.
  // Granting permission is something the user can actually do.
  if (!status.locationPermission) {
    return armedForMs < SCREEN_OFF_COVER_GRACE_MS
      ? { state: "unknown" }
      : { state: "none", reason: "permission" };
  }
  return { state: "covered" };
}

/** The panel's disclosure line, or null when there is nothing to disclose. */
export function screenOffCoverLine(
  status: AnchorWatchNativeStatus | null,
  armedForMs?: number,
): string | null {
  const cover = assessScreenOffCover(status, armedForMs);
  return cover.state === "none" ? SCREEN_OFF_COVER_TEXT[cover.reason] : null;
}

/**
 * Ask the native service how the screen-off watch is doing. Resolves null on
 * web and on any native shell that can't answer — an unanswered question is
 * not evidence of a problem, and this must never be the thing that shows a
 * false warning over a working watch.
 */
export async function getNativeAnchorStatus(
  options: {
    plugin?: Pick<NativeAnchorPlugin, "getAnchorWatchStatus">;
    isNative?: boolean;
  } = {},
): Promise<AnchorWatchNativeStatus | null> {
  const isNative = options.isNative ?? Capacitor.isNativePlatform();
  if (!isNative) return null;
  const plugin = options.plugin ?? (BackgroundGPS as NativeAnchorPlugin);
  try {
    return await plugin.getAnchorWatchStatus();
  } catch (err) {
    console.warn("native anchor watch status", err);
    return null;
  }
}
