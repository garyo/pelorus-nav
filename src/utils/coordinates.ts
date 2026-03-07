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
 * Parse a single coordinate component from DDM format like "42°18.295'N"
 * or plain decimal degrees like "-70.946". Returns NaN on failure.
 */
function parseDDMComponent(s: string): number {
  const trimmed = s.trim();

  // Try DDM: 42°18.295'N or 42°18.295N (quote optional)
  const ddm = trimmed.match(
    /^(\d+)\s*[°]\s*(\d+(?:\.\d+)?)\s*'?\s*([NSEWnsew])$/,
  );
  if (ddm) {
    const deg = parseInt(ddm[1], 10);
    const min = parseFloat(ddm[2]);
    const dir = ddm[3].toUpperCase();
    const sign = dir === "S" || dir === "W" ? -1 : 1;
    return sign * (deg + min / 60);
  }

  // Try decimal with hemisphere suffix: 42.305N, 70.946W
  const decSuffix = trimmed.match(/^(\d+(?:\.\d+)?)\s*([NSEWnsew])$/);
  if (decSuffix) {
    const val = parseFloat(decSuffix[1]);
    const dir = decSuffix[2].toUpperCase();
    const sign = dir === "S" || dir === "W" ? -1 : 1;
    return sign * val;
  }

  // Plain decimal (possibly negative)
  const val = parseFloat(trimmed);
  return Number.isNaN(val) ? NaN : val;
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
export function parseLatLon(input: string): [number, number] | null {
  const s = input.trim();
  if (!s) return null;

  // Split on comma, or on whitespace between two coordinate-like tokens
  let parts: string[];
  if (s.includes(",")) {
    parts = s.split(",").map((p) => p.trim());
  } else {
    // Split on whitespace, but rejoin tokens that are part of the same DDM
    // component (e.g. "42 ° 18.295 ' N" is unusual but handle "42°18.295'N 70°56.787'W")
    parts = s.split(/\s+/);
  }

  if (parts.length !== 2) return null;

  const a = parseDDMComponent(parts[0]);
  const b = parseDDMComponent(parts[1]);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;

  // Validate ranges: lat [-90,90], lon [-180,180]
  if (Math.abs(a) <= 90 && Math.abs(b) <= 180) {
    return [a, b];
  }

  return null;
}
