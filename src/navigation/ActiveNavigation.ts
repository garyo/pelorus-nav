/**
 * Active navigation state machine.
 * Manages "go to waypoint" and "follow route" modes,
 * computing bearing and distance to the current target on each GPS tick.
 */

import { getAllRoutes, getAllWaypoints } from "../data/db";
import type { Route, Waypoint } from "../data/Route";
import type { StandaloneWaypoint } from "../data/Waypoint";
import { logUiAction } from "../diagnostics/uiActionLog";
import { getSettings } from "../settings";
import {
  alongTrackDistanceNM,
  bearingDelta,
  haversineDistanceNM,
  initialBearingDeg,
  pathDistanceNM,
} from "../utils/coordinates";
import type { NavigationData } from "./NavigationData";
import type { NavigationDataManager } from "./NavigationDataManager";

const STORAGE_KEY = "pelorus-nav-active-nav";

/** Serializable form of active navigation state for localStorage. */
type PersistedNavState =
  | { type: "idle" }
  | { type: "goto"; waypointId: string }
  | { type: "route"; routeId: string; legIndex: number };

/**
 * Determine whether the vessel should advance past the current leg target.
 * Returns true if:
 * - distance to target < arrivalRadiusNM (normal arrival), OR
 * - vessel has passed the perpendicular at the target (along-track > leg distance)
 */
export function shouldAdvanceLeg(
  vesselLat: number,
  vesselLon: number,
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number,
  arrivalRadiusNM: number,
): boolean {
  // Check simple radius first
  const distToTarget = haversineDistanceNM(vesselLat, vesselLon, toLat, toLon);
  if (distToTarget < arrivalRadiusNM) return true;

  // Perpendicular crossing: along-track distance from "from" exceeds leg distance
  const legDist = haversineDistanceNM(fromLat, fromLon, toLat, toLon);
  const atd = alongTrackDistanceNM(
    fromLat,
    fromLon,
    toLat,
    toLon,
    vesselLat,
    vesselLon,
  );
  return atd >= legDist;
}

/**
 * Choose the initial leg index when route navigation starts.
 *
 * Normally the first waypoint is the route's origin and nav targets
 * waypoint[1] (legIndex 1). But the first waypoint may instead be a point
 * out ahead of the vessel — in that case it should be the next target
 * (legIndex 0). Returns 0 while the vessel is still short of waypoint[0],
 * and 1 once it has reached it (within the arrival radius) or already passed
 * its perpendicular heading toward waypoint[1].
 */
export function pickStartLeg(
  vesselLat: number,
  vesselLon: number,
  route: Route,
  arrivalRadiusNM: number,
): number {
  const wp0 = route.waypoints[0];
  const wp1 = route.waypoints[1];
  if (!wp0 || !wp1) return 1;
  const reachedWp0 =
    haversineDistanceNM(vesselLat, vesselLon, wp0.lat, wp0.lon) <
      arrivalRadiusNM ||
    alongTrackDistanceNM(
      wp0.lat,
      wp0.lon,
      wp1.lat,
      wp1.lon,
      vesselLat,
      vesselLon,
    ) > 0;
  return reachedWp0 ? 1 : 0;
}

/**
 * Corridor half-width for restore-time leg validation, floored at a couple of
 * miles so ordinary cross-track error (hand steering, drift while the app was
 * down) never fails a legitimately resumed leg.
 */
const RESTORE_CORRIDOR_FLOOR_NM = 2;

/** Shortest distance from a point to the leg segment from→to, in NM. */
function distanceToLegNM(
  lat: number,
  lon: number,
  from: Waypoint,
  to: Waypoint,
): number {
  const legDist = haversineDistanceNM(from.lat, from.lon, to.lat, to.lon);
  const dFrom = haversineDistanceNM(lat, lon, from.lat, from.lon);
  const dTo = haversineDistanceNM(lat, lon, to.lat, to.lon);
  if (legDist < 1e-6) return Math.min(dFrom, dTo);
  const atd = alongTrackDistanceNM(
    from.lat,
    from.lon,
    to.lat,
    to.lon,
    lat,
    lon,
  );
  if (atd <= 0) return dFrom;
  if (atd >= legDist) return dTo;
  // Cross-track distance via Pythagoras on the start-distance/along-track pair
  // (planar approximation — fine at corridor scales of a few NM).
  return Math.sqrt(Math.max(0, dFrom * dFrom - atd * atd));
}

/**
 * Pick the leg to resume after a restart, trusting persisted passage progress.
 *
 * pickStartLeg only examines waypoints 0 and 1, so on a route that doubles
 * back toward its origin it can re-target an already-passed outbound waypoint
 * and stall a mid-passage resume. Instead, keep the persisted leg when the
 * vessel is plausibly still on it — within a corridor of the leg segment —
 * and otherwise scan *forward* to the first remaining leg whose corridor
 * contains the vessel (it may have progressed while the app was down;
 * auto-advance still converges from there). Only when the vessel is near none
 * of the remaining legs did the restart move it somewhere unrelated to its
 * persisted progress — e.g. the dev simulator resetting the boat to its start
 * position on reload — and only then does pickStartLeg re-derive from scratch.
 * A persisted leg of 0 (still approaching the route's first waypoint) has no
 * corridor to test and goes straight to pickStartLeg, which re-answers the
 * 0-vs-1 question from the current position.
 */
export function resolveRestoredLeg(
  vesselLat: number,
  vesselLon: number,
  route: Route,
  persistedLeg: number,
  arrivalRadiusNM: number,
): number {
  const count = route.waypoints.length;
  const corridorNM = Math.max(RESTORE_CORRIDOR_FLOOR_NM, 2 * arrivalRadiusNM);
  if (
    Number.isInteger(persistedLeg) &&
    persistedLeg >= 1 &&
    persistedLeg < count
  ) {
    for (let leg = persistedLeg; leg < count; leg++) {
      const from = route.waypoints[leg - 1];
      const to = route.waypoints[leg];
      if (distanceToLegNM(vesselLat, vesselLon, from, to) <= corridorNM) {
        return leg;
      }
    }
  }
  return pickStartLeg(vesselLat, vesselLon, route, arrivalRadiusNM);
}

/** Pure computation — extract for testing. */
export function computeNavigation(
  vesselLat: number,
  vesselLon: number,
  targetLat: number,
  targetLon: number,
): { bearingDeg: number; distanceNM: number } {
  return {
    bearingDeg: initialBearingDeg(vesselLat, vesselLon, targetLat, targetLon),
    distanceNM: haversineDistanceNM(vesselLat, vesselLon, targetLat, targetLon),
  };
}

export type ActiveNavigationState =
  | { type: "idle" }
  | { type: "goto"; waypoint: StandaloneWaypoint | Waypoint }
  | { type: "route"; route: Route; legIndex: number };

export interface ActiveNavigationInfo {
  bearingDeg: number;
  distanceNM: number;
  targetName: string;
  targetLat: number;
  targetLon: number;
  /** Velocity made good toward the target, in knots. null when COG/SOG unknown. */
  vmgKn: number | null;
  /** Signed bearing correction (target − COG) in (−180, +180]. null when COG unknown. */
  steerDeg: number | null;
  /** Name of the waypoint currently being navigated to (the active target). */
  nextWaypointName: string | null;
  /**
   * Distance to the route's final waypoint (via the remaining legs), in NM.
   * Equals distanceNM on the final leg; null in goto mode, where the target
   * is the destination.
   */
  destDistanceNM: number | null;
}

export type ActiveNavCallback = (
  info: ActiveNavigationInfo | null,
  state: ActiveNavigationState,
) => void;

export class ActiveNavigationManager {
  private state: ActiveNavigationState = { type: "idle" };
  private listeners: ActiveNavCallback[] = [];
  private navManager: NavigationDataManager;
  private lastInfo: ActiveNavigationInfo | null = null;
  /**
   * Set when restore() resumed a persisted route leg with no GPS fix on hand
   * to validate it. The first fix re-runs resolveRestoredLeg; any explicit
   * leg change in the meantime clears it (the user's choice supersedes).
   */
  private pendingRestoreLegCheck = false;

  constructor(navManager: NavigationDataManager) {
    this.navManager = navManager;
    this.navManager.subscribe(this.onGPSUpdate);
  }

  private readonly onGPSUpdate = (data: NavigationData): void => {
    if (this.state.type === "idle") return;

    // A restored leg awaiting its first fix: validate it now, before this
    // tick's target computation and auto-advance run against it.
    if (this.state.type === "route" && this.pendingRestoreLegCheck) {
      this.pendingRestoreLegCheck = false;
      const resolved = resolveRestoredLeg(
        data.latitude,
        data.longitude,
        this.state.route,
        this.state.legIndex,
        getSettings().arrivalRadiusNM,
      );
      if (resolved !== this.state.legIndex) {
        this.state = { ...this.state, legIndex: resolved };
        this.persist();
      }
    }

    const target = this.getTarget();
    if (!target) return;

    const result = computeNavigation(
      data.latitude,
      data.longitude,
      target.lat,
      target.lon,
    );

    this.lastInfo = {
      bearingDeg: result.bearingDeg,
      distanceNM: result.distanceNM,
      targetName: target.name || "Target",
      targetLat: target.lat,
      targetLon: target.lon,
      ...this.deriveCourseInfo(result.bearingDeg, data),
      nextWaypointName: this.getNextWaypointName(),
      destDistanceNM: this.destDistanceNM(result.distanceNM),
    };

    // Route mode: auto-advance on arrival or perpendicular crossing
    if (this.state.type === "route") {
      const arrivalRadius = getSettings().arrivalRadiusNM;
      const nextIndex = this.state.legIndex + 1;
      const isLastWaypoint = nextIndex >= this.state.route.waypoints.length;

      // Get previous waypoint (leg start) for perpendicular test
      const fromWp = this.state.route.waypoints[this.state.legIndex - 1];
      let advance: boolean;
      if (isLastWaypoint) {
        advance = result.distanceNM < arrivalRadius; // final wp: radius only
      } else if (fromWp) {
        advance = shouldAdvanceLeg(
          data.latitude,
          data.longitude,
          fromWp.lat,
          fromWp.lon,
          target.lat,
          target.lon,
          arrivalRadius,
        );
      } else {
        // Leg 0 (waypoint[0] is the target, with no prior leg): advance on
        // arrival, or once the vessel passes wp0's perpendicular heading
        // toward the next waypoint.
        const nextWp = this.state.route.waypoints[this.state.legIndex + 1];
        advance =
          result.distanceNM < arrivalRadius ||
          (nextWp != null &&
            alongTrackDistanceNM(
              target.lat,
              target.lon,
              nextWp.lat,
              nextWp.lon,
              data.latitude,
              data.longitude,
            ) > 0);
      }

      if (advance) {
        if (!isLastWaypoint) {
          this.state = {
            type: "route",
            route: this.state.route,
            legIndex: nextIndex,
          };
          this.persist();
          // Recompute for new target
          const newTarget = this.getTarget();
          if (newTarget) {
            const newResult = computeNavigation(
              data.latitude,
              data.longitude,
              newTarget.lat,
              newTarget.lon,
            );
            this.lastInfo = {
              bearingDeg: newResult.bearingDeg,
              distanceNM: newResult.distanceNM,
              targetName: newTarget.name || "Target",
              targetLat: newTarget.lat,
              targetLon: newTarget.lon,
              ...this.deriveCourseInfo(newResult.bearingDeg, data),
              nextWaypointName: this.getNextWaypointName(),
              destDistanceNM: this.destDistanceNM(newResult.distanceNM),
            };
          }
        } else {
          // Arrived at final waypoint
          this.stop();
          return;
        }
      }
    }

    this.notify();
  };

  /** Compute VMG and steer correction from current GPS COG/SOG. */
  private deriveCourseInfo(
    bearingDeg: number,
    data: NavigationData,
  ): { vmgKn: number | null; steerDeg: number | null } {
    const cog = data.cog ?? data.heading ?? null;
    const sog = data.sog ?? null;
    if (cog == null) return { vmgKn: null, steerDeg: null };
    const steer = bearingDelta(bearingDeg, cog);
    const vmg = sog != null ? sog * Math.cos((steer * Math.PI) / 180) : null;
    return { vmgKn: vmg, steerDeg: steer };
  }

  /**
   * Distance to the route's final waypoint: vessel→target plus the legs
   * beyond it. null in goto mode.
   */
  private destDistanceNM(targetDistNM: number): number | null {
    if (this.state.type !== "route") return null;
    const remaining = this.state.route.waypoints.slice(this.state.legIndex);
    return targetDistNM + pathDistanceNM(remaining);
  }

  /** Name of the waypoint currently being navigated to. */
  private getNextWaypointName(): string | null {
    const target = this.getTarget();
    return target?.name ?? null;
  }

  private getTarget(): { lat: number; lon: number; name: string } | null {
    switch (this.state.type) {
      case "goto":
        return this.state.waypoint;
      case "route": {
        const wp = this.state.route.waypoints[this.state.legIndex];
        return wp ?? null;
      }
      default:
        return null;
    }
  }

  startGoto(waypoint: StandaloneWaypoint | Waypoint): void {
    logUiAction(`nav goto ${waypoint.name || "(unnamed)"}`);
    this.pendingRestoreLegCheck = false;
    this.state = { type: "goto", waypoint };
    this.persist();
    this.recompute();
  }

  startRoute(route: Route, startLeg?: number): void {
    if (route.waypoints.length < 2) return;
    const leg = startLeg ?? this.pickStartLeg(route);
    logUiAction(`nav route ${route.name || "(unnamed)"} (leg ${leg})`);
    this.pendingRestoreLegCheck = false;
    this.state = { type: "route", route, legIndex: leg };
    this.persist();
    this.recompute();
  }

  /** Pick the initial leg from current GPS, falling back to leg 1 if unknown. */
  private pickStartLeg(route: Route): number {
    const data = this.navManager.getLastData();
    return data
      ? pickStartLeg(
          data.latitude,
          data.longitude,
          route,
          getSettings().arrivalRadiusNM,
        )
      : 1;
  }

  stop(): void {
    if (this.state.type !== "idle") logUiAction("nav stop");
    this.pendingRestoreLegCheck = false;
    this.state = { type: "idle" };
    this.lastInfo = null;
    this.persist();
    this.notify();
  }

  /** The navigated route was deleted — navigation to it must not survive. */
  noteRouteDeleted(routeId: string): void {
    if (this.state.type === "route" && this.state.route.id === routeId) {
      this.stop();
    }
  }

  /**
   * The navigated route was edited and saved — steer to the new geometry.
   * Waypoints may have moved, been inserted, or deleted, so the old leg
   * index is meaningless; re-derive the target from the current position
   * exactly as when starting fresh on the route.
   */
  noteRouteEdited(route: Route): void {
    if (this.state.type !== "route" || this.state.route.id !== route.id) {
      return;
    }
    if (route.waypoints.length < 2) {
      this.stop();
      return;
    }
    logUiAction(`nav route re-targeted after edit (${route.name || "?"})`);
    this.pendingRestoreLegCheck = false;
    this.state = { type: "route", route, legIndex: this.pickStartLeg(route) };
    this.persist();
    this.recompute();
  }

  /** The goto target waypoint was deleted — navigation to it must not survive. */
  noteWaypointDeleted(waypointId: string): void {
    if (
      this.state.type === "goto" &&
      "id" in this.state.waypoint &&
      this.state.waypoint.id === waypointId
    ) {
      this.stop();
    }
  }

  /** Jump to a specific leg by waypoint index (legIndex=N targets waypoint[N]). */
  setLeg(index: number): void {
    if (this.state.type !== "route") return;
    if (index < 0 || index >= this.state.route.waypoints.length) return;
    this.pendingRestoreLegCheck = false;
    this.state = { ...this.state, legIndex: index };
    this.persist();
    this.recompute();
  }

  nextLeg(): void {
    if (this.state.type !== "route") return;
    const next = this.state.legIndex + 1;
    if (next < this.state.route.waypoints.length) {
      this.pendingRestoreLegCheck = false;
      this.state = { ...this.state, legIndex: next };
      this.persist();
      this.recompute();
    }
  }

  prevLeg(): void {
    if (this.state.type !== "route") return;
    if (this.state.legIndex > 0) {
      this.pendingRestoreLegCheck = false;
      this.state = { ...this.state, legIndex: this.state.legIndex - 1 };
      this.persist();
      this.recompute();
    }
  }

  getState(): ActiveNavigationState {
    return this.state;
  }

  getInfo(): ActiveNavigationInfo | null {
    return this.lastInfo;
  }

  subscribe(callback: ActiveNavCallback): void {
    this.listeners.push(callback);
  }

  unsubscribe(callback: ActiveNavCallback): void {
    const idx = this.listeners.indexOf(callback);
    if (idx >= 0) this.listeners.splice(idx, 1);
  }

  private notify(): void {
    for (const fn of this.listeners) {
      fn(this.lastInfo, this.state);
    }
  }

  private recompute(): void {
    const data = this.navManager.getLastData();
    if (data) {
      this.onGPSUpdate(data);
    } else {
      // No GPS data yet — notify with target info but no computed nav
      const target = this.getTarget();
      if (target) {
        this.lastInfo = {
          bearingDeg: 0,
          distanceNM: 0,
          targetName: target.name || "Target",
          targetLat: target.lat,
          targetLon: target.lon,
          vmgKn: null,
          steerDeg: null,
          nextWaypointName: this.getNextWaypointName(),
          destDistanceNM: this.destDistanceNM(0),
        };
      }
      this.notify();
    }
  }

  /** Restore persisted navigation state from localStorage + IndexedDB. */
  async restore(): Promise<void> {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as PersistedNavState;
      if (saved.type === "goto") {
        const waypoints = await getAllWaypoints();
        const wp = waypoints.find((w) => w.id === saved.waypointId);
        if (wp) {
          this.state = { type: "goto", waypoint: wp };
          this.recompute();
        } else {
          // Waypoint was deleted — clear persisted state
          this.persist();
        }
      } else if (saved.type === "route") {
        const routes = await getAllRoutes();
        const route = routes.find((r) => r.id === saved.routeId);
        if (route && route.waypoints.length >= 2) {
          // Resume the persisted leg rather than re-deriving from scratch —
          // on a route that doubles back, re-deriving (pickStartLeg) would
          // re-target an already-passed outbound waypoint mid-passage. The
          // persisted leg is validated against a GPS fix by resolveRestoredLeg
          // (see its contract): here when a fix is already on hand, otherwise
          // on the first fix via pendingRestoreLegCheck. That validation is
          // what catches a restart that moved the vessel away from its
          // persisted progress — e.g. the dev simulator resetting the boat to
          // its start position on reload while the persisted legIndex still
          // points deep into the route. An out-of-range persisted index
          // (route shrank since it was saved) re-derives immediately.
          const persisted = saved.legIndex;
          const valid =
            Number.isInteger(persisted) &&
            persisted >= 0 &&
            persisted < route.waypoints.length;
          const data = this.navManager.getLastData();
          let legIndex: number;
          if (!valid) {
            legIndex = this.pickStartLeg(route);
          } else if (data) {
            legIndex = resolveRestoredLeg(
              data.latitude,
              data.longitude,
              route,
              persisted,
              getSettings().arrivalRadiusNM,
            );
          } else {
            legIndex = persisted;
            this.pendingRestoreLegCheck = true;
          }
          this.state = { type: "route", route, legIndex };
          this.persist();
          this.recompute();
        } else {
          this.persist();
        }
      }
    } catch {
      // Ignore corrupt data
    }
  }

  private persist(): void {
    let saved: PersistedNavState;
    switch (this.state.type) {
      case "goto":
        saved = {
          type: "goto",
          waypointId:
            "id" in this.state.waypoint
              ? (this.state.waypoint as StandaloneWaypoint).id
              : "",
        };
        break;
      case "route":
        saved = {
          type: "route",
          routeId: this.state.route.id,
          legIndex: this.state.legIndex,
        };
        break;
      default:
        saved = { type: "idle" };
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  }

  dispose(): void {
    this.navManager.unsubscribe(this.onGPSUpdate);
    this.listeners.length = 0;
  }
}
