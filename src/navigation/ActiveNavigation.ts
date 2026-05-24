/**
 * Active navigation state machine.
 * Manages "go to waypoint" and "follow route" modes,
 * computing bearing and distance to the current target on each GPS tick.
 */

import { getAllRoutes, getAllWaypoints } from "../data/db";
import type { Route, Waypoint } from "../data/Route";
import type { StandaloneWaypoint } from "../data/Waypoint";
import { getSettings } from "../settings";
import {
  alongTrackDistanceNM,
  bearingDelta,
  haversineDistanceNM,
  initialBearingDeg,
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

  constructor(navManager: NavigationDataManager) {
    this.navManager = navManager;
    this.navManager.subscribe(this.onGPSUpdate);
  }

  private readonly onGPSUpdate = (data: NavigationData): void => {
    if (this.state.type === "idle") return;

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
    };

    // Route mode: auto-advance on arrival or perpendicular crossing
    if (this.state.type === "route") {
      const arrivalRadius = getSettings().arrivalRadiusNM;
      const nextIndex = this.state.legIndex + 1;
      const isLastWaypoint = nextIndex >= this.state.route.waypoints.length;

      // Get previous waypoint (leg start) for perpendicular test
      const fromWp = this.state.route.waypoints[this.state.legIndex - 1];
      const advance =
        fromWp && !isLastWaypoint
          ? shouldAdvanceLeg(
              data.latitude,
              data.longitude,
              fromWp.lat,
              fromWp.lon,
              target.lat,
              target.lon,
              arrivalRadius,
            )
          : result.distanceNM < arrivalRadius; // final wp or no "from": radius only

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
    this.state = { type: "goto", waypoint };
    this.persist();
    this.recompute();
  }

  startRoute(route: Route, startLeg = 1): void {
    if (route.waypoints.length < 2) return;
    this.state = { type: "route", route, legIndex: startLeg };
    this.persist();
    this.recompute();
  }

  stop(): void {
    this.state = { type: "idle" };
    this.lastInfo = null;
    this.persist();
    this.notify();
  }

  /** Jump to a specific leg by waypoint index (1-based: legIndex=1 targets waypoint[1]). */
  setLeg(index: number): void {
    if (this.state.type !== "route") return;
    if (index < 1 || index >= this.state.route.waypoints.length) return;
    this.state = { ...this.state, legIndex: index };
    this.persist();
    this.recompute();
  }

  nextLeg(): void {
    if (this.state.type !== "route") return;
    const next = this.state.legIndex + 1;
    if (next < this.state.route.waypoints.length) {
      this.state = { ...this.state, legIndex: next };
      this.persist();
      this.recompute();
    }
  }

  prevLeg(): void {
    if (this.state.type !== "route") return;
    if (this.state.legIndex > 1) {
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
          // Always restart at leg 1, ignoring the persisted legIndex.
          // The onGPSUpdate auto-advance (shouldAdvanceLeg) will then run
          // forward through any legs the boat has genuinely passed,
          // converging on the correct one within a few ticks. This avoids
          // the dev-sim trap where the simulator resets the boat to its
          // start position on reload but the persisted legIndex still
          // points deep into the route — and is functionally identical
          // to trusting the persisted index for real-world resumes (boat
          // hasn't teleported, so auto-advance lands at the same leg).
          this.state = { type: "route", route, legIndex: 1 };
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
