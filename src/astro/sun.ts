/**
 * Dependency-free solar event times — sunrise, sunset, and civil twilight —
 * for a date and location, computed with the standard low-precision sunrise
 * equation (same math as the well-validated SunCalc). Accurate to ~1 minute
 * at temperate latitudes, which is ample for trip planning, and fully offline.
 *
 * All results are UTC instants (`Date`); format them in the desired timezone
 * for display. An event is `null` when it doesn't occur that day (polar
 * day/night). Pass an instant near local noon of the day of interest so the
 * returned sunrise/sunset land on that local calendar day.
 */

const rad = Math.PI / 180;
const dayMs = 86_400_000;
const J1970 = 2_440_588;
const J2000 = 2_451_545;
/** Obliquity of the ecliptic. */
const e = rad * 23.4397;
/** Perihelion of the Earth. */
const PERIHELION = rad * 102.9372;
const J0 = 0.0009;

/** Geometric sun altitude at apparent sunrise/sunset (−50′: refraction + radius). */
export const ALT_SUNRISE = -0.833;
/** Civil twilight: sun 6° below the horizon (usable light boundary). */
export const ALT_CIVIL = -6;

export interface SunTimes {
  sunrise: Date | null;
  sunset: Date | null;
  /** Civil dawn — start of civil twilight (sun reaches −6° ascending). */
  civilDawn: Date | null;
  /** Civil dusk — end of civil twilight (sun reaches −6° descending). */
  civilDusk: Date | null;
  /** Solar noon (always defined). */
  transit: Date;
}

const toJulian = (date: Date): number => date.getTime() / dayMs - 0.5 + J1970;
const fromJulian = (j: number): Date => new Date((j + 0.5 - J1970) * dayMs);
const toDays = (date: Date): number => toJulian(date) - J2000;

const solarMeanAnomaly = (d: number): number =>
  rad * (357.5291 + 0.98560028 * d);

const eclipticLongitude = (M: number): number => {
  const C =
    rad *
    (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  return M + C + PERIHELION + Math.PI;
};

const declination = (L: number): number => Math.asin(Math.sin(L) * Math.sin(e));

const julianCycle = (d: number, lw: number): number =>
  Math.round(d - J0 - lw / (2 * Math.PI));

const approxTransit = (Ht: number, lw: number, n: number): number =>
  J0 + (Ht + lw) / (2 * Math.PI) + n;

const solarTransitJ = (ds: number, M: number, L: number): number =>
  J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);

/**
 * Solar event times for the day containing `date` (use ~local noon) at the
 * given latitude/longitude in degrees (longitude east-positive).
 */
export function sunTimes(date: Date, latDeg: number, lonDeg: number): SunTimes {
  const lw = rad * -lonDeg;
  const phi = rad * latDeg;

  const d = toDays(date);
  const n = julianCycle(d, lw);
  const ds = approxTransit(0, lw, n);
  const M = solarMeanAnomaly(ds);
  const L = eclipticLongitude(M);
  const dec = declination(L);
  const Jnoon = solarTransitJ(ds, M, L);

  // Rise/set pair for a target altitude, mirrored about solar noon.
  const pair = (altDeg: number): [Date | null, Date | null] => {
    const h = altDeg * rad;
    const cosW =
      (Math.sin(h) - Math.sin(phi) * Math.sin(dec)) /
      (Math.cos(phi) * Math.cos(dec));
    if (cosW < -1 || cosW > 1) return [null, null]; // polar day / night
    const w = Math.acos(cosW);
    const Jset = solarTransitJ(approxTransit(w, lw, n), M, L);
    const Jrise = Jnoon - (Jset - Jnoon);
    return [fromJulian(Jrise), fromJulian(Jset)];
  };

  const [sunrise, sunset] = pair(ALT_SUNRISE);
  const [civilDawn, civilDusk] = pair(ALT_CIVIL);
  return { transit: fromJulian(Jnoon), sunrise, sunset, civilDawn, civilDusk };
}
