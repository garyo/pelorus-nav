/**
 * Speed and distance unit conversion utilities.
 */

import type { DepthUnit, SpeedUnit } from "../settings";

export const MS_TO_KNOTS = 1.94384;
export const NM_TO_METERS = 1852;
export const NM_TO_FEET = 6076.12;

export function convertSpeed(knots: number, unit: SpeedUnit): number {
  switch (unit) {
    case "mph":
      return knots * 1.15078;
    case "kph":
      return knots * 1.852;
    default:
      return knots;
  }
}

export function speedUnitLabel(unit: SpeedUnit): string {
  switch (unit) {
    case "mph":
      return "mph";
    case "kph":
      return "km/h";
    default:
      return "Kt";
  }
}

/**
 * Format a route/track distance in the unit family implied by the speed
 * unit: km for "kph", statute miles for "mph", otherwise nautical miles.
 * Whole numbers from 5 up, one decimal below.
 */
export function formatDistanceInSpeedUnits(
  nm: number,
  unit: SpeedUnit,
): string {
  if (unit === "kph") {
    const km = nm * 1.852;
    return km >= 5 ? `${Math.round(km)} km` : `${km.toFixed(1)} km`;
  }
  if (unit === "mph") {
    const mi = nm * 1.15078;
    return mi >= 5 ? `${Math.round(mi)} mi` : `${mi.toFixed(1)} mi`;
  }
  return nm >= 5 ? `${Math.round(nm)} nm` : `${nm.toFixed(1)} nm`;
}

/**
 * Format a nav-instrument distance in NM (digits only, no unit):
 * hundredths below 10 NM, tenths above — the DTW cell's precision.
 */
export function formatNavDistanceNM(nm: number): string {
  return nm < 10 ? nm.toFixed(2) : nm.toFixed(1);
}

/**
 * Format a distance in nautical miles for on-chart labels: below 0.1 NM
 * (where "NM" would round to "0.00") switches to feet or meters per the
 * depth-unit setting.
 */
export function formatDistanceNM(nm: number, depthUnit: DepthUnit): string {
  if (nm < 0.1) {
    if (depthUnit === "feet" || depthUnit === "fathoms") {
      return `${Math.round(nm * NM_TO_FEET)} ft`;
    }
    return `${Math.round(nm * NM_TO_METERS)} m`;
  }
  return `${nm.toFixed(2)} NM`;
}
