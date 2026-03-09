/**
 * Pure NMEA-0183 parser for GPS sentences.
 * Supports $GPRMC, $GPGGA, $GNRMC, $GNGGA.
 */

export interface NMEAPosition {
  latitude: number;
  longitude: number;
  cog: number | null;
  sog: number | null;
  altitude: number | null;
  accuracy: number | null;
  timestamp: number;
}

function validateChecksum(sentence: string): boolean {
  const starIdx = sentence.indexOf("*");
  if (starIdx < 0) return false;

  const body = sentence.slice(1, starIdx); // skip leading $
  let checksum = 0;
  for (let i = 0; i < body.length; i++) {
    checksum ^= body.charCodeAt(i);
  }

  const expected = sentence
    .slice(starIdx + 1)
    .trim()
    .toUpperCase();
  const actual = checksum.toString(16).toUpperCase().padStart(2, "0");
  return actual === expected;
}

function parseLatitude(value: string, dir: string): number | null {
  if (!value || !dir) return null;
  // Format: DDMM.MMMM
  const deg = parseInt(value.slice(0, 2), 10);
  const min = parseFloat(value.slice(2));
  if (Number.isNaN(deg) || Number.isNaN(min)) return null;
  const result = deg + min / 60;
  return dir === "S" ? -result : result;
}

function parseLongitude(value: string, dir: string): number | null {
  if (!value || !dir) return null;
  // Format: DDDMM.MMMM
  const deg = parseInt(value.slice(0, 3), 10);
  const min = parseFloat(value.slice(3));
  if (Number.isNaN(deg) || Number.isNaN(min)) return null;
  const result = deg + min / 60;
  return dir === "W" ? -result : result;
}

function parseTime(hhmmss: string): number {
  if (!hhmmss || hhmmss.length < 6) return Date.now();
  const h = parseInt(hhmmss.slice(0, 2), 10);
  const m = parseInt(hhmmss.slice(2, 4), 10);
  const s = parseFloat(hhmmss.slice(4));
  const now = new Date();
  now.setUTCHours(h, m, Math.floor(s), Math.round((s % 1) * 1000));
  return now.getTime();
}

/**
 * Parse $GPRMC / $GNRMC sentence.
 * Returns position data or null if invalid/inactive.
 */
export function parseRMC(sentence: string): NMEAPosition | null {
  if (!validateChecksum(sentence)) return null;

  const parts = sentence.split("*")[0].split(",");
  const type = parts[0];
  if (!type.endsWith("RMC")) return null;

  const status = parts[2];
  if (status !== "A") return null; // V = void/inactive

  const lat = parseLatitude(parts[3], parts[4]);
  const lon = parseLongitude(parts[5], parts[6]);
  if (lat === null || lon === null) return null;

  const sogKnots = parts[7] ? parseFloat(parts[7]) : null;
  const cog = parts[8] ? parseFloat(parts[8]) : null;

  return {
    latitude: lat,
    longitude: lon,
    cog: cog !== null && !Number.isNaN(cog) ? cog : null,
    sog: sogKnots !== null && !Number.isNaN(sogKnots) ? sogKnots : null,
    altitude: null,
    accuracy: null,
    timestamp: parseTime(parts[1]),
  };
}

/**
 * Parse $GPGGA / $GNGGA sentence.
 * Returns position data or null if no fix.
 */
export function parseGGA(sentence: string): NMEAPosition | null {
  if (!validateChecksum(sentence)) return null;

  const parts = sentence.split("*")[0].split(",");
  const type = parts[0];
  if (!type.endsWith("GGA")) return null;

  const fixQuality = parseInt(parts[6], 10);
  if (fixQuality === 0) return null; // no fix

  const lat = parseLatitude(parts[2], parts[3]);
  const lon = parseLongitude(parts[4], parts[5]);
  if (lat === null || lon === null) return null;

  const altitude = parts[9] ? parseFloat(parts[9]) : null;
  const hdop = parts[8] ? parseFloat(parts[8]) : null;
  // Rough accuracy estimate from HDOP (HDOP * 5m typical)
  const accuracy = hdop !== null && !Number.isNaN(hdop) ? hdop * 5 : null;

  return {
    latitude: lat,
    longitude: lon,
    cog: null,
    sog: null,
    altitude: altitude !== null && !Number.isNaN(altitude) ? altitude : null,
    accuracy,
    timestamp: parseTime(parts[1]),
  };
}

/**
 * Try to parse any supported NMEA sentence.
 */
export function parseNMEA(sentence: string): NMEAPosition | null {
  const trimmed = sentence.trim();
  const sentenceId = trimmed.split(",")[0];
  if (sentenceId.endsWith("RMC")) return parseRMC(trimmed);
  if (sentenceId.endsWith("GGA")) return parseGGA(trimmed);
  return null;
}
