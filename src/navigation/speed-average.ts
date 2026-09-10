/**
 * Passage-average speed over ground, for ETAs.
 *
 * The GPS chip's Doppler SOG is jittery fix to fix, so time-to-go computed
 * from it jumps around. This keeps a time-weighted average of the velocity
 * *vector* over the last few minutes: its magnitude is a steady average
 * speed, and its projection onto the bearing to a waypoint is the closing
 * speed, which stays honest while tacking or steering off the rhumb line.
 *
 * A short window is compared against the long one on every read. When the
 * two disagree by more than a couple of standard deviations (engine started,
 * sails trimmed, a tack), the boat's speed has genuinely changed and the
 * long average is stale, so the reading switches to the short window until
 * the long one catches up. Callers show such readings as provisional.
 *
 * All timing uses fix timestamps, never the wall clock, so replay and
 * throttled broadcast cadences (250 ms to 15 s) average correctly.
 */

/** Long averaging window: the steady ETA speed. */
export const LONG_WINDOW_MS = 180_000;
/** Short window compared against the long one to detect a speed change. */
export const SHORT_WINDOW_MS = 30_000;
/** No average is reported until this much data exists. */
export const MIN_SPAN_MS = SHORT_WINDOW_MS;
/** A gap between fixes longer than this restarts the average. */
export const MAX_GAP_MS = 30_000;
/** Short/long disagreement, in long-window standard deviations, that counts
 *  as a speed change... */
const SETTLING_SIGMA = 2;
/** ...with this floor so tiny jitter in a very steady speed never trips it. */
const SETTLING_FLOOR_KN = 0.3;

export interface SpeedAverage {
  /** Average speed over ground, knots. */
  speedKn: number;
  /** Average velocity, knots, as east and north components. */
  velocity: { east: number; north: number };
  /** Standard deviation of SOG over the long window, knots. */
  sdKn: number;
  /** True while the speed has recently changed and the average comes from
   *  the short window; the long window has not caught up yet. */
  settling: boolean;
  /** Time span of the data behind the average, ms. */
  spanMs: number;
}

export interface SpeedAverager {
  /** Add one fix. Null SOG is skipped; null COG with a speed counts as
   *  speed without direction (drifting, or a stationary vessel). */
  addSample(
    sogKn: number | null,
    cogDeg: number | null,
    timestampMs: number,
  ): void;
  /** The current average, or null until MIN_SPAN_MS of data exist. */
  get(): SpeedAverage | null;
  reset(): void;
}

interface Sample {
  t: number;
  sog: number;
  east: number;
  north: number;
}

interface WindowStats {
  speedKn: number;
  east: number;
  north: number;
  sdKn: number;
}

/**
 * Time-weighted mean and SOG standard deviation of the samples at or after
 * `from`. Each sample is weighted by the interval to the next one; the last
 * sample, which has no successor, carries the previous interval. Null with
 * fewer than two samples in the window.
 */
function windowStats(samples: Sample[], from: number): WindowStats | null {
  let start = samples.findIndex((s) => s.t >= from);
  if (start < 0) start = samples.length;
  const n = samples.length - start;
  if (n < 2) return null;

  let wSum = 0;
  let sog = 0;
  let sog2 = 0;
  let east = 0;
  let north = 0;
  for (let i = start; i < samples.length; i++) {
    const s = samples[i];
    const w =
      i + 1 < samples.length
        ? samples[i + 1].t - s.t
        : samples[i].t - samples[i - 1].t;
    wSum += w;
    sog += w * s.sog;
    sog2 += w * s.sog * s.sog;
    east += w * s.east;
    north += w * s.north;
  }
  if (wSum <= 0) return null;
  const meanSog = sog / wSum;
  const variance = Math.max(0, sog2 / wSum - meanSog * meanSog);
  return {
    speedKn: meanSog,
    east: east / wSum,
    north: north / wSum,
    sdKn: Math.sqrt(variance),
  };
}

export function createSpeedAverager(): SpeedAverager {
  let samples: Sample[] = [];

  return {
    addSample(sogKn, cogDeg, timestampMs): void {
      if (sogKn === null || !Number.isFinite(sogKn)) return;
      const last = samples[samples.length - 1];
      if (last !== undefined) {
        if (timestampMs <= last.t) return;
        if (timestampMs - last.t > MAX_GAP_MS) samples = [];
      }
      const rad = cogDeg === null ? null : (cogDeg * Math.PI) / 180;
      samples.push({
        t: timestampMs,
        sog: sogKn,
        east: rad === null ? 0 : sogKn * Math.sin(rad),
        north: rad === null ? 0 : sogKn * Math.cos(rad),
      });
      const cutoff = timestampMs - LONG_WINDOW_MS;
      const firstKept = samples.findIndex((s) => s.t >= cutoff);
      if (firstKept > 0) samples.splice(0, firstKept);
    },

    get(): SpeedAverage | null {
      if (samples.length < 2) return null;
      const first = samples[0];
      const last = samples[samples.length - 1];
      const spanMs = last.t - first.t;
      if (spanMs < MIN_SPAN_MS) return null;

      const long = windowStats(samples, first.t);
      if (long === null) return null;
      const short = windowStats(samples, last.t - SHORT_WINDOW_MS);
      const threshold = Math.max(SETTLING_SIGMA * long.sdKn, SETTLING_FLOOR_KN);
      const settling =
        short !== null && Math.abs(short.speedKn - long.speedKn) > threshold;
      const chosen = settling && short !== null ? short : long;
      return {
        speedKn: chosen.speedKn,
        velocity: { east: chosen.east, north: chosen.north },
        sdKn: long.sdKn,
        settling,
        spanMs,
      };
    },

    reset(): void {
      samples = [];
    },
  };
}

/**
 * Component of the average velocity toward `bearingDeg` (true), knots.
 * Negative when the vessel is on average moving away from it.
 */
export function closingSpeedKn(avg: SpeedAverage, bearingDeg: number): number {
  const rad = (bearingDeg * Math.PI) / 180;
  return avg.velocity.east * Math.sin(rad) + avg.velocity.north * Math.cos(rad);
}
