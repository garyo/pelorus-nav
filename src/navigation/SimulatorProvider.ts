/**
 * Simulated GPS provider for development.
 * Modes: route (follow waypoints), circular (orbit a center), static (fixed position).
 */

import {
  haversineDistanceNM,
  initialBearingDeg,
  toDegrees,
  toRadians,
} from "../utils/coordinates";
import type {
  NavigationData,
  NavigationDataCallback,
  NavigationDataProvider,
} from "./NavigationData";

export interface SimulatorOptions {
  mode: "route" | "circular" | "static";
  /** Waypoints for route mode: [lat, lng][] */
  waypoints?: [number, number][];
  /** Speed in knots for route/circular modes */
  speed?: number;
  /** Center for circular mode: [lat, lng] */
  center?: [number, number];
  /** Radius in NM for circular mode */
  radius?: number;
  /** Static position: [lat, lng] */
  position?: [number, number];
  /** Update interval in ms */
  intervalMs?: number;
  /** Time multiplier for faster simulation (e.g. 10 = 10x speed) */
  speedMultiplier?: number;
}

/** Default Boston Harbor loop */
const BOSTON_HARBOR_ROUTE: [number, number][] = [
  [42.363559, -71.047973], // inner harbor
  [42.361406, -71.045476], // past Long Wharf
  [42.353086, -71.03469], // Castle Island
  [42.333935, -71.000208], // Deer Island
  [42.33633, -70.945541], // outer harbor
  [42.361693, -70.926069], // off Nahant
  [42.33633, -70.945541], // outer harbor (return)
  [42.333935, -71.000208], // Deer Island (return)
  [42.353086, -71.03469], // Castle Island (return)
  [42.361406, -71.045476], // past Long Wharf (return)
];

const DEFAULT_SPEED_KN = 6;
const DEFAULT_INTERVAL_MS = 1000;

export class SimulatorProvider implements NavigationDataProvider {
  readonly id = "simulator";
  readonly name = "Simulator";

  private opts: Required<
    Pick<SimulatorOptions, "mode" | "speed" | "intervalMs" | "speedMultiplier">
  > &
    SimulatorOptions;
  private listeners: NavigationDataCallback[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private startTime = 0;

  constructor(options?: Partial<SimulatorOptions>) {
    this.opts = {
      mode: options?.mode ?? "route",
      waypoints: options?.waypoints ?? BOSTON_HARBOR_ROUTE,
      speed: options?.speed ?? DEFAULT_SPEED_KN,
      center: options?.center ?? [42.35, -71.04],
      radius: options?.radius ?? 0.5,
      position: options?.position ?? [42.355, -71.045],
      intervalMs: options?.intervalMs ?? DEFAULT_INTERVAL_MS,
      speedMultiplier: options?.speedMultiplier ?? 1,
    };
  }

  isConnected(): boolean {
    return this.timer !== null;
  }

  connect(): void {
    if (this.timer) return;
    this.startTime = Date.now();
    this.timer = setInterval(() => this.tick(), this.opts.intervalMs);
    this.tick();
  }

  disconnect(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  subscribe(callback: NavigationDataCallback): void {
    this.listeners.push(callback);
  }

  unsubscribe(callback: NavigationDataCallback): void {
    const idx = this.listeners.indexOf(callback);
    if (idx >= 0) this.listeners.splice(idx, 1);
  }

  setSpeedMultiplier(multiplier: number): void {
    this.opts.speedMultiplier = multiplier;
  }

  private tick(): void {
    const elapsed =
      ((Date.now() - this.startTime) / 1000) * this.opts.speedMultiplier;
    let data: NavigationData;

    switch (this.opts.mode) {
      case "route":
        data = this.computeRoute(elapsed);
        break;
      case "circular":
        data = this.computeCircular(elapsed);
        break;
      default:
        data = this.computeStatic();
        break;
    }

    for (const fn of this.listeners) {
      fn(data);
    }
  }

  private computeRoute(elapsedSec: number): NavigationData {
    const waypoints = this.opts.waypoints ?? BOSTON_HARBOR_ROUTE;
    const speedKn = this.opts.speed;

    // Compute cumulative distances along the route
    const segDistances: number[] = [];
    let totalDist = 0;
    for (let i = 1; i < waypoints.length; i++) {
      const d = haversineDistanceNM(
        waypoints[i - 1][0],
        waypoints[i - 1][1],
        waypoints[i][0],
        waypoints[i][1],
      );
      segDistances.push(d);
      totalDist += d;
    }

    // Distance traveled (loop)
    const distTraveled = ((speedKn * elapsedSec) / 3600) % totalDist;

    // Find current segment
    let accumulated = 0;
    let segIdx = 0;
    for (let i = 0; i < segDistances.length; i++) {
      if (accumulated + segDistances[i] > distTraveled) {
        segIdx = i;
        break;
      }
      accumulated += segDistances[i];
    }

    const segFraction =
      segDistances[segIdx] > 0
        ? (distTraveled - accumulated) / segDistances[segIdx]
        : 0;
    const from = waypoints[segIdx];
    const to = waypoints[segIdx + 1];

    const lat = from[0] + (to[0] - from[0]) * segFraction;
    const lng = from[1] + (to[1] - from[1]) * segFraction;

    const cog = initialBearingDeg(from[0], from[1], to[0], to[1]);

    return {
      latitude: lat,
      longitude: lng,
      cog,
      sog: speedKn,
      heading: cog,
      accuracy: 5,
      timestamp: Date.now(),
      source: "simulator",
    };
  }

  private computeCircular(elapsedSec: number): NavigationData {
    const center = this.opts.center ?? [42.35, -71.04];
    const radiusNM = this.opts.radius ?? 0.5;
    const speedKn = this.opts.speed;

    // Angular velocity: speed / circumference * 2pi
    const circumference = 2 * Math.PI * radiusNM;
    const angularVel = (speedKn / circumference) * 2 * Math.PI; // rad/hour
    const angle = (angularVel * elapsedSec) / 3600;

    // Convert radius to degrees (rough: 1 NM ~ 1/60 degree latitude)
    const radiusDegLat = radiusNM / 60;
    const radiusDegLng = radiusDegLat / Math.cos(toRadians(center[0]));

    const lat = center[0] + radiusDegLat * Math.sin(angle);
    const lng = center[1] + radiusDegLng * Math.cos(angle);

    // COG is tangent to circle (perpendicular to radius, in direction of motion)
    const cogRad = angle + Math.PI / 2;
    const cog = ((toDegrees(cogRad) % 360) + 360) % 360;

    return {
      latitude: lat,
      longitude: lng,
      cog,
      sog: speedKn,
      heading: cog,
      accuracy: 5,
      timestamp: Date.now(),
      source: "simulator",
    };
  }

  private computeStatic(): NavigationData {
    const pos = this.opts.position ?? [42.355, -71.045];
    return {
      latitude: pos[0],
      longitude: pos[1],
      cog: null,
      sog: 0,
      heading: null,
      accuracy: 10,
      timestamp: Date.now(),
      source: "simulator",
    };
  }
}
