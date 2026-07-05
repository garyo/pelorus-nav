/**
 * Bilinear interpolation of wind (speed, direction) between up to 4 corner
 * samples. Blending happens in u/v (vector) space rather than on the raw
 * (speed, dir) pair — averaging directions directly is wrong across the 0/360°
 * seam (350° and 10° would naively average to 180°, the opposite of correct),
 * while u/v components blend linearly with no wraparound.
 */

export interface WindVector {
  speed: number;
  dir: number;
}

/** Corners ordered (i,j), (i+1,j), (i,j+1), (i+1,j+1) — i.e. bottom-left,
 * bottom-right, top-left, top-right of the cell. `null` marks a corner with
 * no cached sample. */
export type WindCorners = readonly [
  WindVector | null,
  WindVector | null,
  WindVector | null,
  WindVector | null,
];

/** Meteorological "from" direction -> u/v components (u east+, v north+). */
function toUV(v: WindVector): [number, number] {
  const rad = (v.dir * Math.PI) / 180;
  return [-v.speed * Math.sin(rad), -v.speed * Math.cos(rad)];
}

function fromUV(u: number, v: number): WindVector {
  const speed = Math.hypot(u, v);
  const dir = ((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360;
  return { speed, dir };
}

/**
 * Bilinearly interpolate wind at fractional position (fx, fy) — both in
 * [0, 1] — within a cell given its 4 corners. Missing corners are dropped and
 * the remaining weights renormalized over whatever is available; returns null
 * if every corner is missing. A point exactly on a corner (fx=0/1, fy=0/1)
 * resolves to that corner's value directly (weight 1, if present).
 */
export function bilinearWind(
  corners: WindCorners,
  fx: number,
  fy: number,
): WindVector | null {
  const weights = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
  let u = 0;
  let v = 0;
  let sumW = 0;
  for (let k = 0; k < 4; k++) {
    const c = corners[k];
    if (!c) continue;
    const [cu, cv] = toUV(c);
    u += cu * weights[k];
    v += cv * weights[k];
    sumW += weights[k];
  }
  if (sumW === 0) return null;
  return fromUV(u / sumW, v / sumW);
}
