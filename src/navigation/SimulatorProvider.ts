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

/**
 * Synthetic GPS error patterns layered on top of the base motion model.
 * The default {kind: "none"} keeps existing behaviour (just per-fix
 * baseline jitter). Other modes are deterministic functions of the
 * tick counter, so two simulator runs with the same seed/config
 * produce identical fix sequences — important for reproducible tests.
 */
export type SimulatorErrorMode =
  | { kind: "none" }
  /** With probability `rate`, replace this fix with one displaced by
   *  `magnitudeM` metres in a random direction. Models a single bad
   *  GPS sample (multipath, satellite glitch). */
  | { kind: "shot"; rate: number; magnitudeM: number }
  /** Every `period` ticks, the next `burstLen` ticks have Gaussian
   *  noise of σ=`noiseM` metres added on top of the baseline jitter.
   *  Models entering and exiting a noisy area (urban canyon). */
  | {
      kind: "noisy-burst";
      period: number;
      burstLen: number;
      noiseM: number;
    }
  /** Add a constant [east, north] metre offset for ticks t0..t0+duration.
   *  Models sustained multipath bias (e.g. boat sitting beside a tall
   *  steel hull). After duration ends, the bias releases instantly. */
  | {
      kind: "sustained-bias";
      startTick: number;
      durationTicks: number;
      biasM: [number, number];
    }
  /** With probability `rate`, suppress the fix entirely (no callback
   *  fires this tick). Lets us test variable-dt behaviour. */
  | { kind: "dropout"; rate: number };

export interface SimulatorOptions {
  mode: "route" | "circular" | "static" | "replay";
  /** Waypoints for route mode: [lat, lng][] */
  waypoints?: [number, number][];
  /** Recorded track for replay mode: [tSec, lat, lng][] (looped). */
  track?: [number, number, number][];
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
  /** Optional synthetic GPS error layered on top of the baseline jitter. */
  errorMode?: SimulatorErrorMode;
  /** Seed for the deterministic RNG used by error modes. */
  errorSeed?: number;
}

/** Default Boston Harbor loop, taken from a real route plotted in the app
 *  (Route 2026-07-11): inner harbor out the main channel past Castle Island
 *  and President Roads to the outer harbor, and back. The first point is
 *  repeated at the end so the modulo wrap in route mode closes the loop
 *  without a jump. Exported so dev tooling can splice in custom starting
 *  points without rebuilding the whole loop. */
export const BOSTON_HARBOR_ROUTE: [number, number][] = [
  [42.363715, -71.04743], // inner harbor (Long Wharf)
  [42.352039, -71.032698], // main channel off Castle Island
  [42.354634, -71.030561],
  [42.342674, -71.014302], // President Roads, westbound edge
  [42.344705, -71.01163],
  [42.332517, -70.995676], // off Deer Island
  [42.337764, -70.949034], // The Narrows
  [42.342743, -70.940904],
  [42.37055, -70.916631], // outer harbor, north
  [42.358987, -70.903958], // turnaround
  [42.344263, -70.918004], // return leg
  [42.334671, -70.95098],
  [42.340877, -70.995485],
  [42.345615, -71.017469],
  [42.363303, -71.045078], // approaching inner harbor
  [42.363715, -71.04743], // close the loop (same as first point)
];

const DEFAULT_SPEED_KN = 6;
const DEFAULT_INTERVAL_MS = 1000;
const M_PER_DEG = 111_111;

/**
 * Position/course along a recorded track at `elapsedSec` (looped).
 * COG/SOG are derived from the bracketing segments so the reported values
 * stay consistent with the interpolated motion at any time multiplier.
 * SOG blends across segment boundaries: raw per-segment speeds carry the
 * recording's GPS position noise, and the resulting stair-steps would be
 * amplified by the time multiplier into visible jumps.
 */
export function replayPosition(
  track: [number, number, number][],
  elapsedSec: number,
): { lat: number; lon: number; cog: number; sogKn: number } {
  const duration = track[track.length - 1][0];
  const t = duration > 0 ? elapsedSec % duration : 0;

  // Binary search for the segment containing t
  let lo = 0;
  let hi = track.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (track[mid][0] <= t) lo = mid;
    else hi = mid - 1;
  }
  const [t0, lat0, lon0] = track[lo];
  const [t1, lat1, lon1] = track[lo + 1];
  const dt = t1 - t0;
  const f = dt > 0 ? (t - t0) / dt : 0;

  // Speed at a track point = mean of its adjacent segments' speeds;
  // linear blend between the bracketing points' speeds.
  const segSpeed = (i: number): number => {
    const [ta, la, na] = track[i];
    const [tb, lb, nb] = track[i + 1];
    const d = tb - ta;
    return d > 0 ? (haversineDistanceNM(la, na, lb, nb) / d) * 3600 : 0;
  };
  const cur = segSpeed(lo);
  const atStart = lo > 0 ? (segSpeed(lo - 1) + cur) / 2 : cur;
  const atEnd = lo + 2 < track.length ? (cur + segSpeed(lo + 1)) / 2 : cur;

  return {
    lat: lat0 + (lat1 - lat0) * f,
    lon: lon0 + (lon1 - lon0) * f,
    cog: initialBearingDeg(lat0, lon0, lat1, lon1),
    sogKn: atStart + (atEnd - atStart) * f,
  };
}

/**
 * Deterministic small-state RNG (mulberry32). Used by error modes so
 * test sequences are reproducible; the baseline addJitter() still uses
 * Math.random because production simulator runs benefit from the
 * non-determinism of slightly different jitter each session.
 */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller-ish standard normal from two uniform draws. */
function gaussian(rng: () => number): number {
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Offset a fix's position by (eastM, northM) metres. */
function offsetMetres(
  data: NavigationData,
  eastM: number,
  northM: number,
): NavigationData {
  const cosLat = Math.cos((data.latitude * Math.PI) / 180);
  return {
    ...data,
    latitude: data.latitude + northM / M_PER_DEG,
    longitude: data.longitude + eastM / (M_PER_DEG * cosLat),
  };
}

/** Add realistic GPS jitter to position, speed, and heading. */
function addJitter(data: NavigationData): NavigationData {
  const posJitter = 0.00005; // ~5m in degrees
  const sogJitter = 0.3; // ±0.3 kn
  const cogJitter = 3; // ±3°
  const lat = data.latitude + (Math.random() - 0.5) * 2 * posJitter;
  const lng = data.longitude + (Math.random() - 0.5) * 2 * posJitter;
  const sog =
    data.sog !== null
      ? Math.max(0, data.sog + (Math.random() - 0.5) * 2 * sogJitter)
      : null;
  const cog =
    data.cog !== null
      ? (((data.cog + (Math.random() - 0.5) * 2 * cogJitter) % 360) + 360) % 360
      : null;
  return { ...data, latitude: lat, longitude: lng, sog, cog, heading: cog };
}

export class SimulatorProvider implements NavigationDataProvider {
  readonly id = "simulator";
  readonly name = "Simulator";

  private opts: Required<
    Pick<SimulatorOptions, "mode" | "speed" | "intervalMs" | "speedMultiplier">
  > &
    SimulatorOptions;
  private listeners: NavigationDataCallback[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Accumulated simulated seconds (real time × the multiplier in effect). */
  private simElapsedSec = 0;
  /** Real-clock ms when simElapsedSec was last brought up to date. */
  private lastRealTime = 0;
  private tickCount = 0;
  private errorMode: SimulatorErrorMode;
  private errorRng: () => number;

  constructor(options?: Partial<SimulatorOptions>) {
    this.opts = {
      mode: options?.mode ?? "route",
      waypoints: options?.waypoints ?? BOSTON_HARBOR_ROUTE,
      track: options?.track,
      speed: options?.speed ?? DEFAULT_SPEED_KN,
      center: options?.center ?? [42.35, -71.04],
      radius: options?.radius ?? 0.5,
      position: options?.position ?? [42.355, -71.045],
      intervalMs: options?.intervalMs ?? DEFAULT_INTERVAL_MS,
      speedMultiplier: options?.speedMultiplier ?? 1,
    };
    this.errorMode = options?.errorMode ?? { kind: "none" };
    this.errorRng = makeRng(options?.errorSeed ?? 0xc0ffee);
  }

  /**
   * Replace the active error mode at runtime. The deterministic RNG is
   * re-seeded so the new mode's pattern is reproducible from this call
   * onward.
   */
  setErrorMode(mode: SimulatorErrorMode, seed = 0xc0ffee): void {
    this.errorMode = mode;
    this.errorRng = makeRng(seed);
  }

  isConnected(): boolean {
    return this.timer !== null;
  }

  connect(): void {
    if (this.timer) return;
    this.simElapsedSec = 0;
    this.lastRealTime = Date.now();
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

  /**
   * Change the time multiplier without moving the boat: simulated time
   * already accrued at the old rate is banked first, so only the rate of
   * future progress changes (e.g. fast-forward at 50x, then drop to 1x for
   * realistic instrument readings from the same position).
   */
  setSpeedMultiplier(multiplier: number): void {
    this.advanceSimClock();
    this.opts.speedMultiplier = multiplier;
  }

  setDesiredIntervalMs(ms: number): void {
    if (ms === this.opts.intervalMs) return;
    this.opts.intervalMs = ms;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = setInterval(() => this.tick(), ms);
    }
  }

  /** Accrue simulated time at the current multiplier up to now. */
  private advanceSimClock(): number {
    const now = Date.now();
    this.simElapsedSec +=
      ((now - this.lastRealTime) / 1000) * this.opts.speedMultiplier;
    this.lastRealTime = now;
    return this.simElapsedSec;
  }

  private tick(): void {
    const tickIdx = this.tickCount++;
    const elapsed = this.advanceSimClock();
    let data: NavigationData;

    switch (this.opts.mode) {
      case "route":
        data = this.computeRoute(elapsed);
        break;
      case "replay":
        data = this.computeReplay(elapsed);
        break;
      case "circular":
        data = this.computeCircular(elapsed);
        break;
      default:
        data = this.computeStatic();
        break;
    }

    let output = this.opts.mode === "static" ? data : addJitter(data);
    const errored = this.applyErrorMode(output, tickIdx);
    if (errored === null) return; // dropout — suppress this tick
    output = errored;
    for (const fn of this.listeners) {
      fn(output);
    }
  }

  /**
   * Apply the configured synthetic error pattern to the (already
   * baseline-jittered) data. Returns null to indicate the fix should
   * be suppressed entirely (dropout mode).
   */
  private applyErrorMode(
    data: NavigationData,
    tickIdx: number,
  ): NavigationData | null {
    const mode = this.errorMode;
    switch (mode.kind) {
      case "none":
        return data;
      case "shot": {
        if (this.errorRng() >= mode.rate) return data;
        const dir = this.errorRng() * 2 * Math.PI;
        return offsetMetres(
          data,
          mode.magnitudeM * Math.cos(dir),
          mode.magnitudeM * Math.sin(dir),
        );
      }
      case "noisy-burst": {
        const inBurst = tickIdx % mode.period < mode.burstLen;
        if (!inBurst) return data;
        return offsetMetres(
          data,
          gaussian(this.errorRng) * mode.noiseM,
          gaussian(this.errorRng) * mode.noiseM,
        );
      }
      case "sustained-bias": {
        if (
          tickIdx < mode.startTick ||
          tickIdx >= mode.startTick + mode.durationTicks
        ) {
          return data;
        }
        return offsetMetres(data, mode.biasM[0], mode.biasM[1]);
      }
      case "dropout":
        return this.errorRng() < mode.rate ? null : data;
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
    // Report effective SOG (base speed × multiplier) so nav data is
    // self-consistent with position changes between fixes.
    const effectiveSpeed = speedKn * this.opts.speedMultiplier;

    return {
      latitude: lat,
      longitude: lng,
      cog,
      sog: effectiveSpeed,
      heading: cog,
      accuracy: 5,
      timestamp: Date.now(),
      source: "simulator",
    };
  }

  private computeReplay(elapsedSec: number): NavigationData {
    const track = this.opts.track;
    if (!track || track.length < 2) return this.computeStatic();
    const p = replayPosition(track, elapsedSec);
    return {
      latitude: p.lat,
      longitude: p.lon,
      cog: p.cog,
      // Replayed motion is time-compressed by the multiplier, so the
      // reported SOG scales with it (consistent with position deltas).
      sog: p.sogKn * this.opts.speedMultiplier,
      heading: p.cog,
      accuracy: 6,
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
      sog: speedKn * this.opts.speedMultiplier,
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
