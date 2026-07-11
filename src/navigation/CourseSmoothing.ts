/**
 * Two-stage COG/SOG smoother: circular buffer averaging + exponential smoothing.
 * Shared by CourseLine (for rendering) and ChartModeController (for map rotation).
 *
 * Usage:
 *   - Call `addSample()` on each GPS update (1 Hz)
 *   - Call `smooth()` on each render frame (60 fps) for fluid animation
 */

import { toRadians } from "../utils/coordinates";

/**
 * Default circular buffer window in milliseconds.
 *
 * 2026-06 field tuning: this smoother consumes COG/SOG that the GPS Kalman
 * filter has already smoothed, so a wide window double-counted — through a
 * measured 109° tack, window 5 s + tau 2 s added ~6 s on top of the
 * Kalman's ~4 s. Halving both cut total course-line slew from ~10 s to ~7 s.
 */
const DEFAULT_BUFFER_WINDOW_MS = 2_500;

/**
 * Cap for the e-ink smoothing window, which scales with the adaptive GPS
 * interval (×3 to hold ~3 samples). The window's mean lags reality by about
 * half its width, and field testing (2026-06) found the original ×5/25 s
 * made the course line noticeably laggy through turns; ×3/12 s trades a
 * little steadiness for ~6 s of lag instead of ~12 s.
 */
export const EINK_BUFFER_WINDOW_MAX_MS = 12_000;

/** E-ink smoothing window for a given adaptive GPS interval. */
export function einkBufferWindowMs(intervalMs: number): number {
  return Math.min(intervalMs * 3, EINK_BUFFER_WINDOW_MAX_MS);
}

/** Buffer window at quality score q=1 (jittery GPS — wider average). */
const BAD_BUFFER_WINDOW_MS = 25_000;

/** Minimum samples to keep regardless of age. */
const MIN_SAMPLES = 2;

/** Exponential smoothing time constant for COG/SOG in seconds (q=0). */
const TAU_S = 1;
/**
 * Tau at q=1 — heavier smoothing when GPS is known-bad. Halved from 8 s
 * (2026-06 field tuning): the course line slewed too slowly to the real
 * heading, especially resuming after inactivity.
 */
const TAU_BAD_S = 4;

/** Exponential smoothing time constant for position in seconds (q=0). */
const TAU_POS_S = 0.5;
/** Position tau at q=1. */
const TAU_POS_BAD_S = 3;

/**
 * Max-error snap guard. If the smoothed COG ever falls more than this far
 * behind the target — e.g. a render stall froze it while the true course kept
 * turning — snap to the target instead of slewing slowly across a near
 * reversal. Bounds the worst-case displayed heading error to a single frame.
 * Set well above any plausible per-step turn so normal maneuvers still ease.
 */
const MAX_COG_ERROR_SNAP_DEG = 120;

/**
 * Turn-commit detection. The buffer mean treats a genuine course change like
 * noise: through a tack the target staircases as the sample majority flips,
 * and the quality score rises (the maneuver reads as jitter), widening the
 * window exactly when responsiveness is wanted — measured 2026-07 in the
 * simulator: ~10 s of three-phase slew for a 104° tack at 2 s fixes.
 *
 * The fix: when the samples of the last TURN_RECENT_SPAN_MS agree with each
 * other but diverge from the older buffer contents by TURN_COMMIT_DEG, that's
 * a real course change, not noise — drop the older samples so the target
 * moves to the new consensus in one step. A sustained turn (5–15 s at
 * roughly constant turn rate) re-commits as divergence re-accumulates,
 * keeping the buffer short for the whole maneuver; turn-stop simply stops
 * the commits and normal smoothing resumes on the settled course.
 *
 * All thresholds are ΔT-relative (seconds, degrees) — behavior must be the
 * same at 1 Hz and 0.5 Hz fix rates.
 */
/** Span of the "recent consensus" group, newest-sample-relative. */
const TURN_RECENT_SPAN_MS = 2_500;
/** Recent group must cover at least this much time — a single fix (or a
 *  burst arriving in the same instant) can never commit a turn. */
const TURN_MIN_CONFIRM_MS = 1_000;
/** Recent-vs-older divergence that commits a course change. */
const TURN_COMMIT_DEG = 25;
/**
 * The newest fix must sit near the recent mean for a commit. A single shot
 * glitch (fix 90° off, next fix back on course) makes the recent mean land
 * halfway between — far from the newest fix — so glitch pairs are rejected,
 * while a steady turn keeps newest within ~(turn rate × span/2) of the mean
 * (≤ ~25° up to about 20°/s).
 */
const TURN_AGREE_DEG = 25;
/**
 * After a commit, stay in responsive turn mode this long (window capped at
 * the recent span, tau at its base value, quality scaling ignored) so an
 * extended rounding tracks smoothly between successive re-commits.
 */
const TURN_HOLD_MS = 4_000;
/**
 * While turn mode is active, the hold is refreshed as long as the (span-
 * capped) buffer still shows this much rotation end-to-end — a sustained
 * rounding (5–15 s at roughly constant rate) keeps the smoother responsive
 * for its whole duration instead of sawtoothing as the hold expires and
 * divergence has to re-accumulate. 15° over the ≤2.5 s span ≈ 6°/s.
 */
const TURN_SUSTAIN_DEG = 15;

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

/** Shortest angular distance between two bearings (degrees), in [0, 180]. */
export function circularDistanceDeg(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
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
   * Set when a large render gap (screen-off / backgrounded resume) is seen.
   * While set, both smooth() and addSample() snap to target rather than slew,
   * so the course seeds straight from the recovered fg-service points instead
   * of crawling over from a stale pre-gap value. Cleared on the next normal
   * frame, once the recovery drain burst has landed.
   */
  private pendingSnap = false;
  /**
   * Sample-timestamp until which a committed turn keeps the smoother in
   * responsive mode. Maintained entirely in the GPS-fix clock domain (smooth()
   * may run on a different clock), so `turnActive` is updated in addSample()
   * and only read elsewhere.
   */
  private turnHoldUntil = 0;
  private turnActive = false;

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

    this.detectTurn(timestamp);

    // Prune old samples, but keep at least MIN_SAMPLES. During a committed
    // turn the window is capped at the recent span regardless of the
    // quality-scaled width — old-course samples must not drag the mean
    // through a genuine maneuver.
    const windowMs = this.turnActive
      ? Math.min(this.bufferWindowMs, TURN_RECENT_SPAN_MS)
      : this.bufferWindowMs;
    const cutoff = timestamp - windowMs;
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

    // During a post-resume recovery burst the drained points can land after
    // the gap was detected in smooth(); keep snapping so we settle on the
    // freshly-recovered course rather than slewing from the stale value.
    if (this.pendingSnap) this.snapToTarget();
  }

  /** Whether a committed course change currently holds the smoother in
   *  responsive mode. Exposed for diagnostics. */
  isTurning(): boolean {
    return this.turnActive;
  }

  /**
   * Turn-commit check (see the TURN_* constant docs). Splits the buffer into
   * a recent consensus group and everything older; when they diverge beyond
   * TURN_COMMIT_DEG — and the newest fix agrees with the recent mean — the
   * older samples are dropped and the hold window starts/extends.
   */
  private detectTurn(timestamp: number): void {
    this.turnActive = this.buffer.length > 0 && timestamp < this.turnHoldUntil;

    // Sustain: while turn mode holds the window at the recent span, the
    // buffer's end-to-end rotation is the live turn rate — keep the hold
    // alive as long as the boat is still visibly coming around.
    if (this.turnActive && this.buffer.length >= 2) {
      const first = this.buffer[0];
      const last = this.buffer[this.buffer.length - 1];
      if (circularDistanceDeg(first.cog, last.cog) >= TURN_SUSTAIN_DEG) {
        this.turnHoldUntil = timestamp + TURN_HOLD_MS;
      }
    }

    const recentCutoff = timestamp - TURN_RECENT_SPAN_MS;
    let split = this.buffer.length;
    while (split > 0 && this.buffer[split - 1].timestamp >= recentCutoff) {
      split--;
    }
    if (split === 0) return; // nothing older than the recent span
    const recent = this.buffer.slice(split);
    if (
      recent.length < 2 ||
      recent[recent.length - 1].timestamp - recent[0].timestamp <
        TURN_MIN_CONFIRM_MS
    ) {
      return; // not enough confirmed time on the new course yet
    }

    const recentMean = circularMeanDeg(recent.map((s) => s.cog));
    const olderMean = circularMeanDeg(
      this.buffer.slice(0, split).map((s) => s.cog),
    );
    if (
      circularDistanceDeg(recentMean, olderMean) >= TURN_COMMIT_DEG &&
      circularDistanceDeg(recent[recent.length - 1].cog, recentMean) <=
        TURN_AGREE_DEG
    ) {
      this.buffer = recent;
      this.turnHoldUntil = timestamp + TURN_HOLD_MS;
      this.turnActive = true;
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
      if (dt >= 1) {
        // A large render gap means we just resumed from a no-render period
        // (screen-off / backgrounded). The buffer holds the recovered
        // fg-service points, so snap to that course/position instead of
        // slewing from the now-stale smoothed value. pendingSnap keeps us
        // snapping as the recovery drain lands (it can arrive a frame later)
        // and is cleared on the next normal frame below.
        this.pendingSnap = true;
        this.snapToTarget();
      } else if (dt > 0) {
        if (this.pendingSnap) {
          this.snapToTarget();
          this.pendingSnap = false;
        } else {
          // A committed turn overrides quality scaling: the elevated q during
          // a maneuver is the detector misreading the turn as jitter, and
          // heavier smoothing is exactly wrong mid-maneuver.
          const q = this.turnActive ? 0 : this.quality;
          const tau = TAU_S + q * (TAU_BAD_S - TAU_S);
          const tauPos = TAU_POS_S + q * (TAU_POS_BAD_S - TAU_POS_S);
          const alpha = 1 - Math.exp(-dt / tau);
          const cogError = circularDistanceDeg(
            this.smoothedCog,
            this.targetCog,
          );
          if (cogError > MAX_COG_ERROR_SNAP_DEG) {
            // Fell too far behind to ease across — snap and flag it. Should be
            // rare; if the diag log shows this firing in the field, the render
            // loop is stalling and the cause is worth chasing.
            console.warn(
              `CourseSmoothing: COG error ${cogError.toFixed(0)}° > ${MAX_COG_ERROR_SNAP_DEG}° guard — snapping (smoothed ${this.smoothedCog.toFixed(0)}° → target ${this.targetCog.toFixed(0)}°)`,
            );
            this.smoothedCog = this.targetCog;
          } else {
            this.smoothedCog = circularInterpolate(
              this.smoothedCog,
              this.targetCog,
              alpha,
            );
          }
          this.smoothedSog += alpha * (this.targetSog - this.smoothedSog);

          // Position smoothing (shorter time constant)
          const posAlpha = 1 - Math.exp(-dt / tauPos);
          this.smoothedLat += posAlpha * (this.targetLat - this.smoothedLat);
          this.smoothedLon += posAlpha * (this.targetLon - this.smoothedLon);
        }
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
