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
