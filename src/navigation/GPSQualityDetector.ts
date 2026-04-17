/**
 * Rolling detector that scores GPS quality in [0, 1] from recent fixes.
 * 0 = good (steady fixes, smooth path); 1 = terrible (jittery hardware).
 *
 * Three independent signals, each normalized to [0, 1]; the overall score
 * is the maximum so any one bad signal dominates. The outputs feed:
 *   - GPSFilter: measurement-noise floor + COG output gating
 *   - CourseSmoothing: buffer window + smoothing tau
 *
 * Tuned against real tracks from a weak e-ink tablet GPS (17m position
 * jitter, 9s median fix interval, 44% step-vector reversal rate) versus a
 * good phone GPS (<1m jitter, 1s fix, 3% reversal rate).
 */
import type { NavigationData } from "./NavigationData";

/** Number of recent fixes used in the rolling score. */
const WINDOW = 10;

/** Minimum fixes before any non-zero score. */
const MIN_SAMPLES = 5;

/** Low-pass time constant on the quality score itself (samples).
 *  Prevents brief anomalies from engaging heavy filtering. */
const Q_SMOOTH_SAMPLES = 6;

/** Reversal rate (0..1): >90° step-vector turns / moving steps.
 *  0 rate → 0 score; threshold → 1 score. */
const REVERSAL_THRESHOLD = 0.2;

/** Fix interval: below low → 0 score, above high → 1 score. */
const INTERVAL_LOW_MS = 2000;
const INTERVAL_HIGH_MS = 8000;

/** Local position scatter (m): 3-point residual.
 *  below low → 0, above high → 1. */
const SCATTER_LOW_M = 2;
const SCATTER_HIGH_M = 17;

/** Device-reported accuracy (m): below low → 0, above high → 1.
 *  When provider reports no accuracy, this signal is suppressed. */
const ACCURACY_LOW_M = 10;
const ACCURACY_HIGH_M = 30;

/** Ignore step vectors shorter than this (m) — noise, not motion. */
const STEP_NOISE_FLOOR_M = 1;

const M_PER_DEG = 111_111;

interface Fix {
  lat: number;
  lon: number;
  t: number;
  accuracy: number | null;
}

export interface QualitySignals {
  /** Smoothed composite score in [0, 1]. */
  q: number;
  /** Instantaneous (pre-smoothing) score in [0, 1]. */
  qRaw: number;
  /** Fraction of step vectors that reversed direction (>90°). */
  reversalRate: number;
  /** Median fix interval in ms. */
  intervalMs: number;
  /** Mean 3-point residual in metres (local scatter). */
  scatterM: number;
  /** Median device-reported accuracy in metres, or null. */
  accuracyM: number | null;
}

function distM(a: Fix, b: Fix): number {
  const cosLat = Math.cos((a.lat * Math.PI) / 180);
  const dLat = (b.lat - a.lat) * M_PER_DEG;
  const dLon = (b.lon - a.lon) * M_PER_DEG * cosLat;
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

function bearing(a: Fix, b: Fix): number {
  const cosLat = Math.cos((a.lat * Math.PI) / 180);
  const dLat = b.lat - a.lat;
  const dLon = (b.lon - a.lon) * cosLat;
  let deg = (Math.atan2(dLon, dLat) * 180) / Math.PI;
  if (deg < 0) deg += 360;
  return deg;
}

function angDiff(a: number, b: number): number {
  let d = ((a - b + 540) % 360) - 180;
  if (d < -180) d += 360;
  return Math.abs(d);
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function ramp(value: number, low: number, high: number): number {
  if (value <= low) return 0;
  if (value >= high) return 1;
  return (value - low) / (high - low);
}

export class GPSQualityDetector {
  private window: Fix[] = [];
  private smoothedQ = 0;
  private initialized = false;
  private lastSignals: QualitySignals = {
    q: 0,
    qRaw: 0,
    reversalRate: 0,
    intervalMs: 0,
    scatterM: 0,
    accuracyM: null,
  };

  /** Feed a raw fix into the detector. Returns the updated signals. */
  onFix(fix: NavigationData): QualitySignals {
    this.window.push({
      lat: fix.latitude,
      lon: fix.longitude,
      t: fix.timestamp,
      accuracy: fix.accuracy ?? null,
    });
    if (this.window.length > WINDOW) this.window.shift();

    const sigs = this.computeSignals();
    // Exponential low-pass on the q signal so a single noisy sample can't
    // flip the filter hard. Equivalent to a ~Q_SMOOTH_SAMPLES EMA.
    const alpha = 2 / (Q_SMOOTH_SAMPLES + 1);
    if (!this.initialized) {
      this.smoothedQ = sigs.qRaw;
      this.initialized = true;
    } else {
      this.smoothedQ += alpha * (sigs.qRaw - this.smoothedQ);
    }
    this.lastSignals = { ...sigs, q: this.smoothedQ };
    return this.lastSignals;
  }

  /** Reset the rolling state (call on provider change). */
  reset(): void {
    this.window = [];
    this.smoothedQ = 0;
    this.initialized = false;
    this.lastSignals = {
      q: 0,
      qRaw: 0,
      reversalRate: 0,
      intervalMs: 0,
      scatterM: 0,
      accuracyM: null,
    };
  }

  /** Most recent signals without advancing the detector. */
  getSignals(): Readonly<QualitySignals> {
    return this.lastSignals;
  }

  private computeSignals(): QualitySignals {
    const w = this.window;
    if (w.length < MIN_SAMPLES) {
      return {
        q: 0,
        qRaw: 0,
        reversalRate: 0,
        intervalMs: 0,
        scatterM: 0,
        accuracyM: null,
      };
    }

    // 1) Step-vector reversal rate.
    let reversals = 0;
    let steps = 0;
    for (let i = 2; i < w.length; i++) {
      const d1 = distM(w[i - 2], w[i - 1]);
      const d2 = distM(w[i - 1], w[i]);
      if (d1 < STEP_NOISE_FLOOR_M || d2 < STEP_NOISE_FLOOR_M) continue;
      const b1 = bearing(w[i - 2], w[i - 1]);
      const b2 = bearing(w[i - 1], w[i]);
      if (angDiff(b1, b2) > 90) reversals++;
      steps++;
    }
    const reversalRate = steps > 0 ? reversals / steps : 0;
    const qRev = ramp(reversalRate, 0, REVERSAL_THRESHOLD);

    // 2) Median fix interval (robust to a single long gap).
    const intervals: number[] = [];
    for (let i = 1; i < w.length; i++) {
      const dt = w[i].t - w[i - 1].t;
      if (dt > 0) intervals.push(dt);
    }
    const medIntv = median(intervals);
    const qInt = ramp(medIntv, INTERVAL_LOW_MS, INTERVAL_HIGH_MS);

    // 3) Local scatter: distance from each middle fix to a line drawn
    // between its neighbours. On a smooth path near-zero; on jittery GPS
    // comparable to the position-noise radius.
    let scatterSum = 0;
    let scatterCount = 0;
    for (let i = 1; i < w.length - 1; i++) {
      const a = w[i - 1];
      const b = w[i + 1];
      const dt = b.t - a.t;
      if (dt <= 0) continue;
      const f = (w[i].t - a.t) / dt;
      const lat = a.lat + (b.lat - a.lat) * f;
      const lon = a.lon + (b.lon - a.lon) * f;
      scatterSum += distM({ lat, lon, t: 0, accuracy: null }, w[i]);
      scatterCount++;
    }
    const meanScatter = scatterCount > 0 ? scatterSum / scatterCount : 0;
    const qSca = ramp(meanScatter, SCATTER_LOW_M, SCATTER_HIGH_M);

    // 4) Device-reported accuracy (median — ignores spurious spikes).
    const accs = w
      .map((p) => p.accuracy)
      .filter((a): a is number => a !== null);
    const medAcc = accs.length > 0 ? median(accs) : null;
    const qAcc =
      medAcc !== null ? ramp(medAcc, ACCURACY_LOW_M, ACCURACY_HIGH_M) : 0;

    const qRaw = Math.max(qRev, qInt, qSca, qAcc);

    return {
      q: qRaw, // will be overwritten by the smoothed value in onFix()
      qRaw,
      reversalRate,
      intervalMs: medIntv,
      scatterM: meanScatter,
      accuracyM: medAcc,
    };
  }
}
