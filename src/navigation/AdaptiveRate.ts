/**
 * Adaptive GPS sampling rate controller.
 * Reduces GPS polling when high-frequency updates aren't needed
 * (stationary, steady course) and increases immediately when maneuvering.
 */

import { haversineDistanceNM, projectPoint } from "../utils/coordinates";
import type { NavigationData } from "./NavigationData";

export type AdaptiveTier = "fast" | "medium" | "slow";

export interface AdaptiveRateConfig {
  /** SOG threshold in knots below which vessel is considered stationary */
  stationaryThresholdKn: number;
  /** DR error threshold in NM — above this triggers fast tier */
  drErrorThresholdNM: number;
  /** Number of consecutive steady samples to transition fast → medium */
  steadySamplesRequired: number;
  /** Interval ms for each tier */
  fastIntervalMs: number;
  mediumIntervalMs: number;
  slowIntervalMs: number;
  /** Gap in ms after which we treat as fresh start */
  staleGapMs: number;
  /**
   * After a maneuver (DR-error spike) or a moving↔stopped transition, hold
   * the fast tier for this long regardless of how steady the course looks —
   * situational awareness matters most right around a turn, a docking, or
   * an anchor setting. Retriggered events extend the window.
   */
  burstMs: number;
}

export const DEFAULT_ADAPTIVE_CONFIG: AdaptiveRateConfig = {
  stationaryThresholdKn: 0.5,
  drErrorThresholdNM: 0.02,
  steadySamplesRequired: 15,
  fastIntervalMs: 2000,
  // Medium/slow tiers only apply on e-ink (non-e-ink forces the fast tier), so
  // these set the e-ink steady/idle cadence. 3 s steady keeps the chart lively
  // there without much extra refresh cost given the atomic per-fix update.
  mediumIntervalMs: 3000,
  slowIntervalMs: 10000,
  staleGapMs: 30000,
  burstMs: 20000,
};

export interface AdaptiveRateState {
  tier: AdaptiveTier;
  intervalMs: number;
  steadyCount: number;
  /** Epoch ms until which the burst window holds the fast tier (0 = none). */
  burstUntilMs: number;
}

/** Tier-to-interval mapping. */
export function tierIntervalMs(
  tier: AdaptiveTier,
  config: AdaptiveRateConfig,
): number {
  switch (tier) {
    case "fast":
      return config.fastIntervalMs;
    case "medium":
      return config.mediumIntervalMs;
    case "slow":
      return config.slowIntervalMs;
  }
}

/**
 * Compute dead-reckoning error: project previous fix forward and compare
 * to actual position. Returns distance in NM.
 */
export function computeDRError(
  prevLat: number,
  prevLon: number,
  prevCog: number,
  prevSogKn: number,
  elapsedMs: number,
  actualLat: number,
  actualLon: number,
): number {
  const elapsedHours = elapsedMs / 3_600_000;
  const distanceNM = prevSogKn * elapsedHours;
  // projectPoint returns [lon, lat]
  const [predictedLon, predictedLat] = projectPoint(
    prevLat,
    prevLon,
    prevCog,
    distanceNM,
  );
  return haversineDistanceNM(predictedLat, predictedLon, actualLat, actualLon);
}

/**
 * Pure state machine: decide the next tier based on current state and inputs.
 */
export function decideTier(
  currentTier: AdaptiveTier,
  sog: number | null,
  drError: number | null,
  steadyCount: number,
  config: AdaptiveRateConfig,
): { tier: AdaptiveTier; steadyCount: number } {
  // Stationary → slow
  if (sog === null || sog < config.stationaryThresholdKn) {
    return { tier: "slow", steadyCount: 0 };
  }

  // Moving — check DR error
  if (drError === null) {
    // No DR data yet (first fix after moving) → fast
    return { tier: "fast", steadyCount: 0 };
  }

  // Maneuvering → immediate fast
  if (drError > config.drErrorThresholdNM) {
    return { tier: "fast", steadyCount: 0 };
  }

  // Steady course
  const newSteadyCount = steadyCount + 1;

  if (
    currentTier === "fast" &&
    newSteadyCount >= config.steadySamplesRequired
  ) {
    return { tier: "medium", steadyCount: newSteadyCount };
  }

  // Already medium or accumulating steady samples in fast
  return {
    tier: currentTier === "slow" ? "fast" : currentTier,
    steadyCount: newSteadyCount,
  };
}

/**
 * Stateful adaptive rate controller. Feed it every fix and it tells you
 * the current tier / whether to broadcast.
 */
export class AdaptiveRateController {
  private state: AdaptiveRateState;
  private prevFix: NavigationData | null = null;
  private lastBroadcastTime = 0;
  private config: AdaptiveRateConfig;
  /** When true, tier is locked to "fast" (never downgrades). */
  private _forceFast = false;
  /** Fix-timestamp until which the burst window holds the fast tier. */
  private burstUntil = 0;

  constructor(config?: Partial<AdaptiveRateConfig>) {
    this.config = { ...DEFAULT_ADAPTIVE_CONFIG, ...config };
    this.state = {
      tier: "fast",
      intervalMs: this.config.fastIntervalMs,
      steadyCount: 0,
      burstUntilMs: 0,
    };
  }

  /**
   * Process an incoming fix. Returns the updated state.
   * Call shouldBroadcast() to determine if this fix should be sent to subscribers.
   */
  onFix(data: NavigationData): AdaptiveRateState {
    const prev = this.prevFix;

    // Detect stale gap or first fix
    if (!prev || data.timestamp - prev.timestamp > this.config.staleGapMs) {
      this.prevFix = data;
      this.state = {
        tier: "fast",
        intervalMs: this.config.fastIntervalMs,
        steadyCount: 0,
        burstUntilMs: this.burstUntil,
      };
      return this.state;
    }

    const elapsedMs = data.timestamp - prev.timestamp;

    // Compute DR error if we have COG and SOG from previous fix
    let drError: number | null = null;
    if (prev.cog !== null && prev.sog !== null && prev.sog > 0) {
      drError = computeDRError(
        prev.latitude,
        prev.longitude,
        prev.cog,
        prev.sog,
        elapsedMs,
        data.latitude,
        data.longitude,
      );
    }

    // Burst triggers: a maneuver (DR-error spike) or a moving↔stopped
    // transition — both moments where the next half-minute matters.
    const stationary = (sog: number | null) =>
      sog === null || sog < this.config.stationaryThresholdKn;
    const maneuvering =
      drError !== null && drError > this.config.drErrorThresholdNM;
    if (maneuvering || stationary(prev.sog) !== stationary(data.sog)) {
      this.burstUntil = data.timestamp + this.config.burstMs;
    }
    const bursting = data.timestamp < this.burstUntil;

    const result = decideTier(
      this.state.tier,
      data.sog,
      drError,
      this.state.steadyCount,
      this.config,
    );

    const tier = this._forceFast || bursting ? "fast" : result.tier;
    this.state = {
      tier,
      intervalMs: tierIntervalMs(tier, this.config),
      steadyCount: result.steadyCount,
      burstUntilMs: this.burstUntil,
    };

    this.prevFix = data;
    return this.state;
  }

  /**
   * Whether enough time has elapsed since the last broadcast.
   * Defaults to the current tier interval; pass an explicit interval to
   * gate on a fixed rate (e.g. manual mode, which never runs onFix()).
   */
  shouldBroadcast(
    timestamp: number,
    intervalMs: number = this.state.intervalMs,
  ): boolean {
    if (this.lastBroadcastTime === 0) return true;
    return timestamp - this.lastBroadcastTime >= intervalMs;
  }

  /** Mark that a broadcast was sent at the given timestamp. */
  markBroadcast(timestamp: number): void {
    this.lastBroadcastTime = timestamp;
  }

  getState(): Readonly<AdaptiveRateState> {
    return this.state;
  }

  getConfig(): Readonly<AdaptiveRateConfig> {
    return this.config;
  }

  /** Lock tier to "fast" (e.g. screen on, non-e-ink). */
  set forceFast(value: boolean) {
    this._forceFast = value;
    if (value && this.state.tier !== "fast") {
      this.state = {
        tier: "fast",
        intervalMs: this.config.fastIntervalMs,
        steadyCount: 0,
        burstUntilMs: this.burstUntil,
      };
    }
  }

  get forceFast(): boolean {
    return this._forceFast;
  }

  reset(): void {
    this.prevFix = null;
    this.lastBroadcastTime = 0;
    this.burstUntil = 0;
    this.state = {
      tier: "fast",
      intervalMs: this.config.fastIntervalMs,
      steadyCount: 0,
      burstUntilMs: 0,
    };
  }
}
