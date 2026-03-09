/**
 * Speed unit conversion utilities.
 */

import type { SpeedUnit } from "../settings";

export const MS_TO_KNOTS = 1.94384;

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
