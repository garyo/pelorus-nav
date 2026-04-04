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
}

export const DEFAULT_ADAPTIVE_CONFIG: AdaptiveRateConfig = {
  stationaryThresholdKn: 0.5,
  drErrorThresholdNM: 0.02,
  steadySamplesRequired: 15,
  fastIntervalMs: 2000,
  mediumIntervalMs: 5000,
  slowIntervalMs: 10000,
  staleGapMs: 30000,
};

export interface AdaptiveRateState {
  tier: AdaptiveTier;
  intervalMs: number;
  steadyCount: number;
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

  constructor(config?: Partial<AdaptiveRateConfig>) {
    this.config = { ...DEFAULT_ADAPTIVE_CONFIG, ...config };
    this.state = {
      tier: "fast",
      intervalMs: this.config.fastIntervalMs,
      steadyCount: 0,
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

    const result = decideTier(
      this.state.tier,
      data.sog,
      drError,
      this.state.steadyCount,
      this.config,
    );

    this.state = {
      tier: result.tier,
      intervalMs: tierIntervalMs(result.tier, this.config),
      steadyCount: result.steadyCount,
    };

    this.prevFix = data;
    return this.state;
  }

  /**
   * Whether enough time has elapsed since the last broadcast for the current tier.
   * Also returns true if tier transitioned to "fast" (immediate upgrade).
   */
  shouldBroadcast(timestamp: number): boolean {
    if (this.lastBroadcastTime === 0) return true;
    return timestamp - this.lastBroadcastTime >= this.state.intervalMs;
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

  reset(): void {
    this.prevFix = null;
    this.lastBroadcastTime = 0;
    this.state = {
      tier: "fast",
      intervalMs: this.config.fastIntervalMs,
      steadyCount: 0,
    };
  }
}
