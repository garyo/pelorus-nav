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
