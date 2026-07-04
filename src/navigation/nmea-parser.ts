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

export function validateChecksum(sentence: string): boolean {
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

const HALF_DAY_MS = 12 * 3600_000;
const DAY_MS = 24 * 3600_000;

/**
 * Resolve NMEA HHMMSS(.sss) to epoch ms.
 *
 * With ddmmyy (RMC field 9) the date is authoritative. Without it (GGA),
 * stamping onto *today's* UTC date is wrong for up to a day around UTC
 * midnight (a fix generated at 23:59:59 but parsed at 00:00:01 landed ~24 h
 * in the future — nightly filter resets for BLE-pod/serial users). Resolve
 * to the nearest day instead: shift ±24 h to minimize |t − now|.
 */
function parseTime(
  hhmmss: string,
  ddmmyy?: string,
  nowMs = Date.now(),
): number {
  if (!hhmmss || hhmmss.length < 6) return nowMs;
  const h = parseInt(hhmmss.slice(0, 2), 10);
  const m = parseInt(hhmmss.slice(2, 4), 10);
  const s = parseFloat(hhmmss.slice(4));
  const secs = Math.floor(s);
  const ms = Math.round((s % 1) * 1000);

  if (ddmmyy && ddmmyy.length >= 6) {
    const day = parseInt(ddmmyy.slice(0, 2), 10);
    const month = parseInt(ddmmyy.slice(2, 4), 10);
    const yy = parseInt(ddmmyy.slice(4, 6), 10);
    if (!Number.isNaN(day) && !Number.isNaN(month) && !Number.isNaN(yy)) {
      // Two-digit year window: GPS epoch began 1980, so >=80 means 1900s.
      const year = yy >= 80 ? 1900 + yy : 2000 + yy;
      return Date.UTC(year, month - 1, day, h, m, secs, ms);
    }
  }

  const today = new Date(nowMs);
  today.setUTCHours(h, m, secs, ms);
  let t = today.getTime();
  if (t - nowMs > HALF_DAY_MS) t -= DAY_MS;
  else if (nowMs - t > HALF_DAY_MS) t += DAY_MS;
  return t;
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
    timestamp: parseTime(parts[1], parts[9] || undefined),
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
