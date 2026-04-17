/**
 * Two-stage COG/SOG smoother: circular buffer averaging + exponential smoothing.
 * Shared by CourseLine (for rendering) and ChartModeController (for map rotation).
 *
 * Usage:
 *   - Call `addSample()` on each GPS update (1 Hz)
 *   - Call `smooth()` on each render frame (60 fps) for fluid animation
 */

import { toRadians } from "../utils/coordinates";

/** Default circular buffer window in milliseconds. */
const DEFAULT_BUFFER_WINDOW_MS = 5_000;

/** Buffer window at quality score q=1 (jittery GPS — wider average). */
const BAD_BUFFER_WINDOW_MS = 25_000;

/** Minimum samples to keep regardless of age. */
const MIN_SAMPLES = 2;

/** Exponential smoothing time constant for COG/SOG in seconds (q=0). */
const TAU_S = 2;
/** Tau at q=1 — heavier smoothing when GPS is known-bad. */
const TAU_BAD_S = 8;

/** Exponential smoothing time constant for position in seconds (q=0). */
const TAU_POS_S = 0.5;
/** Position tau at q=1. */
const TAU_POS_BAD_S = 3;

interface Sample {
  cog: number;
  sog: number;
  timestamp: number;
}

/**
 * Compute the circular mean of angles in degrees.
 * Returns a value in [0, 360).
 */
export function circularMeanDeg(angles: number[]): number {
  let sinSum = 0;
  let cosSum = 0;
  for (const a of angles) {
    const rad = toRadians(a);
    sinSum += Math.sin(rad);
    cosSum += Math.cos(rad);
  }
  const meanRad = Math.atan2(sinSum, cosSum);
  return ((meanRad * 180) / Math.PI + 360) % 360;
}

/**
 * Interpolate between two angles (degrees) along the shorter arc.
 * `t` is the interpolation factor (0 = from, 1 = to).
 */
export function circularInterpolate(
  from: number,
  to: number,
  t: number,
): number {
  let diff = to - from;
  // Normalize to [-180, 180]
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  return (((from + diff * t) % 360) + 360) % 360;
}

export interface SmoothedCourse {
  cog: number;
  sog: number;
  lat: number;
  lon: number;
}

export class CourseSmoothing {
  private bufferWindowMs = DEFAULT_BUFFER_WINDOW_MS;
  private bufferWindowOverride: number | null = null;
  private quality = 0;
  private buffer: Sample[] = [];
  private targetCog = 0;
  private targetSog = 0;
  private targetLat = 0;
  private targetLon = 0;
  private smoothedCog = 0;
  private smoothedSog = 0;
  private smoothedLat = 0;
  private smoothedLon = 0;
  private lastSmoothTime = 0;
  private initialized = false;
  private posInitialized = false;

  /**
   * Set the smoothing buffer window. Use to scale with GPS update interval
   * (e.g. 5 * intervalMs to always hold ~5 samples). Overrides the
   * quality-driven default; pass 0 or null to clear the override.
   */
  setBufferWindow(ms: number): void {
    this.bufferWindowOverride = ms > 0 ? ms : null;
    this.recomputeBufferWindow();
  }

  /**
   * Set the current GPS quality score in [0, 1]. 0 = good, 1 = jittery.
   * Scales the smoothing time constants and (when no explicit override is
   * set) the circular-buffer window. Call when the detector updates.
   */
  setQuality(q: number): void {
    this.quality = Math.max(0, Math.min(1, q));
    this.recomputeBufferWindow();
  }

  private recomputeBufferWindow(): void {
    if (this.bufferWindowOverride !== null) {
      this.bufferWindowMs = this.bufferWindowOverride;
    } else {
      this.bufferWindowMs =
        DEFAULT_BUFFER_WINDOW_MS +
        this.quality * (BAD_BUFFER_WINDOW_MS - DEFAULT_BUFFER_WINDOW_MS);
    }
  }

  /**
   * Feed a new GPS sample into the circular buffer.
   * Call at GPS update rate (typically 1 Hz).
   */
  addSample(
    cog: number | null,
    sog: number | null,
    lat: number,
    lon: number,
    timestamp: number,
  ): void {
    if (cog !== null && sog !== null) {
      this.buffer.push({ cog, sog, timestamp });
    } else {
      // No valid COG/SOG (stationary or no fix) — clear the buffer so
      // stale course/speed values don't persist in the smoothed output.
      this.buffer.length = 0;
    }

    // Prune old samples, but keep at least MIN_SAMPLES
    const cutoff = timestamp - this.bufferWindowMs;
    while (
      this.buffer.length > MIN_SAMPLES &&
      this.buffer[0].timestamp < cutoff
    ) {
      this.buffer.shift();
    }

    // Update position target (latest GPS fix)
    this.targetLat = lat;
    this.targetLon = lon;

    // Recompute buffer averages (Stage 1)
    if (this.buffer.length > 0) {
      this.targetCog = circularMeanDeg(this.buffer.map((s) => s.cog));
      let sum = 0;
      for (const s of this.buffer) sum += s.sog;
      this.targetSog = sum / this.buffer.length;
    }
  }

  /**
   * Snap smoothed values to their targets immediately.
   * Use on e-ink to avoid multi-frame convergence animation.
   */
  snapToTarget(): void {
    this.smoothedCog = this.targetCog;
    this.smoothedSog = this.targetSog;
    this.smoothedLat = this.targetLat;
    this.smoothedLon = this.targetLon;
  }

  /**
   * Run exponential smoothing toward the buffer-averaged target.
   * Call on every render frame for fluid animation.
   * Returns the smoothed COG/SOG, or null if no samples yet.
   */
  smooth(now: number): SmoothedCourse | null {
    if (this.buffer.length === 0) {
      return null;
    }

    if (!this.initialized) {
      this.smoothedCog = this.targetCog;
      this.smoothedSog = this.targetSog;
      this.lastSmoothTime = now;
      this.initialized = true;
    } else {
      const dt = (now - this.lastSmoothTime) / 1000;
      this.lastSmoothTime = now;
      if (dt > 0 && dt < 1) {
        // Guard against huge dt (e.g. tab backgrounded)
        const tau = TAU_S + this.quality * (TAU_BAD_S - TAU_S);
        const tauPos = TAU_POS_S + this.quality * (TAU_POS_BAD_S - TAU_POS_S);
        const alpha = 1 - Math.exp(-dt / tau);
        this.smoothedCog = circularInterpolate(
          this.smoothedCog,
          this.targetCog,
          alpha,
        );
        this.smoothedSog += alpha * (this.targetSog - this.smoothedSog);

        // Position smoothing (shorter time constant)
        const posAlpha = 1 - Math.exp(-dt / tauPos);
        this.smoothedLat += posAlpha * (this.targetLat - this.smoothedLat);
        this.smoothedLon += posAlpha * (this.targetLon - this.smoothedLon);
      }
    }

    // Initialize position on first sample
    if (!this.posInitialized && this.targetLat !== 0) {
      this.smoothedLat = this.targetLat;
      this.smoothedLon = this.targetLon;
      this.posInitialized = true;
    }

    return {
      cog: this.smoothedCog,
      sog: this.smoothedSog,
      lat: this.smoothedLat,
      lon: this.smoothedLon,
    };
  }
}
