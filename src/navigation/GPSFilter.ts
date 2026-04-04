/**
 * Lightweight 2D Kalman filter for GPS position smoothing.
 *
 * State vector: [lat, lon, vLat, vLon] — position + velocity in degrees/second.
 * Constant-velocity model with white-noise acceleration process noise.
 * Measurement noise derived from GPS accuracy field.
 *
 * All matrix math is inlined (4x4 state, 2x2 innovation) — no library needed.
 */

import type { NavigationData } from "./NavigationData";

/** Metres per degree of latitude (approximate). */
const M_PER_DEG = 111_111;

/** Knots per degree-per-second of latitude. */
const KN_PER_DEG_S = (M_PER_DEG * 3600) / 1852;

/** Threshold (knots) below which we null out COG — velocity too noisy. */
const COG_MIN_SOG = 0.1;

export interface GPSFilterConfig {
  /** Process noise acceleration in deg/s^2. Higher = trusts GPS more. ~3e-7 for marine. */
  processNoiseAccel: number;
  /** Default measurement noise (meters) when GPS accuracy is unavailable. */
  defaultAccuracyM: number;
  /** Time gap (ms) after which the filter resets. */
  staleGapMs: number;
  /** Distance jump (meters) that triggers an immediate reset. */
  jumpThresholdM: number;
  /** Floor for measurement noise (meters) to prevent over-trust. */
  minAccuracyM: number;
}

export const DEFAULT_GPS_FILTER_CONFIG: Readonly<GPSFilterConfig> = {
  processNoiseAccel: 3e-7,
  defaultAccuracyM: 10,
  staleGapMs: 30_000,
  jumpThresholdM: 500,
  minAccuracyM: 3,
};

/**
 * 4-element state vector and 4x4 covariance stored as flat arrays.
 * P is stored row-major: P[row * 4 + col].
 */
interface FilterState {
  x: [number, number, number, number]; // lat, lon, vLat, vLon
  P: Float64Array; // 16 elements, 4x4 row-major
  lastTimestamp: number;
}

export class GPSFilter {
  private readonly cfg: GPSFilterConfig;
  private state: FilterState | null = null;

  constructor(config?: Partial<GPSFilterConfig>) {
    this.cfg = { ...DEFAULT_GPS_FILTER_CONFIG, ...config };
  }

  /** Clear filter state. Next call to filter() will re-initialize. */
  reset(): void {
    this.state = null;
  }

  /** Returns true when the filter has been initialized with at least one fix. */
  isInitialized(): boolean {
    return this.state !== null;
  }

  /**
   * Filter a GPS fix. Returns a new NavigationData with smoothed lat/lon
   * and derived COG/SOG. The first fix after reset is returned unchanged.
   */
  filter(raw: NavigationData): NavigationData {
    // First fix — initialize state
    if (!this.state) {
      this.initState(raw);
      return raw;
    }

    const dt = (raw.timestamp - this.state.lastTimestamp) / 1000; // seconds

    // Stale gap or negative dt — reset
    if (dt <= 0 || dt * 1000 > this.cfg.staleGapMs) {
      this.initState(raw);
      return raw;
    }

    // Jump detection (approximate metres)
    const dLat = raw.latitude - this.state.x[0];
    const dLon = raw.longitude - this.state.x[1];
    const cosLat = Math.cos((raw.latitude * Math.PI) / 180);
    const jumpM = Math.sqrt(
      (dLat * M_PER_DEG) ** 2 + (dLon * M_PER_DEG * cosLat) ** 2,
    );
    if (jumpM > this.cfg.jumpThresholdM) {
      this.initState(raw);
      return raw;
    }

    // — Predict step —
    this.predict(dt);

    // — Update step —
    const accuracyM = Math.max(
      this.cfg.minAccuracyM,
      raw.accuracy ?? this.cfg.defaultAccuracyM,
    );
    this.update(raw.latitude, raw.longitude, accuracyM);

    this.state.lastTimestamp = raw.timestamp;

    // Derive filtered outputs
    const [lat, lon, vLat, vLon] = this.state.x;
    const sogKn = Math.sqrt(vLat ** 2 + (vLon * cosLat) ** 2) * KN_PER_DEG_S;
    let cog: number | null = null;
    if (sogKn >= COG_MIN_SOG) {
      cog = (Math.atan2(vLon * cosLat, vLat) * 180) / Math.PI;
      if (cog < 0) cog += 360;
    }

    return {
      latitude: lat,
      longitude: lon,
      cog,
      sog: sogKn,
      heading: raw.heading, // pass through unchanged
      accuracy: raw.accuracy,
      timestamp: raw.timestamp,
      source: raw.source,
    };
  }

  // ── Internal ──────────────────────────────────────────────────────

  private initState(fix: NavigationData): void {
    const P = new Float64Array(16);
    // Large initial position uncertainty (~100m in degrees)
    const posVar = (100 / M_PER_DEG) ** 2;
    // Large initial velocity uncertainty (~5 kn in deg/s)
    const velVar = (5 / KN_PER_DEG_S) ** 2;
    P[0] = posVar; // P[0,0] lat variance
    P[5] = posVar; // P[1,1] lon variance
    P[10] = velVar; // P[2,2] vLat variance
    P[15] = velVar; // P[3,3] vLon variance

    this.state = {
      x: [fix.latitude, fix.longitude, 0, 0],
      P,
      lastTimestamp: fix.timestamp,
    };
  }

  /** Propagate state and covariance forward by dt seconds. */
  private predict(dt: number): void {
    const s = this.state as FilterState;
    const [lat, lon, vLat, vLon] = s.x;

    // x = F * x  (constant velocity)
    s.x[0] = lat + vLat * dt;
    s.x[1] = lon + vLon * dt;
    // velocities unchanged in predict

    // P = F * P * F' + Q
    // F has identity blocks plus dt on the velocity→position coupling.
    // Rather than full matrix multiply, apply the structure directly.
    const P = s.P;
    const q = this.cfg.processNoiseAccel ** 2;
    const dt2 = dt * dt;
    const dt3 = dt2 * dt;

    // Apply F * P * F' in-place.
    // For a CV model F = [[I, dt*I],[0, I]], the update is:
    //   P00 += dt*(P02+P20) + dt^2*P22
    //   P01 += dt*(P03+P21) + dt^2*P23
    //   P02 += dt*P22
    //   P03 += dt*P23
    //   P10 += dt*(P12+P30) + dt^2*P32
    //   P11 += dt*(P13+P31) + dt^2*P33
    //   P12 += dt*P32
    //   P13 += dt*P33
    //   P20 += dt*P22  (symmetric with P02)
    //   P21 += dt*P23  (symmetric with P03... wait, P21 != P12 in general after F*P*F')
    // Safer to just do the full F*P*F' for correctness.

    // Compute F*P first (store in temp), then (F*P)*F'
    // F*P: row i of result = row i of P + dt * row (i+2) of P, for i=0,1
    //       row i of result = row i of P, for i=2,3
    const FP = new Float64Array(16);
    for (let c = 0; c < 4; c++) {
      FP[0 * 4 + c] = P[0 * 4 + c] + dt * P[2 * 4 + c];
      FP[1 * 4 + c] = P[1 * 4 + c] + dt * P[3 * 4 + c];
      FP[2 * 4 + c] = P[2 * 4 + c];
      FP[3 * 4 + c] = P[3 * 4 + c];
    }
    // (F*P)*F': col j of result = col j of FP + dt * col (j+2) of FP, for j=0,1
    //           col j of result = col j of FP, for j=2,3
    for (let r = 0; r < 4; r++) {
      P[r * 4 + 0] = FP[r * 4 + 0] + dt * FP[r * 4 + 2];
      P[r * 4 + 1] = FP[r * 4 + 1] + dt * FP[r * 4 + 3];
      P[r * 4 + 2] = FP[r * 4 + 2];
      P[r * 4 + 3] = FP[r * 4 + 3];
    }

    // Add process noise Q (continuous white-noise acceleration model)
    // Q = q * [[dt^3/3, 0, dt^2/2, 0],
    //          [0, dt^3/3, 0, dt^2/2],
    //          [dt^2/2, 0, dt,     0],
    //          [0, dt^2/2, 0,     dt]]
    P[0] += (q * dt3) / 3;
    P[5] += (q * dt3) / 3;
    P[2] += (q * dt2) / 2;
    P[8] += (q * dt2) / 2;
    P[7] += (q * dt2) / 2;
    P[13] += (q * dt2) / 2;
    P[10] += q * dt;
    P[15] += q * dt;
  }

  /** Incorporate a GPS measurement [lat, lon] with given accuracy in metres. */
  private update(lat: number, lon: number, accuracyM: number): void {
    const s = this.state as FilterState;
    const P = s.P;

    // Measurement noise R (2x2 diagonal)
    const rLat = (accuracyM / M_PER_DEG) ** 2;
    const cosLat = Math.cos((lat * Math.PI) / 180);
    const rLon = cosLat > 1e-6 ? (accuracyM / (M_PER_DEG * cosLat)) ** 2 : rLat;

    // Innovation covariance S = H*P*H' + R  (2x2)
    // H = [[1,0,0,0],[0,1,0,0]], so H*P*H' is the top-left 2x2 of P
    const s00 = P[0] + rLat;
    const s01 = P[1];
    const s10 = P[4];
    const s11 = P[5] + rLon;

    // Invert 2x2: S^-1
    const det = s00 * s11 - s01 * s10;
    if (Math.abs(det) < 1e-30) return; // degenerate, skip update
    const invDet = 1 / det;
    const si00 = s11 * invDet;
    const si01 = -s01 * invDet;
    const si10 = -s10 * invDet;
    const si11 = s00 * invDet;

    // Kalman gain K = P * H' * S^-1  (4x2)
    // P * H' is columns 0,1 of P (4x2 matrix)
    const K = new Float64Array(8); // 4x2 row-major
    for (let r = 0; r < 4; r++) {
      const ph0 = P[r * 4 + 0];
      const ph1 = P[r * 4 + 1];
      K[r * 2 + 0] = ph0 * si00 + ph1 * si10;
      K[r * 2 + 1] = ph0 * si01 + ph1 * si11;
    }

    // Innovation y = z - H*x
    const y0 = lat - s.x[0];
    const y1 = lon - s.x[1];

    // State update: x = x + K * y
    for (let r = 0; r < 4; r++) {
      s.x[r] += K[r * 2 + 0] * y0 + K[r * 2 + 1] * y1;
    }

    // Covariance update: P = (I - K*H) * P
    // (I-KH)[r][k] = delta(r,k) - K[r,0]*delta(0,k) - K[r,1]*delta(1,k)
    const Pnew = new Float64Array(16);
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) {
          let ikh = r === k ? 1 : 0;
          if (k === 0) ikh -= K[r * 2 + 0];
          if (k === 1) ikh -= K[r * 2 + 1];
          sum += ikh * P[k * 4 + c];
        }
        Pnew[r * 4 + c] = sum;
      }
    }
    s.P.set(Pnew);
  }
}
