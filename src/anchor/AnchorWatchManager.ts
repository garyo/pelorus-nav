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
const DEFAULT_ALARM_DELAY_S = 15;
const DEFAULT_GPS_LOSS_ALARM_S = 120;
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

export type AnchorAlarmKind = "drag" | "gps-loss";

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
  /** An alarm is currently sounding (drag or GPS-loss). */
  alarming: boolean;
  alarmKind: AnchorAlarmKind | null;
  /** An alarm was silenced by the user and its trigger still holds. */
  acknowledged: boolean;
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
  dragAlarming: boolean;
  /** Drag alarm silenced by the user while still outside. */
  dragAcknowledged: boolean;
  /** Distance to the anchor when the drag alarm was acknowledged. */
  distanceAtAckM: number;
  gpsLossAlarming: boolean;
  gpsLossAcknowledged: boolean;
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
      dragAlarming: false,
      dragAcknowledged: false,
      distanceAtAckM: 0,
      gpsLossAlarming: false,
      gpsLossAcknowledged: false,
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
    if (!changed) return;
    this.persist(armed);
    this.notify();
  }

  /** Mute/unmute alarm audio for this watch (persists; alarms keep running). */
  setMuted(muted: boolean): void {
    const armed = this.armed;
    if (!armed || armed.muted === muted) return;
    armed.muted = muted;
    this.deps.alarm.setMuted(muted);
    this.deps.gpsLossAlarm.setMuted(muted);
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
    const alarmKind: AnchorAlarmKind | null = armed.dragAlarming
      ? "drag"
      : armed.gpsLossAlarming
        ? "gps-loss"
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
      acknowledged: armed.dragAcknowledged || armed.gpsLossAcknowledged,
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
      dragAlarming: saved.alarming,
      dragAcknowledged: false,
      distanceAtAckM: 0,
      gpsLossAlarming: false,
      gpsLossAcknowledged: false,
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
      if (armed.dragAlarming || armed.dragAcknowledged) {
        if (armed.dragAlarming) this.deps.alarm.stop();
        armed.dragAlarming = false;
        armed.dragAcknowledged = false;
        this.persist(armed);
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
    armed.dragAlarming = false;
    armed.gpsLossAlarming = false;
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
    return snap
      ? `${snap.zone}|${snap.gpsState}|${snap.alarmKind}`
      : "disarmed";
  }

  private notify(): void {
    const snap = this.getState();
    this.lastSignature = this.signature(snap);
    for (const cb of this.listeners) cb(snap);
  }
}
