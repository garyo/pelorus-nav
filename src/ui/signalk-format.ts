/**
 * Compact text for the Signal K diagnostics panel: value ages, raw Signal K
 * values (SI units, as the server sends them), and a freshness tone.
 */

import { formatLatLon } from "../utils/coordinates";

/** Data this old or newer is live; older is stale; much older is gone. */
const LIVE_MS = 5000;
const STALE_MS = 30000;

export type AgeTone = "green" | "amber" | "red";

export function ageTone(ageMs: number): AgeTone {
  if (ageMs < LIVE_MS) return "green";
  return ageMs < STALE_MS ? "amber" : "red";
}

/** "0.4 s", "12 s", "3 min", "2 h". */
export function formatAge(ageMs: number): string {
  const s = Math.max(0, ageMs) / 1000;
  if (s < 10) return `${s.toFixed(1)} s`;
  if (s < 60) return `${Math.round(s)} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  return `${Math.round(s / 3600)} h`;
}

const MAX_TEXT = 48;

function clip(text: string): string {
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text;
}

/** A Signal K value as short text: numbers to four significant digits. */
export function formatSignalkValue(value: unknown): string {
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(Number(value.toPrecision(4))) : "—";
  }
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return clip(value);
  if (typeof value === "object") {
    const { latitude, longitude } = value as Record<string, unknown>;
    if (typeof latitude === "number" && typeof longitude === "number") {
      return `${formatLatLon(latitude, "lat")} ${formatLatLon(longitude, "lon")}`;
    }
    return clip(JSON.stringify(value));
  }
  return String(value);
}
