/**
 * Two-stage COG/SOG smoother: circular buffer averaging + exponential smoothing.
 * Shared by CourseLine (for rendering) and ChartModeController (for map rotation).
 */

import { toRadians } from "../utils/coordinates";

/** Circular buffer window in milliseconds. */
const BUFFER_WINDOW_MS = 15_000;

/** Exponential smoothing time constant in seconds. */
const TAU_S = 3;

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
}

export class CourseSmoothing {
  private buffer: Sample[] = [];
  private smoothedCog = 0;
  private smoothedSog = 0;
  private lastUpdateTime = 0;
  private initialized = false;

  /**
   * Feed a new navigation sample. Call on every GPS update.
   * Returns the smoothed COG/SOG, or null if insufficient data.
   */
  update(
    cog: number | null,
    sog: number | null,
    timestamp: number,
  ): SmoothedCourse | null {
    // Add sample to buffer if COG/SOG are available
    if (cog !== null && sog !== null) {
      this.buffer.push({ cog, sog, timestamp });
    }

    // Prune old samples
    const cutoff = timestamp - BUFFER_WINDOW_MS;
    while (this.buffer.length > 0 && this.buffer[0].timestamp < cutoff) {
      this.buffer.shift();
    }

    if (this.buffer.length === 0) {
      return null;
    }

    // Stage 1: circular buffer averages
    const avgCog = circularMeanDeg(this.buffer.map((s) => s.cog));
    let avgSog = 0;
    for (const s of this.buffer) avgSog += s.sog;
    avgSog /= this.buffer.length;

    // Stage 2: exponential smoothing
    if (!this.initialized) {
      this.smoothedCog = avgCog;
      this.smoothedSog = avgSog;
      this.lastUpdateTime = timestamp;
      this.initialized = true;
    } else {
      const dt = (timestamp - this.lastUpdateTime) / 1000;
      this.lastUpdateTime = timestamp;
      const alpha = 1 - Math.exp(-dt / TAU_S);
      this.smoothedCog = circularInterpolate(this.smoothedCog, avgCog, alpha);
      this.smoothedSog += alpha * (avgSog - this.smoothedSog);
    }

    return { cog: this.smoothedCog, sog: this.smoothedSog };
  }
}
