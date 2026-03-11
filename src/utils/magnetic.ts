/**
 * Magnetic declination utilities using WMM 2025.
 * All internal data stays in TRUE; conversion happens at the display boundary.
 */

// magvar is CJS — default import gives us the module object
// @ts-expect-error magvar has no type declarations
import magvarModule from "magvar";

import type { BearingMode } from "../settings";

const magvar: (lat: number, lon: number, alt?: number) => number =
  magvarModule.magvar;

// --- Cached declination ---
let cachedLat = Number.NaN;
let cachedLon = Number.NaN;
let cachedDeclination = 0;
const CACHE_THRESHOLD = 0.1; // degrees

/** Get magnetic declination at a position (cached, degrees east-positive). */
export function getDeclination(lat: number, lon: number): number {
  if (
    Math.abs(lat - cachedLat) < CACHE_THRESHOLD &&
    Math.abs(lon - cachedLon) < CACHE_THRESHOLD
  ) {
    return cachedDeclination;
  }
  cachedLat = lat;
  cachedLon = lon;
  cachedDeclination = magvar(lat, lon);
  return cachedDeclination;
}

/** Normalize a bearing to [0, 360). */
function normalizeBearing(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/**
 * Convert a true bearing to display bearing based on mode.
 * Magnetic = True − Declination (east-positive convention).
 */
export function applyDeclination(
  trueBearing: number,
  mode: BearingMode,
  lat: number,
  lon: number,
): number {
  if (mode === "true") return normalizeBearing(trueBearing);
  const decl = getDeclination(lat, lon);
  return normalizeBearing(trueBearing - decl);
}

/** Return "T" or "M" suffix for the given bearing mode. */
export function bearingModeLabel(mode: BearingMode): string {
  return mode === "true" ? "T" : "M";
}

/**
 * Format a true bearing for display, e.g. "045°M" or "045°T".
 * Applies declination conversion if mode is magnetic.
 */
export function formatBearing(
  trueBearing: number,
  mode: BearingMode,
  lat: number,
  lon: number,
): string {
  const display = applyDeclination(trueBearing, mode, lat, lon);
  const suffix = bearingModeLabel(mode);
  return `${Math.round(display).toString().padStart(3, "0")}\u00b0${suffix}`;
}

/**
 * Format declination for display, e.g. "VAR 14.5°W" or "VAR 3.2°E".
 */
export function formatDeclination(lat: number, lon: number): string {
  const decl = getDeclination(lat, lon);
  const abs = Math.abs(decl).toFixed(1);
  const dir = decl < 0 ? "W" : "E";
  return `VAR ${abs}\u00b0${dir}`;
}
