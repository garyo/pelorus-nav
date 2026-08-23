/**
 * Keeps the native (Android foreground service) anchor watch in step with
 * the JS one, and folds native alarms back into it.
 *
 * The JS state machine only runs while the WebView is awake: backgrounded
 * JS is suspended and passive GPS mode silences the native→JS bridge, so
 * overnight the service is the only thing watching. This module pushes the
 * armed geometry down on arm / anchor move / radius change, clears it on
 * disarm, forwards acknowledgments, reconciles the retained `anchorAlarm`
 * event that arrives when the WebView resumes. The alarm *sound* belongs to
 * the service on every native platform — see native-anchor-alarm.ts.
 *
 * While armed it also beats a liveness heartbeat down every
 * {@link KEEPALIVE_INTERVAL_MS}, which is the arbiter of alarm authority:
 * the JS watch is the authoritative detector while its beats are fresh, and
 * the native detector announces its own alarms only once they go stale (or
 * never started — a watch restored after a process kill). Each beat carries
 * this side's own measured interval, so the native diag log can tell WebView
 * timer *throttling* (beats arrive late) from an outright *freeze* (no
 * beats) — the direct measurement of screen-off JS liveness we could
 * previously only guess at from GPS log gaps. Plain setInterval on purpose:
 * being throttled is precisely the signal.
 *
 * It also answers the questions the app cannot answer for itself — whether
 * that native watch is actually seeing the boat, and whether the alarm stream
 * is loud enough for anyone to hear it (see {@link armedAdvisoryLine}).
 *
 * Native-only: on web every call is skipped, so the JS watch stands alone.
 */

import { Capacitor } from "@capacitor/core";
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
  type WatchFailureReason,
} from "./AnchorWatchManager";

/**
 * How often a fix from the app's own GPS is reported to the native watch.
 * Only the GPS-loss deadline (2 min by default) depends on it, so this can
 * be far slower than the fix rate.
 */
const EXTERNAL_FIX_REPORT_MS = 10_000;

/**
 * Heartbeat period while a watch is armed. The native side calls the beats
 * stale after 30 s (three missed), at which point alarm authority passes to
 * its own detector.
 */
export const KEEPALIVE_INTERVAL_MS = 10_000;

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
  noteExternalFix(): Promise<void>;
  anchorKeepalive(options: { sinceLastMs: number }): Promise<void>;
  getAnchorWatchStatus(): Promise<AnchorWatchNativeStatus>;
  addListener(
    eventName: "anchorAlarm",
    listenerFunc: (data: {
      kind: AnchorAlarmKind;
      distanceM: number;
      at: number;
      /** Watch-failure only: which failure to check. */
      reason?: WatchFailureReason;
    }) => void,
  ): Promise<unknown>;
  addListener(
    eventName: "anchorAlarmCleared",
    listenerFunc: (data: { kind: AnchorAlarmKind }) => void,
  ): Promise<unknown>;
  addListener(
    eventName: "anchorAcknowledged",
    listenerFunc: () => void,
  ): Promise<unknown>;
}

/** The manager surface this module needs; keeps the unit tests light. */
export type NativeAnchorManager = Pick<
  AnchorWatchManager,
  | "subscribe"
  | "noteNativeAlarm"
  | "noteNativeAlarmCleared"
  | "getState"
  | "acknowledge"
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
  /** Stop the keepalive heartbeat (tests; pairs with AnchorWatchManager.dispose). */
  dispose(): void;
}

export interface NativeAnchorWatchOptions {
  plugin?: NativeAnchorPlugin;
  /** Defaults to Capacitor's platform check; tests pass it explicitly. */
  isNative?: boolean;
  alarmDelayS?: number;
  gpsLossAlarmS?: number;
  /**
   * The app's fix feed, reported to the native watch so an external GPS
   * doesn't read as silence. Omitted in tests that don't exercise it.
   */
  navManager?: Pick<NavigationDataManager, "subscribe">;
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
 */
export function connectNativeAnchorWatch(
  manager: NativeAnchorManager,
  options: NativeAnchorWatchOptions = {},
): NativeAnchorWatchHandle {
  const isNative = options.isNative ?? Capacitor.isNativePlatform();
  if (!isNative) return { reconcile: () => {}, dispose: () => {} };
  const plugin = options.plugin ?? (BackgroundGPS as NativeAnchorPlugin);
  const alarmDelayS = options.alarmDelayS ?? DEFAULT_ALARM_DELAY_S;
  const gpsLossAlarmS = options.gpsLossAlarmS ?? DEFAULT_GPS_LOSS_ALARM_S;
  const now = options.now ?? (() => Date.now());

  // Native shells older than these methods reject the call; a dead native
  // watch must never take the JS one down with it.
  const ignore = (err: unknown) => console.warn("native anchor watch", err);

  /** What was last pushed down: a geometry key, "cleared", or nothing yet. */
  let pushed: string | "cleared" | null = null;
  let wasAcknowledged = false;
  let wasAlarmKind: AnchorAlarmKind | null = null;
  let armed = false;
  let lastExternalFixReport = 0;

  // --- Liveness heartbeat: runs exactly while armed. Its staleness (30 s on
  // the native side) is what hands alarm authority to the native detector,
  // and sinceLastMs is the throttling-vs-freezing measurement — so the beat
  // must be dumb: a plain interval, never compensated or self-corrected.
  let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  let lastBeatMs: number | null = null;
  let lastEventBeatMs = 0;
  let keepaliveWarned = false;
  const beat = (): void => {
    const t = now();
    const sinceLastMs = lastBeatMs === null ? 0 : t - lastBeatMs;
    lastBeatMs = t;
    plugin.anchorKeepalive({ sinceLastMs }).catch((err) => {
      // An older shell rejects every beat; one warning, then silence — the
      // native side simply keeps full alarm authority, as before keepalives.
      if (keepaliveWarned) return;
      keepaliveWarned = true;
      console.warn("native anchor keepalive", err);
    });
  };
  const startKeepalive = (): void => {
    if (keepaliveTimer !== null) return;
    lastBeatMs = null;
    // Immediate first beat (sinceLastMs 0): the native side must know JS is
    // alive from the moment of arming, not one interval later.
    beat();
    keepaliveTimer = setInterval(beat, KEEPALIVE_INTERVAL_MS);
  };
  const stopKeepalive = (): void => {
    if (keepaliveTimer === null) return;
    clearInterval(keepaliveTimer);
    keepaliveTimer = null;
  };

  const apply = (snap: AnchorWatchSnapshot | null, force = false): void => {
    if (!snap) {
      wasAcknowledged = false;
      armed = false;
      stopKeepalive();
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
    startKeepalive();
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
    // in-app one. The edge test alone misses one case: `acknowledged` is
    // the OR of the per-kind flags, so a second alarm acknowledged while an
    // earlier kind's ack still stands shows no edge — an alarm ending with
    // the flag up is pushed too. Duplicates are safe (native acknowledge is
    // a no-op when nothing is alarming).
    if (
      snap.acknowledged &&
      (!wasAcknowledged || (wasAlarmKind !== null && snap.alarmKind === null))
    ) {
      plugin.acknowledgeAnchorAlarm().catch(ignore);
    }
    wasAcknowledged = snap.acknowledged;
    wasAlarmKind = snap.alarmKind;
  };

  manager.subscribe((snap) => apply(snap));

  options.navManager?.subscribe((fix) => {
    if (!armed) return;
    // A delivered fix is also proof of life. Chromium can throttle a hidden
    // page's timers while still executing bridge-delivered events, so a
    // heartbeat driven only by setInterval could read as dead while JS is in
    // fact processing every fix. Beat here too, floored so the event path
    // can't spam faster than half the timer cadence.
    if (now() - lastEventBeatMs >= KEEPALIVE_INTERVAL_MS / 2) {
      lastEventBeatMs = now();
      beat();
    }
    // A simulator fix is not the boat: reporting it would hold off the
    // native GPS-loss alarm (and clear a ringing one) on a fiction. The
    // beat above still counts — the JS watch really is running, it is just
    // watching data that must never vouch for the real position feed.
    if (fix?.source === "simulator") return;
    if (now() - lastExternalFixReport < EXTERNAL_FIX_REPORT_MS) return;
    lastExternalFixReport = now();
    plugin.noteExternalFix().catch(ignore);
  });

  // Retained events replay the moment a listener registers — which is before
  // the manager has restored its slot after a cold start. An event adopted
  // while the manager is unarmed is silently dropped, and retained events
  // are consumed on delivery, so the loss would be permanent: a native
  // watch-failure or gps-loss from before a process kill would never reach
  // the UI. Until reconcile() runs (after restore), events for a
  // not-yet-armed manager are held and replayed then, in arrival order.
  let reconciled = false;
  const heldEvents: Array<() => void> = [];
  const deliver = (event: () => void): void => {
    if (reconciled || manager.getState() !== null) event();
    else heldEvents.push(event);
  };

  plugin
    .addListener("anchorAlarm", (data) =>
      deliver(() => manager.noteNativeAlarm(data.kind, data.reason)),
    )
    .catch(ignore);

  // Any kind whose raise was announced natively: watch-failure conditions
  // (fix arrived, keepalive resumed, charger plugged in) are invisible to
  // JS, and a drag or GPS loss that self-cleared while the WebView was
  // frozen must cancel its queued raise instead of blasting a stale siren
  // on thaw. Retained like the raise it undoes.
  plugin
    .addListener("anchorAlarmCleared", (data) =>
      deliver(() => manager.noteNativeAlarmCleared(data.kind)),
    )
    .catch(ignore);

  // The notification's Silence action acknowledged natively; without this the
  // app UI keeps showing an alarm the user already silenced. No loop risk:
  // native fires it only for the notification path (never in answer to this
  // side's acknowledgeAnchorAlarm), and acknowledge() is a no-op when nothing
  // is alarming, so even a stray retained event settles harmlessly.
  plugin
    .addListener("anchorAcknowledged", () =>
      deliver(() => manager.acknowledge()),
    )
    .catch(ignore);

  return {
    reconcile: () => {
      apply(manager.getState(), true);
      reconciled = true;
      while (heldEvents.length > 0) heldEvents.shift()?.();
    },
    dispose: stopKeepalive,
  };
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
  | { state: "none"; reason: "permission" | "no-fix" | "service" };

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
  service:
    "The watch's background service is not running — dragging may go undetected once the screen is off. Disarm and re-arm the watch.",
  "no-fix":
    "This device's GPS has no fix — dragging may go undetected once the screen is off. Move where the sky is clear.",
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
  // Whatever else the status claims, a stopped service means no wake lock,
  // no native detector, and no meta-alarm: nothing survives the screen
  // going off. Past the arming grace this is never "covered".
  if (!status.serviceRunning) {
    return armedForMs < SCREEN_OFF_COVER_GRACE_MS
      ? { state: "unknown" }
      : { state: "none", reason: "service" };
  }
  // A device with no GNSS receiver has no native watchdog to wait on, and
  // no user action will create one. There the JS watch — fed by the app's
  // external GPS, held awake by the foreground service, wake lock, and
  // renderer pin — is the screen-off watch, and the watch-failure alarm
  // announces if it ever stops. A "no fix" warning beside a healthy
  // external-GPS readout is a contradiction, and its advice (clear sky)
  // cannot help.
  if (status.gnssAvailable === false) return { state: "covered" };
  // On a device with its own GNSS, the background watch is the detector of
  // record when the WebView is throttled or frozen. Until that GNSS has
  // produced a fix, the redundancy is missing, and the user can act on
  // that by moving where the sky is clear.
  if (status.hadFix === false) {
    return armedForMs < SCREEN_OFF_COVER_GRACE_MS
      ? { state: "unknown" }
      : { state: "none", reason: "no-fix" };
  }
  return { state: "covered" };
}

/** The cover half of the armed view's disclosure line. */
export function screenOffCoverLine(
  status: AnchorWatchNativeStatus | null,
  armedForMs?: number,
): string | null {
  const cover = assessScreenOffCover(status, armedForMs);
  return cover.state === "none" ? SCREEN_OFF_COVER_TEXT[cover.reason] : null;
}

// --- Alarm audibility ------------------------------------------------------

/**
 * Alarm-stream volume below which the alarm is worth a word, as a fraction of
 * the device's maximum.
 *
 * Android stream volume is roughly logarithmic, so a quarter of the scale is
 * far below a quarter of the loudness: on a 15-step phone that is index 3,
 * about the level of quiet speech from a phone speaker and no use at all
 * through a closed cabin door. The measured failure that prompted this was
 * 2 of 15 (13%) on the media stream, so the threshold has to sit clearly
 * above it; higher than a quarter would start nagging people who deliberately
 * run a moderate alarm level in a quiet boat.
 *
 * The service raises the stream to an audible floor while the alarm actually
 * sounds, so this is a disclosure rather than the whole defence — but Do Not
 * Disturb can refuse that raise, which is exactly when the user needs to have
 * been told.
 */
export const LOW_ALARM_VOLUME = 0.25;

export const ALARM_VOLUME_TEXT = {
  low: "Alarm volume is low — you may not hear the alarm.",
  muted: "Alarm volume is off — you may not hear the alarm.",
};

/**
 * The alarm-audibility half of the line; null when it's fine or unknown.
 * With a user-chosen alarm volume the stream level no longer predicts the
 * alarm's loudness (the service sets the stream to the choice), so the
 * choice itself is what gets judged; a muted stream still wins — muting can
 * defeat the raise entirely.
 */
export function alarmVolumeLine(
  status: AnchorWatchNativeStatus | null,
  userVolume?: number,
): string | null {
  if (!status) return null;
  if (status.alarmVolumeMuted) return ALARM_VOLUME_TEXT.muted;
  if (userVolume !== undefined) {
    return userVolume < LOW_ALARM_VOLUME ? ALARM_VOLUME_TEXT.low : null;
  }
  const volume = status.alarmVolume;
  // Absent on older shells and on any device that can't report it — an
  // unanswered question is never a warning.
  if (typeof volume !== "number" || volume < 0) return null;
  return volume < LOW_ALARM_VOLUME ? ALARM_VOLUME_TEXT.low : null;
}

/**
 * Everything the armed view has to disclose about this watch, as one line:
 * both halves state a standing condition the user can act on, and both are
 * rare enough that the two together are still a line rather than a wall.
 * Null when there is nothing to say.
 */
export function armedAdvisoryLine(
  status: AnchorWatchNativeStatus | null,
  armedForMs?: number,
  userVolume?: number,
): string | null {
  const parts = [
    screenOffCoverLine(status, armedForMs),
    alarmVolumeLine(status, userVolume),
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" ") : null;
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
