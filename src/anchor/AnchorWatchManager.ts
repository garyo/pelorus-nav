/**
 * Anchor-watch state machine — the single source of truth while anchored.
 *
 * Armed with an anchor position and alarm radius, it evaluates every GPS fix:
 * a warning ring sits a fixed distance *inside* the alarm radius (consistent
 * regardless of circle size), an exit beyond the radius alarms only after a
 * hysteresis delay (re-entry during the delay cancels), and sustained GPS
 * staleness raises its own distinct alarm — a dead sensor must never look
 * like a safe boat. Acknowledging an alarm silences it but keeps the watch
 * armed: re-exit after re-entry, or further drag beyond the acknowledged
 * distance, alarms again. The armed watch persists to a storage slot so a
 * restart mid-watch (or mid-alarm) resumes seamlessly.
 *
 * Drag detection uses fix timestamps, not wall-clock assumptions, so the
 * simulator drives it deterministically; the 1 s staleness poll runs only
 * while armed. Dependencies are injected so the state machine is
 * unit-testable with fakes. This is the JS-visible detection path; screen-off
 * detection is mirrored natively (see docs/anchor-watch-design.md).
 */

import type { CobAlarm } from "../cob/CobAlarm";
import type { NavigationData } from "../navigation/NavigationData";
import type { NavigationDataManager } from "../navigation/NavigationDataManager";
import { haversineDistanceNM, initialBearingDeg } from "../utils/coordinates";
import {
  defaultBrowserStorage,
  type StorageLike,
} from "../utils/json-storage-slot";
import { NM_TO_METERS } from "../utils/units";
import {
  type AnchorScatterPoint,
  anchorWatchSlot,
  type PersistedAnchorWatchState,
  SCATTER_MAX_POINTS,
} from "./anchor-state";

export const DEFAULT_WARN_M = 8;
export const DEFAULT_ALARM_DELAY_S = 15;
export const DEFAULT_GPS_LOSS_ALARM_S = 120;

/**
 * Continuous time back inside the ring before an acknowledged drag event
 * stands down (re-arming the full alarm for later excursions). Mirrors
 * ANCHOR_ACK_RESET_INSIDE_MS in AnchorWatch.kt.
 */
export const ACK_RESET_INSIDE_MS = 60_000;
const DEFAULT_ACCURACY_THRESHOLD_M = 25;
const SCATTER_SAMPLE_INTERVAL_MS = 10_000;
const SCATTER_PERSIST_INTERVAL_MS = 60_000;
const STALENESS_POLL_MS = 1000;

/** Position relative to the rings, or gray when the GPS can't be trusted. */
export type AnchorZone = "ok" | "warn" | "outside" | "gray";

/** GPS trust level: fresh+accurate / poor accuracy / stale / lost (alarm-worthy). */
/**
 * "waiting" is the pre-acquisition state: armed, but no fix has arrived yet
 * this session, so the watch has never been proven to work. It is distinct
 * from "lost" (a watch that worked and went blind) because only the latter
 * warrants waking the crew.
 */
export type AnchorGpsState = "ok" | "poor" | "stale" | "lost" | "waiting";

export type AnchorAlarmKind = "drag" | "gps-loss" | "watch-failure";

/**
 * Why a watch-failure alarm fired. "nothing-watching": the JS watch went
 * silent and the native detector never had a GNSS fix this watch — nobody is
 * watching the boat. "device-battery": the watching device's battery is low
 * and not charging. Both are detected natively only (they matter precisely
 * when the app may be asleep); JS adopts them via {@link
 * AnchorWatchManager.noteNativeAlarm} and is told when they end via
 * {@link AnchorWatchManager.noteNativeAlarmCleared}.
 */
export type WatchFailureReason = "nothing-watching" | "device-battery";

export interface AnchorWatchConfig {
  /** Continuous seconds outside the radius before the drag alarm fires. */
  alarmDelayS: number;
  /** Sustained fix staleness before the GPS-loss alarm fires, seconds. */
  gpsLossAlarmS: number;
  /** Horizontal accuracy worse than this counts as insufficient GPS (gray). */
  accuracyThresholdM: number;
}

export interface AnchorArmParams {
  lat: number;
  lon: number;
  radiusM: number;
  /** Warning-ring inset from the alarm radius; defaults to {@link DEFAULT_WARN_M}. */
  warnM?: number;
}

export interface AnchorWatchSnapshot {
  armedAt: number;
  anchor: { lat: number; lon: number };
  radiusM: number;
  warnM: number;
  /** Effective warning-ring radius (inset clamped for small circles). */
  warnRingM: number;
  zone: AnchorZone;
  /** An alarm is currently sounding (drag, GPS-loss, or watch-failure). */
  alarming: boolean;
  /** The most urgent active alarm: drag > gps-loss > watch-failure. */
  alarmKind: AnchorAlarmKind | null;
  /** Why the watch-failure alarm is up; null unless one is active. */
  watchFailureReason: WatchFailureReason | null;
  /** An alarm was silenced by the user and its trigger still holds. */
  acknowledged: boolean;
  /**
   * Seconds left in the current excursion before the drag alarm fires, or
   * null when not counting down. The countdown restarts whenever a fix
   * lands back inside the radius, which is what makes GPS jitter near the
   * boundary look like nothing happening — so it is surfaced.
   */
  alarmInS: number | null;
  muted: boolean;
  /** Distance from the last known fix to the anchor; null before any fix. */
  distanceM: number | null;
  /** Bearing from the vessel to the anchor (dinghy-return aid); null before any fix. */
  bearingDeg: number | null;
  gpsState: AnchorGpsState;
  scatter: readonly AnchorScatterPoint[];
}

export type AnchorWatchChangeCallback = (
  state: AnchorWatchSnapshot | null,
) => void;

export interface AnchorWatchManagerDeps {
  navManager: Pick<
    NavigationDataManager,
    "getLastData" | "isFixStale" | "subscribe" | "unsubscribe"
  >;
  /** Drag alarm (standard cadence). */
  alarm: Pick<CobAlarm, "start" | "stop" | "setMuted">;
  /**
   * GPS-loss alarm — a separate instance so lost GPS never sounds like a
   * drag. Wiring constructs it with CobAlarm's distinct-cadence options
   * (a plain `new CobAlarm()` works until those land).
   */
  gpsLossAlarm: Pick<CobAlarm, "start" | "stop" | "setMuted">;
  /**
   * Watch-failure meta-alarm — gentler chirps meaning "the watch itself is
   * compromised, check it". Only ever started by {@link noteNativeAlarm}:
   * its triggers are native-only.
   */
  watchFailureAlarm: Pick<CobAlarm, "start" | "stop" | "setMuted">;
  config?: Partial<AnchorWatchConfig>;
  /** Clock override for tests. */
  now?: () => number;
  /** Storage override for tests; defaults to localStorage. */
  storage?: StorageLike | null;
}

/**
 * Warning-ring radius: `warnM` inside the alarm radius, clamped to never
 * come inside half the radius so tiny circles keep a usable ok zone.
 */
export function warnRingRadiusM(radiusM: number, warnM: number): number {
  return Math.max(radiusM - warnM, radiusM / 2);
}

/** Mutable per-watch state; exists exactly while armed. */
interface ArmedState {
  armedAt: number;
  anchor: { lat: number; lon: number };
  radiusM: number;
  warnM: number;
  muted: boolean;
  scatter: AnchorScatterPoint[];
  lastFix: NavigationData | null;
  /** Fix timestamp of the first fix in the current outside excursion. */
  outsideSinceTs: number | null;
  /** When the boat came back inside, for the ack-reset dwell; null outside. */
  insideSinceTs: number | null;
  dragAlarming: boolean;
  /** Drag alarm silenced by the user while still outside. */
  dragAcknowledged: boolean;
  /** Distance to the anchor when the drag alarm was acknowledged. */
  distanceAtAckM: number;
  gpsLossAlarming: boolean;
  gpsLossAcknowledged: boolean;
  /**
   * Watch-failure meta-alarm, adopted from the native side; JS never raises
   * or clears it on its own evidence — see noteNativeAlarm/-Cleared.
   */
  watchFailureAlarming: boolean;
  /** Watch-failure silenced by the user while the condition still holds. */
  watchFailureAcknowledged: boolean;
  watchFailureReason: WatchFailureReason | null;
  /** A fix has arrived since arming/restore — see AnchorGpsState.waiting. */
  hadFix: boolean;
  /** Wall-clock ms when staleness was first observed by the poll. */
  staleSinceMs: number | null;
  /** Wall-clock ms of the last slot write (scatter-churn throttle). */
  lastPersistMs: number;
}

export class AnchorWatchManager {
  private readonly deps: AnchorWatchManagerDeps;
  private readonly storage: StorageLike | null;
  private readonly now: () => number;
  private readonly config: AnchorWatchConfig;
  private armed: ArmedState | null = null;
  private listeners: AnchorWatchChangeCallback[] = [];
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private watching = false;
  private lastSignature = "disarmed";
  private readonly onFix = (fix: NavigationData) => this.handleFix(fix);

  constructor(deps: AnchorWatchManagerDeps) {
    this.deps = deps;
    this.storage =
      deps.storage !== undefined ? deps.storage : defaultBrowserStorage();
    this.now = deps.now ?? (() => Date.now());
    this.config = {
      alarmDelayS: DEFAULT_ALARM_DELAY_S,
      gpsLossAlarmS: DEFAULT_GPS_LOSS_ALARM_S,
      accuracyThresholdM: DEFAULT_ACCURACY_THRESHOLD_M,
      ...deps.config,
    };
  }

  /**
   * Arm the watch on an anchor position. Arming while already armed replaces
   * the watch (fresh armedAt, cleared scatter and alarm state) — the caller
   * decides whether that needs confirmation.
   */
  arm(params: AnchorArmParams): void {
    if (this.armed) this.stopAlarms(this.armed);
    this.armed = {
      armedAt: this.now(),
      anchor: { lat: params.lat, lon: params.lon },
      radiusM: params.radiusM,
      warnM: params.warnM ?? DEFAULT_WARN_M,
      muted: false,
      scatter: [],
      lastFix: this.deps.navManager.getLastData(),
      outsideSinceTs: null,
      insideSinceTs: null,
      dragAlarming: false,
      dragAcknowledged: false,
      distanceAtAckM: 0,
      gpsLossAlarming: false,
      gpsLossAcknowledged: false,
      watchFailureAlarming: false,
      watchFailureAcknowledged: false,
      watchFailureReason: null,
      hadFix: !this.deps.navManager.isFixStale(),
      staleSinceMs: null,
      lastPersistMs: this.now(),
    };
    const fix = this.armed.lastFix;
    if (fix) {
      this.appendScatter(this.armed, fix);
      this.evaluate(this.armed, fix);
    }
    this.persist(this.armed);
    this.startWatching();
    this.notify();
  }

  /** End the watch: stop alarms and the poll, clear the slot. */
  disarm(): void {
    const armed = this.armed;
    if (!armed) return;
    this.armed = null;
    this.stopAlarms(armed);
    this.stopWatching();
    anchorWatchSlot.clear(this.storage);
    this.notify();
  }

  /** Move the anchor (drag-to-adjust). The excursion timer restarts. */
  updateAnchor(lat: number, lon: number): void {
    const armed = this.armed;
    if (!armed || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
    armed.anchor = { lat, lon };
    this.reevaluateGeometry(armed);
  }

  /** Change the alarm radius. The excursion timer restarts. */
  updateRadius(radiusM: number): void {
    const armed = this.armed;
    if (!armed || !Number.isFinite(radiusM) || radiusM <= 0) return;
    armed.radiusM = radiusM;
    this.reevaluateGeometry(armed);
  }

  /**
   * Silence the current alarm event; the watch stays armed. A drag alarm
   * re-fires if the vessel re-enters and exits again, or — still outside —
   * drags a further warnM beyond the distance at acknowledgment.
   */
  acknowledge(): void {
    const armed = this.armed;
    if (!armed) return;
    let changed = false;
    if (armed.dragAlarming) {
      this.deps.alarm.stop();
      armed.dragAlarming = false;
      armed.dragAcknowledged = true;
      armed.distanceAtAckM = armed.lastFix
        ? this.distanceMeters(armed, armed.lastFix)
        : armed.radiusM;
      changed = true;
    }
    if (armed.gpsLossAlarming) {
      this.deps.gpsLossAlarm.stop();
      armed.gpsLossAlarming = false;
      armed.gpsLossAcknowledged = true;
      changed = true;
    }
    if (armed.watchFailureAlarming) {
      this.deps.watchFailureAlarm.stop();
      armed.watchFailureAlarming = false;
      armed.watchFailureAcknowledged = true;
      changed = true;
    }
    if (!changed) return;
    this.persist(armed);
    this.notify();
  }

  /**
   * Adopt an alarm the native watch raised while this one was suspended.
   *
   * Screen-off detection lives in the Android foreground service, which
   * reports through a retained `anchorAlarm` event delivered when the
   * WebView resumes. From here the alarm behaves exactly like a
   * JS-detected one — including clearing itself the moment its trigger
   * stops holding, so a boat already back inside the radius, or a GPS that
   * has since recovered, does not keep ringing. Watch-failure alarms are the
   * exception: JS cannot observe their triggers, so they clear only via
   * {@link noteNativeAlarmCleared}, an acknowledgment, or disarm.
   */
  noteNativeAlarm(kind: AnchorAlarmKind, reason?: WatchFailureReason): void {
    const armed = this.armed;
    if (!armed) return;
    if (kind === "drag") {
      if (armed.dragAlarming) return;
      this.startDragAlarm(armed);
    } else if (kind === "gps-loss") {
      if (armed.gpsLossAlarming) return;
      // Native only alarms on loss after a fix, so the watch is proven —
      // adopting that keeps the state out of "waiting" while alarming.
      armed.hadFix = true;
      armed.gpsLossAcknowledged = false;
      armed.gpsLossAlarming = true;
      if (armed.staleSinceMs === null) armed.staleSinceMs = this.now();
      this.deps.gpsLossAlarm.start(armed.muted);
      this.persist(armed);
    } else {
      // Watch-failure: unlike the two above, JS has no evidence of its own
      // to clear it against — it ends via noteNativeAlarmCleared, an
      // acknowledgment, or disarm. A repeat raise after an acknowledgment
      // is a genuine native re-fire (the condition recurred, or the battery
      // fell to critical) and starts the alarm again.
      if (reason) armed.watchFailureReason = reason;
      if (armed.watchFailureAlarming) {
        this.notify();
        return;
      }
      armed.watchFailureAlarming = true;
      armed.watchFailureAcknowledged = false;
      this.deps.watchFailureAlarm.start(armed.muted);
    }
    this.notify();
  }

  /**
   * The native side reports a watch-failure condition ended on its own — a
   * GNSS fix arrived, the JS keepalive resumed, or the charger went in. Only
   * this kind needs the event: drag and GPS-loss clear against evidence JS
   * can see for itself (position, staleness), watch-failure cannot.
   */
  noteNativeAlarmCleared(kind: AnchorAlarmKind): void {
    const armed = this.armed;
    if (!armed) return;
    if (kind === "watch-failure") {
      if (!armed.watchFailureAlarming && !armed.watchFailureAcknowledged) {
        return;
      }
      if (armed.watchFailureAlarming) this.deps.watchFailureAlarm.stop();
      armed.watchFailureAlarming = false;
      armed.watchFailureAcknowledged = false;
      armed.watchFailureReason = null;
      this.notify();
      return;
    }
    // Drag / GPS-loss: the native event pairs with the retained raise, so a
    // thawing WebView replays both and nets to silence instead of sounding
    // an alarm that ended overnight. Safe against live conditions: this
    // side's own detector re-raises from its own evidence within a fix (or
    // one 1 s tick) if the boat really is still outside or still blind.
    if (kind === "gps-loss" && armed.gpsLossAlarming) {
      this.deps.gpsLossAlarm.stop();
      armed.gpsLossAlarming = false;
      this.notify();
      return;
    }
    if (kind === "drag" && armed.dragAlarming) {
      this.deps.alarm.stop();
      armed.dragAlarming = false;
      this.persist(armed);
      this.notify();
    }
  }

  /** Mute/unmute alarm audio for this watch (persists; alarms keep running). */
  setMuted(muted: boolean): void {
    const armed = this.armed;
    if (!armed || armed.muted === muted) return;
    armed.muted = muted;
    this.deps.alarm.setMuted(muted);
    this.deps.gpsLossAlarm.setMuted(muted);
    this.deps.watchFailureAlarm.setMuted(muted);
    this.persist(armed);
    this.notify();
  }

  isArmed(): boolean {
    return this.armed !== null;
  }

  getState(): AnchorWatchSnapshot | null {
    const armed = this.armed;
    if (!armed) return null;
    const fix = armed.lastFix;
    const distanceM = fix ? this.distanceMeters(armed, fix) : null;
    const bearingDeg = fix
      ? initialBearingDeg(
          fix.latitude,
          fix.longitude,
          armed.anchor.lat,
          armed.anchor.lon,
        )
      : null;
    const gpsState = this.gpsState(armed, fix);
    const warnRingM = warnRingRadiusM(armed.radiusM, armed.warnM);
    const zone: AnchorZone =
      gpsState !== "ok" || distanceM === null
        ? "gray"
        : distanceM > armed.radiusM
          ? "outside"
          : distanceM > warnRingM
            ? "warn"
            : "ok";
    // Display priority when several are up: a boat outside its circle beats
    // a lost fix beats a compromised watch.
    const alarmKind: AnchorAlarmKind | null = armed.dragAlarming
      ? "drag"
      : armed.gpsLossAlarming
        ? "gps-loss"
        : armed.watchFailureAlarming
          ? "watch-failure"
          : null;
    // Counted against the wall clock, not the last fix: at anchor the
    // adaptive rate can stretch fixes to tens of seconds apart, and a
    // countdown that only moves on arrival reads as frozen. The alarm
    // itself still triggers on fix timestamps — this is the display of a
    // deadline, not the deadline.
    const alarmInS =
      armed.outsideSinceTs !== null &&
      !armed.dragAlarming &&
      !armed.dragAcknowledged &&
      fix !== null
        ? Math.max(
            0,
            Math.ceil(
              (armed.outsideSinceTs +
                this.config.alarmDelayS * 1000 -
                Math.max(fix.timestamp, this.now())) /
                1000,
            ),
          )
        : null;
    return {
      armedAt: armed.armedAt,
      anchor: { ...armed.anchor },
      radiusM: armed.radiusM,
      warnM: armed.warnM,
      warnRingM,
      zone,
      alarming: alarmKind !== null,
      alarmKind,
      watchFailureReason: armed.watchFailureAlarming
        ? armed.watchFailureReason
        : null,
      acknowledged:
        armed.dragAcknowledged ||
        armed.gpsLossAcknowledged ||
        armed.watchFailureAcknowledged,
      alarmInS,
      muted: armed.muted,
      distanceM,
      bearingDeg,
      gpsState,
      scatter: armed.scatter,
    };
  }

  /**
   * Restore a persisted watch at startup: re-arm, and if a drag alarm was
   * sounding, resume it (respecting mute). The excursion and staleness
   * timers start fresh — the next outside fix or stale poll re-drives them.
   */
  restore(): void {
    const saved = anchorWatchSlot.load(this.storage);
    if (!saved) return;
    this.armed = {
      armedAt: saved.armedAt,
      anchor: { ...saved.anchor },
      radiusM: saved.radiusM,
      warnM: saved.warnM,
      muted: saved.muted,
      scatter: saved.scatter.slice(-SCATTER_MAX_POINTS),
      lastFix: this.deps.navManager.getLastData(),
      outsideSinceTs: null,
      insideSinceTs: null,
      dragAlarming: saved.alarming,
      dragAcknowledged: false,
      distanceAtAckM: 0,
      gpsLossAlarming: false,
      gpsLossAcknowledged: false,
      watchFailureAlarming: false,
      watchFailureAcknowledged: false,
      watchFailureReason: null,
      hadFix: !this.deps.navManager.isFixStale(),
      staleSinceMs: null,
      lastPersistMs: this.now(),
    };
    if (saved.alarming) this.deps.alarm.start(saved.muted);
    this.startWatching();
    this.notify();
  }

  subscribe(cb: AnchorWatchChangeCallback): void {
    this.listeners.push(cb);
  }

  unsubscribe(cb: AnchorWatchChangeCallback): void {
    const idx = this.listeners.indexOf(cb);
    if (idx >= 0) this.listeners.splice(idx, 1);
  }

  /** Detach from the nav feed and silence alarms; the slot stays for restore(). */
  dispose(): void {
    if (this.armed) this.stopAlarms(this.armed);
    this.stopWatching();
    this.listeners.length = 0;
  }

  private handleFix(fix: NavigationData): void {
    const armed = this.armed;
    if (!armed) return;
    armed.lastFix = fix;
    this.clearGpsLoss(armed);
    this.appendScatter(armed, fix);
    this.evaluate(armed, fix);
    this.notify();
  }

  /**
   * Drag detection against one fix. Runs regardless of reported accuracy —
   * a poor fix is still the best position estimate we have, and the radius
   * formula already budgets a GPS margin; the zone shows gray meanwhile.
   */
  private evaluate(armed: ArmedState, fix: NavigationData): void {
    const distanceM = this.distanceMeters(armed, fix);
    if (distanceM > armed.radiusM) {
      armed.insideSinceTs = null;
      if (armed.outsideSinceTs === null) armed.outsideSinceTs = fix.timestamp;
      if (armed.dragAcknowledged) {
        // Still dragging: a further warnM beyond the acknowledged distance
        // overrides the acknowledgment.
        if (distanceM >= armed.distanceAtAckM + armed.warnM) {
          this.startDragAlarm(armed);
        }
      } else if (
        !armed.dragAlarming &&
        fix.timestamp - armed.outsideSinceTs >= this.config.alarmDelayS * 1000
      ) {
        this.startDragAlarm(armed);
      }
    } else {
      armed.outsideSinceTs = null;
      if (armed.dragAlarming) {
        this.deps.alarm.stop();
        armed.dragAlarming = false;
        this.persist(armed);
      }
      if (armed.dragAcknowledged) {
        // The acknowledgment survives boundary flapping (mirrors the native
        // detector): one inside fix at a tide turn is noise, and erasing the
        // ack on it turned every later 15 s excursion into a fresh wake.
        // Only a sustained return inside stands the event down; meanwhile
        // the +warnM rule still alarms on genuine further drag.
        if (armed.insideSinceTs === null) armed.insideSinceTs = fix.timestamp;
        if (fix.timestamp - armed.insideSinceTs >= ACK_RESET_INSIDE_MS) {
          armed.dragAcknowledged = false;
          armed.insideSinceTs = null;
          this.persist(armed);
        }
      }
    }
  }

  /** Anchor or radius changed: restart the excursion timer and re-judge. */
  private reevaluateGeometry(armed: ArmedState): void {
    armed.outsideSinceTs = null;
    if (armed.lastFix) {
      this.evaluate(armed, armed.lastFix);
      if (armed.dragAcknowledged) {
        // Re-baseline the ack distance against the new geometry.
        armed.distanceAtAckM = this.distanceMeters(armed, armed.lastFix);
      }
    }
    this.persist(armed);
    this.notify();
  }

  private startDragAlarm(armed: ArmedState): void {
    armed.dragAlarming = true;
    armed.dragAcknowledged = false;
    this.deps.alarm.start(armed.muted);
    this.persist(armed);
  }

  /** 1 s poll while armed: staleness is time passing, not a fix arriving. */
  private tick(): void {
    const armed = this.armed;
    if (!armed) return;
    if (this.deps.navManager.isFixStale()) {
      if (armed.staleSinceMs === null) armed.staleSinceMs = this.now();
      if (
        armed.hadFix &&
        !armed.gpsLossAlarming &&
        !armed.gpsLossAcknowledged &&
        this.now() - armed.staleSinceMs >= this.config.gpsLossAlarmS * 1000
      ) {
        armed.gpsLossAlarming = true;
        this.deps.gpsLossAlarm.start(armed.muted);
      }
    } else {
      this.clearGpsLoss(armed);
    }
    // Notify only when the derived picture changed — the poll must not spam
    // listeners every second.
    if (this.signature() !== this.lastSignature) this.notify();
  }

  /** Fresh data ends any GPS-loss condition (alarm, ack, staleness timer). */
  private clearGpsLoss(armed: ArmedState): void {
    // Fresh data proves the watch can see; from here a later outage is a
    // genuine loss and may alarm.
    armed.hadFix = true;
    armed.staleSinceMs = null;
    armed.gpsLossAcknowledged = false;
    if (armed.gpsLossAlarming) {
      armed.gpsLossAlarming = false;
      this.deps.gpsLossAlarm.stop();
    }
  }

  private gpsState(
    armed: ArmedState,
    fix: NavigationData | null,
  ): AnchorGpsState {
    if (this.deps.navManager.isFixStale()) {
      if (!armed.hadFix) return "waiting";
      const lost =
        armed.gpsLossAlarming ||
        armed.gpsLossAcknowledged ||
        (armed.staleSinceMs !== null &&
          this.now() - armed.staleSinceMs >= this.config.gpsLossAlarmS * 1000);
      return lost ? "lost" : "stale";
    }
    if (
      fix !== null &&
      fix.accuracy !== null &&
      fix.accuracy > this.config.accuracyThresholdM
    ) {
      return "poor";
    }
    return "ok";
  }

  /** Sample the swing scatter at most once per 10 s (fix time), ring-capped. */
  private appendScatter(armed: ArmedState, fix: NavigationData): void {
    const last = armed.scatter[armed.scatter.length - 1];
    if (last && fix.timestamp - last.t < SCATTER_SAMPLE_INTERVAL_MS) return;
    armed.scatter.push({
      lat: fix.latitude,
      lon: fix.longitude,
      t: fix.timestamp,
    });
    if (armed.scatter.length > SCATTER_MAX_POINTS) {
      armed.scatter.splice(0, armed.scatter.length - SCATTER_MAX_POINTS);
    }
    // Scatter-only slot writes are throttled; state transitions persist
    // immediately elsewhere.
    if (this.now() - armed.lastPersistMs >= SCATTER_PERSIST_INTERVAL_MS) {
      this.persist(armed);
    }
  }

  private distanceMeters(armed: ArmedState, fix: NavigationData): number {
    return (
      haversineDistanceNM(
        fix.latitude,
        fix.longitude,
        armed.anchor.lat,
        armed.anchor.lon,
      ) * NM_TO_METERS
    );
  }

  private stopAlarms(armed: ArmedState): void {
    if (armed.dragAlarming) this.deps.alarm.stop();
    if (armed.gpsLossAlarming) this.deps.gpsLossAlarm.stop();
    if (armed.watchFailureAlarming) this.deps.watchFailureAlarm.stop();
    armed.dragAlarming = false;
    armed.gpsLossAlarming = false;
    armed.watchFailureAlarming = false;
  }

  private startWatching(): void {
    if (this.watching) return;
    this.watching = true;
    this.deps.navManager.subscribe(this.onFix);
    this.pollInterval = setInterval(() => this.tick(), STALENESS_POLL_MS);
  }

  private stopWatching(): void {
    if (!this.watching) return;
    this.watching = false;
    this.deps.navManager.unsubscribe(this.onFix);
    if (this.pollInterval) clearInterval(this.pollInterval);
    this.pollInterval = null;
  }

  private persist(armed: ArmedState): void {
    const saved: PersistedAnchorWatchState = {
      version: 1,
      armedAt: armed.armedAt,
      anchor: { ...armed.anchor },
      radiusM: armed.radiusM,
      warnM: armed.warnM,
      muted: armed.muted,
      alarming: armed.dragAlarming,
      scatter: armed.scatter,
    };
    anchorWatchSlot.save(saved, this.storage);
    armed.lastPersistMs = this.now();
  }

  private signature(
    snap: AnchorWatchSnapshot | null = this.getState(),
  ): string {
    // alarmInS is in the signature so the 1 s poll pushes the excursion
    // countdown every second. Without it the countdown only moved when a
    // fix arrived, and a boat at anchor is exactly when the adaptive rate
    // stretches that interval — leaving the number visibly stuck while an
    // alarm was pending.
    return snap
      ? `${snap.zone}|${snap.gpsState}|${snap.alarmKind}|${snap.alarmInS}`
      : "disarmed";
  }

  private notify(): void {
    const snap = this.getState();
    this.lastSignature = this.signature(snap);
    for (const cb of this.listeners) cb(snap);
  }
}
