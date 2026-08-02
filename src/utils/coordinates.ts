/** Convert degrees to radians */
export function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Convert radians to degrees */
export function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

/**
 * Haversine distance between two points in nautical miles.
 * Inputs are in decimal degrees.
 */
export function haversineDistanceNM(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R_NM = 3440.065; // Earth radius in nautical miles
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R_NM * c;
}

/**
 * Total great-circle length of a path (e.g. a route's waypoints) in
 * nautical miles. Zero for fewer than two points.
 */
export function pathDistanceNM(
  points: readonly { lat: number; lon: number }[],
): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineDistanceNM(
      points[i - 1].lat,
      points[i - 1].lon,
      points[i].lat,
      points[i].lon,
    );
  }
  return total;
}

/**
 * Interpolate along the great circle between two points, at fraction `t`.
 *
 * Spherical linear interpolation, so the result lies on the shortest arc.
 * Antipodal points have no unique arc; the caller's `t=0`/`t=1` cases are
 * exact, and anything between is arbitrary but stable.
 */
export function greatCirclePoint(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
  t: number,
): { lat: number; lon: number } {
  const phi1 = toRadians(lat1);
  const lam1 = toRadians(lon1);
  const phi2 = toRadians(lat2);
  const lam2 = toRadians(lon2);

  const dPhi = phi2 - phi1;
  const dLam = lam2 - lam1;
  const h =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLam / 2) ** 2;
  const delta = 2 * Math.asin(Math.min(1, Math.sqrt(h)));
  // Coincident points: every fraction is the same point, and the sines below
  // would divide by zero.
  if (delta === 0) return { lat: lat1, lon: lon1 };

  const a = Math.sin((1 - t) * delta) / Math.sin(delta);
  const b = Math.sin(t * delta) / Math.sin(delta);
  const x =
    a * Math.cos(phi1) * Math.cos(lam1) + b * Math.cos(phi2) * Math.cos(lam2);
  const y =
    a * Math.cos(phi1) * Math.sin(lam1) + b * Math.cos(phi2) * Math.sin(lam2);
  const z = a * Math.sin(phi1) + b * Math.sin(phi2);

  return {
    lat: toDegrees(Math.atan2(z, Math.sqrt(x * x + y * y))),
    lon: toDegrees(Math.atan2(y, x)),
  };
}

/** Below this, a leg is drawn as one straight segment (see densifyGreatCircle). */
const DEFAULT_MAX_OFFSET_NM = 0.5;

/**
 * The points to draw for one leg so it follows the great circle rather than
 * the straight line a Mercator projection would give.
 *
 * Every distance and bearing in the app is great-circle, but MapLibre draws a
 * LineString as straight segments in projected space — which in Mercator is a
 * rhumb line. On coastal legs the two are the same to well under a pixel; on
 * an ocean passage they visibly part company (a 1950 nm leg bows about 120 nm
 * off the straight line). Densifying only where it shows keeps short routes
 * byte-identical to before.
 *
 * Subdivision halves until each segment's midpoint is within `maxOffsetNM` of
 * the true arc. Returns `[from, to]` untouched when one segment already is.
 *
 * Longitudes are emitted *unwrapped* — continuing past ±180 rather than
 * jumping — because a leg that crosses the antimeridian would otherwise draw
 * as a line straight back across the world. MapLibre handles out-of-range
 * longitudes as long as they're continuous.
 */
export function densifyGreatCircle(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
  maxOffsetNM = DEFAULT_MAX_OFFSET_NM,
): Array<[number, number]> {
  const straightMid = {
    lat: (from.lat + to.lat) / 2,
    lon: (from.lon + unwrapLon(to.lon, from.lon)) / 2,
  };
  const arcMid = greatCirclePoint(from.lat, from.lon, to.lat, to.lon, 0.5);
  const offset = haversineDistanceNM(
    straightMid.lat,
    straightMid.lon,
    arcMid.lat,
    arcMid.lon,
  );
  if (offset <= maxOffsetNM) {
    return [
      [from.lon, from.lat],
      [unwrapLon(to.lon, from.lon), to.lat],
    ];
  }

  // One subdivision at a time, recursing into each half: the offset falls as
  // roughly the square of the segment length, so this bottoms out quickly.
  const mid = { lat: arcMid.lat, lon: arcMid.lon };
  const left = densifyGreatCircle(from, mid, maxOffsetNM);
  const right = densifyGreatCircle(mid, to, maxOffsetNM);
  // Drop the shared midpoint, and carry the left half's unwrapping into the
  // right so the whole leg stays continuous.
  const shift = left[left.length - 1][0] - mid.lon;
  return [
    ...left,
    ...right
      .slice(1)
      .map(([lon, lat]) => [lon + shift, lat] as [number, number]),
  ];
}

/**
 * The same for a whole path, staying continuous *between* legs as well as
 * within them.
 *
 * Doing this per leg isn't enough: each leg unwraps against its own start, so
 * a route crossing the antimeridian in several hops (170 → −170 → −150) would
 * hand back 190 followed by −170, and MapLibre would draw the join straight
 * back across the world. Each leg is shifted onto the running position
 * instead.
 */
export function densifyGreatCirclePath(
  points: readonly { lat: number; lon: number }[],
  maxOffsetNM = DEFAULT_MAX_OFFSET_NM,
): Array<[number, number]> {
  if (points.length === 0) return [];
  if (points.length === 1) return [[points[0].lon, points[0].lat]];

  const out: Array<[number, number]> = [];
  for (let i = 1; i < points.length; i++) {
    const leg = densifyGreatCircle(points[i - 1], points[i], maxOffsetNM);
    if (i === 1) {
      out.push(...leg);
      continue;
    }
    const shift = unwrapLon(leg[0][0], out[out.length - 1][0]) - leg[0][0];
    for (const [lon, lat] of leg.slice(1)) out.push([lon + shift, lat]);
  }
  return out;
}

/** `lon` expressed as the value nearest `reference`, continuing past ±180. */
function unwrapLon(lon: number, reference: number): number {
  let out = lon;
  while (out - reference > 180) out -= 360;
  while (out - reference < -180) out += 360;
  return out;
}

/**
 * Format decimal degrees as degrees, minutes, and decimal minutes.
 * Returns e.g. "42°21.60'N" or "071°03.60'W"
 */
export function formatLatLon(value: number, type: "lat" | "lon"): string {
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const min = (abs - deg) * 60;
  const hemisphere =
    type === "lat" ? (value >= 0 ? "N" : "S") : value >= 0 ? "E" : "W";
  const degPad = type === "lon" ? 3 : 2;
  return `${deg.toString().padStart(degPad, "0")}°${min.toFixed(2).padStart(5, "0")}'${hemisphere}`;
}

/**
 * Parse a single coordinate component from various formats.
 * Returns NaN on failure.
 *
 * Supported formats:
 * - DMS: 42°18'17.7"N, 42 18 17.7 N, 42deg18'17.7"N
 * - DDM: 42°18.295'N, 42°18.295N
 * - Decimal: 42.305N, -70.946, 42.305
 * - Negative sign as S/W: -42.305 = 42.305S
 * - "deg" as degree symbol: 42deg18.295N
 */
function parseDDMComponent(s: string): number {
  // Normalise: replace "deg" with °, convert curly quotes/primes to ASCII
  // equivalents so users can paste formatted text, strip trailing comma
  const trimmed = s
    .trim()
    .replace(/deg/gi, "°")
    .replace(/\u00BA/g, "°") // ordinal indicator → degree
    .replace(/[\u2018\u2019\u02B9\u2032\u00B4`]/g, "'") // curly/prime → '
    .replace(/[\u201C\u201D\u02BA\u2033]/g, '"') // curly/prime → "
    .replace(/,\s*$/, "");

  // Extract leading sign and trailing hemisphere
  let sign = 1;
  let str = trimmed;

  // Leading minus
  if (str.startsWith("-")) {
    sign = -1;
    str = str.slice(1).trim();
  }

  // Trailing hemisphere letter
  const hemiMatch = str.match(/\s*([NSEWnsew])\s*$/);
  if (hemiMatch) {
    const dir = hemiMatch[1].toUpperCase();
    if (dir === "S" || dir === "W") sign = -1;
    str = str.slice(0, -hemiMatch[0].length).trim();
  }

  // Try DMS: 42°18'17.7" or 42 18 17.7 or 42°18'17.7
  const dms = str.match(
    /^(\d+)\s*[°\s]\s*(\d+)\s*['\u2032\s]\s*(\d+(?:\.\d+)?)\s*["\u2033]?\s*$/,
  );
  if (dms) {
    const deg = parseInt(dms[1], 10);
    const min = parseInt(dms[2], 10);
    const sec = parseFloat(dms[3]);
    return sign * (deg + min / 60 + sec / 3600);
  }

  // Try DDM: 42°18.295 or 42°18.295'
  const ddm = str.match(/^(\d+)\s*[°\s]\s*(\d+(?:\.\d+)?)\s*['\u2032]?\s*$/);
  if (ddm) {
    const deg = parseInt(ddm[1], 10);
    const min = parseFloat(ddm[2]);
    return sign * (deg + min / 60);
  }

  // Plain decimal: 42.305 or 70.946
  const val = parseFloat(str);
  return Number.isNaN(val) ? NaN : sign * val;
}

/**
 * Parse a lat/lon string in various formats. Returns [lat, lon] or null.
 *
 * Accepted formats:
 * - "42.305,-70.946" (decimal degrees, comma-separated)
 * - "42°18.295'N 70°56.787'W" (DDM with hemisphere, space-separated)
 * - "42°18.295'N, 70°56.787'W" (DDM with comma)
 * - Mixed: "42.305N 70.946W"
 */
/**
 * Signed angular difference `target − current` normalised to [−180, +180).
 * Negative → turn left, positive → turn right. (±180 both mean "turn around".)
 */
export function bearingDelta(targetDeg: number, currentDeg: number): number {
  return ((((targetDeg - currentDeg) % 360) + 540) % 360) - 180;
}

/**
 * Initial (forward) bearing from point A to point B in degrees true (0-360).
 * Inputs are in decimal degrees.
 */
export function initialBearingDeg(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const phi1 = toRadians(lat1);
  const phi2 = toRadians(lat2);
  const dLambda = toRadians(lon2 - lon1);
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return ((toDegrees(Math.atan2(y, x)) % 360) + 360) % 360;
}

/**
 * Project a point forward along a bearing by a given distance (spherical).
 * Returns [longitude, latitude] in decimal degrees.
 */
export function projectPoint(
  lat: number,
  lon: number,
  bearingDeg: number,
  distanceNM: number,
): [number, number] {
  const R_NM = 3440.065; // Earth radius in nautical miles
  const phi1 = toRadians(lat);
  const lambda1 = toRadians(lon);
  const brng = toRadians(bearingDeg);
  const delta = distanceNM / R_NM; // angular distance

  const sinPhi1 = Math.sin(phi1);
  const cosPhi1 = Math.cos(phi1);
  const sinDelta = Math.sin(delta);
  const cosDelta = Math.cos(delta);

  const phi2 = Math.asin(
    sinPhi1 * cosDelta + cosPhi1 * sinDelta * Math.cos(brng),
  );
  const lambda2 =
    lambda1 +
    Math.atan2(
      Math.sin(brng) * sinDelta * cosPhi1,
      cosDelta - sinPhi1 * Math.sin(phi2),
    );

  return [toDegrees(lambda2), toDegrees(phi2)];
}

/**
 * Along-track distance in NM: how far a point has progressed along
 * the great-circle path from start to end.
 * Positive = toward end, can exceed leg distance (past perpendicular at end).
 */
export function alongTrackDistanceNM(
  startLat: number,
  startLon: number,
  endLat: number,
  endLon: number,
  pointLat: number,
  pointLon: number,
): number {
  const R_NM = 3440.065;
  const distStartPoint =
    haversineDistanceNM(startLat, startLon, pointLat, pointLon) / R_NM; // angular
  const bearingStartEnd = toRadians(
    initialBearingDeg(startLat, startLon, endLat, endLon),
  );
  const bearingStartPoint = toRadians(
    initialBearingDeg(startLat, startLon, pointLat, pointLon),
  );

  // Cross-track distance (angular)
  const xtd = Math.asin(
    Math.sin(distStartPoint) * Math.sin(bearingStartPoint - bearingStartEnd),
  );

  // Along-track distance (angular)
  const atd = Math.acos(Math.cos(distStartPoint) / Math.cos(xtd));

  // Sign: positive if heading generally toward end, negative if behind start
  // Use dot-product of bearing difference to determine sign
  const bearingDiff = bearingStartPoint - bearingStartEnd;
  const sign =
    Math.abs(bearingDiff) > Math.PI / 2 &&
    Math.abs(bearingDiff) < (3 * Math.PI) / 2
      ? -1
      : 1;

  return sign * atd * R_NM;
}

/**
 * Bounding box of a set of [lon, lat] coordinates, as
 * [minLon, minLat, maxLon, maxLat]. Returns null for an empty array.
 */
export function bboxOfCoords(
  coords: readonly [number, number][],
): [number, number, number, number] | null {
  if (coords.length === 0) return null;
  let [minLon, minLat] = coords[0];
  let maxLon = minLon;
  let maxLat = minLat;
  for (let i = 1; i < coords.length; i++) {
    const [lon, lat] = coords[i];
    if (lon < minLon) minLon = lon;
    else if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    else if (lat > maxLat) maxLat = lat;
  }
  return [minLon, minLat, maxLon, maxLat];
}

export function parseLatLon(input: string): [number, number] | null {
  const s = input.trim();
  if (!s) return null;

  // Split on comma first — unambiguous separator
  if (s.includes(",")) {
    const parts = s.split(",").map((p) => p.trim());
    if (parts.length === 2) {
      return tryParsePair(parts[0], parts[1]);
    }
    return null;
  }

  // No comma — try splitting on hemisphere boundary:
  // A hemisphere letter (N/S/E/W) followed by whitespace and then
  // more coordinate text is a natural split point.
  const hemiSplit = s.match(/^(.+?[NSEWnsew])\s+(.+)$/);
  if (hemiSplit) {
    const result = tryParsePair(hemiSplit[1], hemiSplit[2]);
    if (result) return result;
  }

  // Simple two-token split (plain decimals like "-42.305 -70.946")
  const tokens = s.split(/\s+/);
  if (tokens.length === 2) {
    return tryParsePair(tokens[0], tokens[1]);
  }

  return null;
}

const HEMI_RE = /[NSEWnsew]\s*$/;
const LAT_HEMI_RE = /[NSns]\s*$/;
const LON_HEMI_RE = /[EWew]\s*$/;

function tryParsePair(first: string, second: string): [number, number] | null {
  const a = parseDDMComponent(first);
  const b = parseDDMComponent(second);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;

  const firstHasHemi = HEMI_RE.test(first.trim());
  const secondHasHemi = HEMI_RE.test(second.trim());

  // If one component has a hemisphere letter but the other doesn't,
  // reject — likely an incomplete input (e.g. "42 22N")
  if (firstHasHemi !== secondHasHemi) return null;

  // If both have hemisphere letters, allow lat/lon in either order:
  // swap if first is E/W and second is N/S
  if (firstHasHemi && secondHasHemi) {
    const firstIsLon = LON_HEMI_RE.test(first.trim());
    const secondIsLat = LAT_HEMI_RE.test(second.trim());
    if (firstIsLon && secondIsLat) {
      // Swapped order: lon first, lat second
      if (Math.abs(b) <= 90 && Math.abs(a) <= 180) return [b, a];
      return null;
    }
  }

  // Validate ranges: lat [-90,90], lon [-180,180]
  if (Math.abs(a) <= 90 && Math.abs(b) <= 180) {
    return [a, b];
  }
  return null;
}
