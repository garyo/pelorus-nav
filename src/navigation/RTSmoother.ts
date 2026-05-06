/**
 * Rauch-Tung-Striebel (RTS) smoother + robust outlier rejection for
 * recorded tracks. Run as a one-shot post-processing pass after a track
 * is closed: with full past+future context, the smoother corrects much
 * of the live filter's residual jitter, and a per-point shift threshold
 * picks out the rare bad fixes that can't be smoothed away.
 *
 * State model matches `GPSFilter` (constant-velocity, white-noise
 * acceleration), so the smoothed track is consistent with how the live
 * pipeline thinks about position evolution. Forward pass mirrors the
 * Kalman in `GPSFilter`; backward pass adds:
 *
 *   C_k     = P_{k|k}   · F_{k+1}ᵀ · P_{k+1|k}⁻¹
 *   x_{k|N} = x_{k|k}   + C_k · (x_{k+1|N} − x_{k+1|k})
 *   P_{k|N} = P_{k|k}   + C_k · (P_{k+1|N} − P_{k+1|k}) · C_kᵀ
 *
 * Outlier flag: shift > max(OUTLIER_FLOOR_M, median + k · 1.4826 · MAD).
 * The floor catches lone spikes in low-noise tracks; the MAD term
 * widens the threshold for inherently noisier tracks so we don't reject
 * statistical-tail samples. k = 8 is conservative (~5.4σ for normal
 * data) — validated against the checked-in fixture corpus.
 *
 * After flagging, drop the outliers and re-run forward+backward on the
 * survivors; the original outlier indices keep their raw position in
 * the output, marked via `outliers`.
 */

import type { TrackPoint } from "../data/Track";

const M_PER_DEG = 111_111;
const KN_PER_DEG_S = (M_PER_DEG * 3600) / 1852;

export interface RTSConfig {
  /** Process-noise acceleration (deg/s²). Same default as GPSFilter. */
  processNoiseAccel: number;
  /** Measurement-noise standard deviation (m) when accuracy is unknown. */
  defaultAccuracyM: number;
  /** Floor for measurement noise (m); prevents over-trust of optimistic fixes. */
  minAccuracyM: number;
  /** Absolute floor on the outlier-shift threshold (m). */
  outlierFloorM: number;
  /** Multiplier on 1.4826·MAD when computing the dynamic threshold. */
  outlierKMad: number;
  /** Tracks shorter than this are returned unchanged. */
  minPointsForSmoothing: number;
}

export const DEFAULT_RTS_CONFIG: Readonly<RTSConfig> = {
  processNoiseAccel: 5e-6,
  defaultAccuracyM: 10,
  minAccuracyM: 3,
  outlierFloorM: 20,
  outlierKMad: 8,
  minPointsForSmoothing: 5,
};

export interface RTSResult {
  /** Smoothed track, same length and same timestamps as input. Outliers
   *  retain their raw lat/lon (their indices are listed in `outliers`). */
  smoothed: TrackPoint[];
  /** Indices into the input array flagged as outliers. */
  outliers: number[];
  /** Per-point distance (m) from raw to smoothed in the *first* pass.
   *  Used by the outlier flag and exposed for telemetry/tests. */
  shifts: number[];
  /** Threshold (m) used by the outlier flag. */
  outlierThresholdM: number;
}

/**
 * Smooth a track and flag outliers. Returns a same-length array with
 * smoothed positions where possible and raw positions at outlier indices.
 * sog/cog on the smoothed points are re-derived from the smoothed
 * velocity state so they're consistent with the new positions.
 */
export function smoothTrack(
  points: TrackPoint[],
  config: Partial<RTSConfig> = {},
): RTSResult {
  const cfg: RTSConfig = { ...DEFAULT_RTS_CONFIG, ...config };

  if (points.length < cfg.minPointsForSmoothing) {
    return {
      smoothed: points.map((p) => ({ ...p })),
      outliers: [],
      shifts: points.map(() => 0),
      outlierThresholdM: cfg.outlierFloorM,
    };
  }

  // First-pass shifts and threshold are kept for telemetry (so callers
  // can see what the smoother thought of the raw track without iteration
  // muddying the picture).
  const firstPass = runForwardBackward(points, cfg);
  const firstShifts = firstPass.smoothed.map((s, i) =>
    metresBetween(points[i].lat, points[i].lon, s.lat, s.lon),
  );
  const firstFlag = flagOutliers(firstShifts, cfg);

  // Iterative outlier removal: each pass drops only the WORST single
  // fix, then re-smooths. A single bad fix smears its shift onto a
  // few neighbours; once it's out, the neighbours' shifts collapse and
  // they don't get spuriously flagged. Bounded by the floor of points
  // we're willing to drop — never go below minPointsForSmoothing.
  const working = points.map((p) => ({ ...p }));
  const workingOrigIdx = points.map((_, i) => i);
  const outlierOrigIndices: number[] = [];
  let lastPass = firstPass;
  // Hard cap to keep this bounded if something unexpected happens.
  const maxDrops = Math.floor(points.length / 5);
  for (let iter = 0; iter < maxDrops; iter++) {
    if (working.length < cfg.minPointsForSmoothing) break;
    const pass = runForwardBackward(working, cfg);
    const shifts = pass.smoothed.map((s, i) =>
      metresBetween(working[i].lat, working[i].lon, s.lat, s.lon),
    );
    const { mask } = flagOutliers(shifts, cfg);
    let worst = -1;
    let worstShift = -Infinity;
    for (let i = 0; i < shifts.length; i++) {
      if (mask[i] && shifts[i] > worstShift) {
        worstShift = shifts[i];
        worst = i;
      }
    }
    if (worst === -1) {
      lastPass = pass;
      break;
    }
    outlierOrigIndices.push(workingOrigIdx[worst]);
    working.splice(worst, 1);
    workingOrigIdx.splice(worst, 1);
    lastPass = pass; // note: this still includes the just-dropped point
  }
  outlierOrigIndices.sort((a, b) => a - b);

  // Final smooth without the outliers, then map back to original indices.
  let finalSmoothed: TrackPoint[];
  if (outlierOrigIndices.length === 0) {
    finalSmoothed = lastPass.smoothed;
  } else {
    const finalPass =
      working.length >= cfg.minPointsForSmoothing
        ? runForwardBackward(working, cfg)
        : { smoothed: working.map((p) => ({ ...p })) };
    finalSmoothed = points.map((p) => ({ ...p })); // outliers keep raw
    for (let j = 0; j < finalPass.smoothed.length; j++) {
      finalSmoothed[workingOrigIdx[j]] = finalPass.smoothed[j];
    }
  }

  return {
    smoothed: finalSmoothed,
    outliers: outlierOrigIndices,
    shifts: firstShifts,
    outlierThresholdM: firstFlag.threshold,
  };
}

// ── Forward + backward pass ─────────────────────────────────────────

interface PassResult {
  smoothed: TrackPoint[];
}

function runForwardBackward(points: TrackPoint[], cfg: RTSConfig): PassResult {
  const n = points.length;

  // Initial state: lat/lon from first fix, zero velocity, large covariance.
  const x: number[][] = new Array(n); // filtered x_{k|k}
  const P: Float64Array[] = new Array(n); // filtered P_{k|k}
  const xPred: number[][] = new Array(n); // predicted x_{k|k-1}
  const PPred: Float64Array[] = new Array(n); // predicted P_{k|k-1}
  const Fs: number[] = new Array(n); // dt for step k → k+1 (so Fs[k] uses dt from k-1 to k)

  x[0] = [points[0].lat, points[0].lon, 0, 0];
  P[0] = identityCov(100, 5);
  xPred[0] = [...x[0]];
  PPred[0] = P[0].slice();
  Fs[0] = 0;

  const q = cfg.processNoiseAccel ** 2;

  for (let k = 1; k < n; k++) {
    let dt = (points[k].timestamp - points[k - 1].timestamp) / 1000;
    if (dt <= 0) dt = 1; // safety; matches GPSFilter's negative-dt guard
    Fs[k] = dt;

    // Predict from x[k-1], P[k-1] using F(dt) and Q(dt).
    const xp = predict(x[k - 1], dt);
    const Pp = predictCov(P[k - 1], dt, q);
    xPred[k] = xp;
    PPred[k] = Pp;

    // Update with measurement at k.
    const accuracyM = Math.max(cfg.minAccuracyM, cfg.defaultAccuracyM);
    const upd = updateStep(xp, Pp, points[k].lat, points[k].lon, accuracyM);
    x[k] = upd.x;
    P[k] = upd.P;
  }

  // Backward RTS pass.
  const xs: number[][] = new Array(n);
  xs[n - 1] = [...x[n - 1]];
  let PsNext: Float64Array = P[n - 1].slice();
  for (let k = n - 2; k >= 0; k--) {
    const dt = Fs[k + 1];
    // C = P[k] · Fᵀ · PPred[k+1]⁻¹
    // F has the velocity-coupling structure used in predict(), so
    // P[k] · Fᵀ has a known sparse form: column j is P[k][·, j] for j>=2
    // shifted by dt times the velocity columns. Cleaner to compute it
    // via explicit 4×4 multiplies — n is small.
    const Pk = P[k];
    const F = buildF(dt);
    const PFt = mat4Mul(Pk, mat4Transpose(F));
    const PPredInv = mat4Inv(PPred[k + 1]);
    const C = mat4Mul(PFt, PPredInv);

    // x[k|N] = x[k] + C · (xs[k+1] − xPred[k+1])
    const dx = vec4Sub(xs[k + 1], xPred[k + 1]);
    const Cdx = mat4VecMul(C, dx);
    xs[k] = vec4Add(x[k], Cdx);

    // P[k|N] = P[k] + C · (Ps[k+1] − PPred[k+1]) · Cᵀ
    const Pdiff = mat4Sub(PsNext, PPred[k + 1]);
    const CPdiff = mat4Mul(C, Pdiff);
    const CPdiffCt = mat4Mul(CPdiff, mat4Transpose(C));
    PsNext = mat4Add(Pk, CPdiffCt);
  }

  // Build smoothed TrackPoints with re-derived sog/cog.
  const smoothed: TrackPoint[] = new Array(n);
  for (let k = 0; k < n; k++) {
    const [lat, lon, vLat, vLon] = xs[k];
    const cosLat = Math.cos((lat * Math.PI) / 180);
    const sogKn =
      Math.sqrt(vLat * vLat + vLon * cosLat * (vLon * cosLat)) * KN_PER_DEG_S;
    let cog: number | null = null;
    if (sogKn >= 0.1) {
      cog = (Math.atan2(vLon * cosLat, vLat) * 180) / Math.PI;
      if (cog < 0) cog += 360;
    }
    smoothed[k] = {
      ...points[k],
      lat,
      lon,
      sog: sogKn,
      cog,
    };
  }
  return { smoothed };
}

// ── Outlier flagger ─────────────────────────────────────────────────

function flagOutliers(
  shifts: number[],
  cfg: RTSConfig,
): { threshold: number; mask: boolean[] } {
  const sorted = [...shifts].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const absDev = shifts.map((s) => Math.abs(s - median));
  absDev.sort((a, b) => a - b);
  const mad = absDev[Math.floor(absDev.length / 2)];
  const sigmaEst = 1.4826 * mad;
  const threshold = Math.max(
    cfg.outlierFloorM,
    median + cfg.outlierKMad * sigmaEst,
  );
  const mask = shifts.map((s) => s > threshold);
  return { threshold, mask };
}

// ── Kalman building blocks ──────────────────────────────────────────

function predict(x: number[], dt: number): number[] {
  const [lat, lon, vLat, vLon] = x;
  return [lat + vLat * dt, lon + vLon * dt, vLat, vLon];
}

function predictCov(P: Float64Array, dt: number, q: number): Float64Array {
  // Same F * P * F' + Q implementation as GPSFilter.predict(), but
  // returning a fresh Float64Array.
  const FP = new Float64Array(16);
  for (let c = 0; c < 4; c++) {
    FP[0 * 4 + c] = P[0 * 4 + c] + dt * P[2 * 4 + c];
    FP[1 * 4 + c] = P[1 * 4 + c] + dt * P[3 * 4 + c];
    FP[2 * 4 + c] = P[2 * 4 + c];
    FP[3 * 4 + c] = P[3 * 4 + c];
  }
  const Pn = new Float64Array(16);
  for (let r = 0; r < 4; r++) {
    Pn[r * 4 + 0] = FP[r * 4 + 0] + dt * FP[r * 4 + 2];
    Pn[r * 4 + 1] = FP[r * 4 + 1] + dt * FP[r * 4 + 3];
    Pn[r * 4 + 2] = FP[r * 4 + 2];
    Pn[r * 4 + 3] = FP[r * 4 + 3];
  }
  const dt2 = dt * dt;
  const dt3 = dt2 * dt;
  Pn[0] += (q * dt3) / 3;
  Pn[5] += (q * dt3) / 3;
  Pn[2] += (q * dt2) / 2;
  Pn[8] += (q * dt2) / 2;
  Pn[7] += (q * dt2) / 2;
  Pn[13] += (q * dt2) / 2;
  Pn[10] += q * dt;
  Pn[15] += q * dt;
  return Pn;
}

function updateStep(
  xPred: number[],
  PPred: Float64Array,
  zLat: number,
  zLon: number,
  accuracyM: number,
): { x: number[]; P: Float64Array } {
  const cosLat = Math.cos((zLat * Math.PI) / 180);
  const rLat = (accuracyM / M_PER_DEG) ** 2;
  const rLon = cosLat > 1e-6 ? (accuracyM / (M_PER_DEG * cosLat)) ** 2 : rLat;

  const s00 = PPred[0] + rLat;
  const s01 = PPred[1];
  const s10 = PPred[4];
  const s11 = PPred[5] + rLon;
  const det = s00 * s11 - s01 * s10;
  if (Math.abs(det) < 1e-30) {
    return { x: [...xPred], P: new Float64Array(PPred) };
  }
  const invDet = 1 / det;
  const si00 = s11 * invDet;
  const si01 = -s01 * invDet;
  const si10 = -s10 * invDet;
  const si11 = s00 * invDet;

  // Kalman gain K = P · Hᵀ · S⁻¹  (4×2)
  const K = new Array(8) as number[];
  for (let r = 0; r < 4; r++) {
    const ph0 = PPred[r * 4 + 0];
    const ph1 = PPred[r * 4 + 1];
    K[r * 2 + 0] = ph0 * si00 + ph1 * si10;
    K[r * 2 + 1] = ph0 * si01 + ph1 * si11;
  }

  const y0 = zLat - xPred[0];
  const y1 = zLon - xPred[1];
  const x = new Array(4);
  for (let r = 0; r < 4; r++) {
    x[r] = xPred[r] + K[r * 2 + 0] * y0 + K[r * 2 + 1] * y1;
  }

  const P = new Float64Array(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        let ikh = r === k ? 1 : 0;
        if (k === 0) ikh -= K[r * 2 + 0];
        if (k === 1) ikh -= K[r * 2 + 1];
        sum += ikh * PPred[k * 4 + c];
      }
      P[r * 4 + c] = sum;
    }
  }

  return { x, P };
}

function identityCov(posVarM: number, velVarKn: number): Float64Array {
  const P = new Float64Array(16);
  P[0] = (posVarM / M_PER_DEG) ** 2;
  P[5] = (posVarM / M_PER_DEG) ** 2;
  P[10] = (velVarKn / KN_PER_DEG_S) ** 2;
  P[15] = (velVarKn / KN_PER_DEG_S) ** 2;
  return P;
}

// ── 4×4 matrix helpers ──────────────────────────────────────────────

function buildF(dt: number): Float64Array {
  const F = new Float64Array(16);
  F[0] = 1;
  F[5] = 1;
  F[10] = 1;
  F[15] = 1;
  F[2] = dt;
  F[7] = dt;
  return F;
}

function mat4Mul(A: Float64Array, B: Float64Array): Float64Array {
  const C = new Float64Array(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += A[r * 4 + k] * B[k * 4 + c];
      C[r * 4 + c] = s;
    }
  }
  return C;
}

function mat4Transpose(A: Float64Array): Float64Array {
  const T = new Float64Array(16);
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++) T[r * 4 + c] = A[c * 4 + r];
  return T;
}

function mat4Add(A: Float64Array, B: Float64Array): Float64Array {
  const C = new Float64Array(16);
  for (let i = 0; i < 16; i++) C[i] = A[i] + B[i];
  return C;
}

function mat4Sub(A: Float64Array, B: Float64Array): Float64Array {
  const C = new Float64Array(16);
  for (let i = 0; i < 16; i++) C[i] = A[i] - B[i];
  return C;
}

function mat4VecMul(A: Float64Array, v: number[]): number[] {
  const out = new Array(4);
  for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let c = 0; c < 4; c++) s += A[r * 4 + c] * v[c];
    out[r] = s;
  }
  return out;
}

function vec4Add(a: number[], b: number[]): number[] {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]];
}

function vec4Sub(a: number[], b: number[]): number[] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2], a[3] - b[3]];
}

/**
 * 4×4 matrix inverse via Gauss-Jordan with partial pivoting on a 4×8
 * augmented matrix. Throws if the matrix is singular (shouldn't happen
 * for well-conditioned predicted covariances, but guard anyway).
 */
function mat4Inv(A: Float64Array): Float64Array {
  // Build the augmented [A | I] in a 4×8 row-major array.
  const aug = new Float64Array(32);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      aug[r * 8 + c] = A[r * 4 + c];
      aug[r * 8 + (c + 4)] = r === c ? 1 : 0;
    }
  }

  for (let col = 0; col < 4; col++) {
    // Partial pivot: find row with largest |a[r][col]| at or below `col`.
    let pivotRow = col;
    let pivotMag = Math.abs(aug[col * 8 + col]);
    for (let r = col + 1; r < 4; r++) {
      const v = Math.abs(aug[r * 8 + col]);
      if (v > pivotMag) {
        pivotMag = v;
        pivotRow = r;
      }
    }
    if (pivotMag < 1e-30) {
      throw new Error("RTSmoother: predicted covariance is singular");
    }
    if (pivotRow !== col) {
      for (let c = 0; c < 8; c++) {
        const tmp = aug[col * 8 + c];
        aug[col * 8 + c] = aug[pivotRow * 8 + c];
        aug[pivotRow * 8 + c] = tmp;
      }
    }

    // Normalize pivot row.
    const pivot = aug[col * 8 + col];
    for (let c = 0; c < 8; c++) aug[col * 8 + c] /= pivot;

    // Eliminate column in other rows.
    for (let r = 0; r < 4; r++) {
      if (r === col) continue;
      const factor = aug[r * 8 + col];
      if (factor === 0) continue;
      for (let c = 0; c < 8; c++) {
        aug[r * 8 + c] -= factor * aug[col * 8 + c];
      }
    }
  }

  const inv = new Float64Array(16);
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++) inv[r * 4 + c] = aug[r * 8 + (c + 4)];
  return inv;
}

// ── Distance helper ─────────────────────────────────────────────────

function metresBetween(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const cosLat = Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  const dx = (lon2 - lon1) * M_PER_DEG * cosLat;
  const dy = (lat2 - lat1) * M_PER_DEG;
  return Math.sqrt(dx * dx + dy * dy);
}
