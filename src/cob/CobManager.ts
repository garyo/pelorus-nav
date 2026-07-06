/**
 * Crew-overboard event manager — the single source of truth for COB state.
 *
 * One event at a time: activation captures the current fix, drops a durable
 * COB waypoint, starts goto-navigation back to it, and kicks off the side
 * effects (alarm, wake lock, track recording). The event persists to
 * localStorage so a crash or reload mid-emergency restores everything.
 *
 * Dependencies are injected so the state machine is unit-testable with fakes.
 */

import type { StandaloneWaypoint } from "../data/Waypoint";
import type { ActiveNavigationManager } from "../navigation/ActiveNavigation";
import type { NavigationDataManager } from "../navigation/NavigationDataManager";
import {
  defaultBrowserStorage,
  type StorageLike,
} from "../utils/json-storage-slot";
import { generateUUID } from "../utils/uuid";
import type { CobAlarm } from "./CobAlarm";
import {
  cobStateSlot,
  cobWaypointName,
  type PersistedCobState,
  resolvedNotes,
} from "./cob-state";

export type CobActivationResult = "ok" | "ok-stale" | "no-fix";

export interface CobRuntimeState {
  startedAt: number;
  waypoint: StandaloneWaypoint;
  muted: boolean;
  staleAtDrop: boolean;
  fixAgeAtDropMs: number;
}

export type CobChangeCallback = (state: CobRuntimeState | null) => void;

export interface CobManagerDeps {
  navManager: Pick<
    NavigationDataManager,
    "getLastData" | "isFixStale" | "getFixAgeMs"
  >;
  activeNav: Pick<ActiveNavigationManager, "startGoto" | "stop" | "getState">;
  /** Persist + render a new waypoint (main.ts: waypointLayer.addWaypoint). */
  saveWaypoint(wp: StandaloneWaypoint): Promise<void>;
  /** Persist + re-render an edited waypoint (waypointLayer.updateWaypoint). */
  updateWaypoint(wp: StandaloneWaypoint): Promise<void>;
  /** Look a waypoint up straight from IndexedDB (restore path). */
  getWaypointById(id: string): Promise<StandaloneWaypoint | null>;
  alarm: Pick<CobAlarm, "start" | "stop" | "setMuted">;
  /** Start track recording if not already running. */
  onEnsureRecording(): void;
  /** Force/release the emergency wake lock. */
  onEmergencyChange(active: boolean): void;
  /** Clock override for tests. */
  now?: () => number;
  /** Storage override for tests; defaults to localStorage. */
  storage?: StorageLike | null;
}

export class CobManager {
  private readonly deps: CobManagerDeps;
  private readonly storage: StorageLike | null;
  private readonly now: () => number;
  private state: CobRuntimeState | null = null;
  private listeners: CobChangeCallback[] = [];

  constructor(deps: CobManagerDeps) {
    this.deps = deps;
    this.storage =
      deps.storage !== undefined ? deps.storage : defaultBrowserStorage();
    this.now = deps.now ?? (() => Date.now());
  }

  /**
   * Mark crew overboard at the current position. Synchronous decision, async
   * persistence: the waypoint save and side effects are fired immediately but
   * not awaited, so the caller can react to the result without delay.
   */
  activate(): CobActivationResult {
    if (this.state) return "ok"; // already active — never double-fire
    const fix = this.deps.navManager.getLastData();
    if (!fix) return "no-fix";

    const stale = this.deps.navManager.isFixStale();
    const startedAt = this.now();
    const waypoint: StandaloneWaypoint = {
      id: generateUUID(),
      lat: fix.latitude,
      lon: fix.longitude,
      name: cobWaypointName(new Date(startedAt)),
      notes: "",
      icon: "cob",
      createdAt: startedAt,
      updatedAt: startedAt,
    };
    this.state = {
      startedAt,
      waypoint,
      muted: false,
      staleAtDrop: stale,
      fixAgeAtDropMs: stale ? this.deps.navManager.getFixAgeMs() : 0,
    };

    // Crash-safe ordering: durable waypoint first, then our slot, then nav
    // (which persists its own goto state), then side effects.
    this.deps
      .saveWaypoint(waypoint)
      .catch((err) => console.error("COB waypoint save failed:", err));
    this.persist();
    this.deps.activeNav.startGoto(waypoint);
    this.deps.alarm.start(false);
    this.deps.onEmergencyChange(true);
    this.deps.onEnsureRecording();
    this.notify();
    return stale ? "ok-stale" : "ok";
  }

  /** Crew recovered / end the emergency. The waypoint is always kept. */
  async resolve(): Promise<void> {
    const state = this.state;
    if (!state) return;
    this.state = null;
    this.deps.alarm.stop();
    if (this.isGotoTarget(state.waypoint.id)) {
      this.deps.activeNav.stop();
    }
    this.deps.onEmergencyChange(false);
    cobStateSlot.clear(this.storage);
    this.notify();

    const wp = state.waypoint;
    wp.notes = wp.notes
      ? `${wp.notes}\n${resolvedNotes(state.startedAt, this.now())}`
      : resolvedNotes(state.startedAt, this.now());
    wp.updatedAt = this.now();
    await this.deps
      .updateWaypoint(wp)
      .catch((err) => console.error("COB waypoint annotate failed:", err));
  }

  setMuted(muted: boolean): void {
    if (!this.state) return;
    this.state.muted = muted;
    this.deps.alarm.setMuted(muted);
    this.persist();
    this.notify();
  }

  isActive(): boolean {
    return this.state !== null;
  }

  getState(): CobRuntimeState | null {
    return this.state;
  }

  /** Is this waypoint the active COB point? */
  isCobWaypoint(id: string): boolean {
    return this.state?.waypoint.id === id;
  }

  /** Is active navigation currently a goto targeting the COB point? */
  isCobNavigation(): boolean {
    return this.state !== null && this.isGotoTarget(this.state.waypoint.id);
  }

  /** Re-engage goto back to the COB point (after the user navigated elsewhere). */
  renavigate(): void {
    if (!this.state) return;
    this.deps.activeNav.startGoto(this.state.waypoint);
  }

  /**
   * The COB waypoint is being deleted (already confirmed by the UI) —
   * the event cannot outlive its position, so end it. No annotation:
   * the waypoint is going away.
   */
  noteWaypointDeleted(id: string): void {
    if (!this.state || this.state.waypoint.id !== id) return;
    this.state = null;
    this.deps.alarm.stop();
    this.deps.onEmergencyChange(false);
    cobStateSlot.clear(this.storage);
    this.notify();
  }

  /**
   * Restore a persisted COB event at startup. Call after activeNav.restore():
   * the goto normally comes back on its own (same waypoint id), so we only
   * re-engage navigation when nav restored idle — and we never stomp on a
   * deliberate pre-crash retarget to some other destination.
   */
  async restore(): Promise<void> {
    const saved = cobStateSlot.load(this.storage);
    if (!saved) return;
    const waypoint = await this.deps.getWaypointById(saved.waypointId);
    if (!waypoint) {
      // Waypoint gone (deleted between persist and crash) — nothing to
      // navigate back to; drop the stale event.
      cobStateSlot.clear(this.storage);
      return;
    }
    this.state = {
      startedAt: saved.startedAt,
      waypoint,
      muted: saved.muted,
      staleAtDrop: saved.staleAtDrop,
      fixAgeAtDropMs: saved.fixAgeAtDropMs,
    };
    if (this.deps.activeNav.getState().type === "idle") {
      this.deps.activeNav.startGoto(waypoint);
    }
    this.deps.alarm.start(saved.muted);
    this.deps.onEmergencyChange(true);
    this.notify();
  }

  subscribe(cb: CobChangeCallback): void {
    this.listeners.push(cb);
  }

  unsubscribe(cb: CobChangeCallback): void {
    const idx = this.listeners.indexOf(cb);
    if (idx >= 0) this.listeners.splice(idx, 1);
  }

  private isGotoTarget(waypointId: string): boolean {
    const nav = this.deps.activeNav.getState();
    return (
      nav.type === "goto" &&
      "id" in nav.waypoint &&
      nav.waypoint.id === waypointId
    );
  }

  private persist(): void {
    if (!this.state) return;
    const saved: PersistedCobState = {
      version: 1,
      startedAt: this.state.startedAt,
      waypointId: this.state.waypoint.id,
      muted: this.state.muted,
      staleAtDrop: this.state.staleAtDrop,
      fixAgeAtDropMs: this.state.fixAgeAtDropMs,
    };
    cobStateSlot.save(saved, this.storage);
  }

  private notify(): void {
    for (const cb of this.listeners) cb(this.state);
  }
}
