/**
 * Speed and distance unit conversion utilities.
 *
 * Distances follow the speed unit's family — nautical miles with knots,
 * statute miles with mph, kilometres with km/h — so a distance and the
 * speed it is covered at always read in matching units. Distances too short
 * for that unit drop to a length in the depth-unit family (feet when depths
 * are in feet or fathoms, otherwise metres), like anchor lengths and charted
 * heights.
 */

import type { DepthUnit, SpeedUnit } from "../settings";

export const MS_TO_KNOTS = 1.94384;
export const NM_TO_METERS = 1852;
export const NM_TO_FEET = 6076.12;

/** Units per nautical mile, and so units/h per knot, for each speed unit. */
const PER_NM: Record<SpeedUnit, number> = {
  knots: 1,
  mph: 1.15078,
  kph: 1.852,
};

export function convertSpeed(knots: number, unit: SpeedUnit): number {
  return knots * PER_NM[unit];
}

/** A speed entered in the given unit, in knots. */
export function speedToKnots(value: number, unit: SpeedUnit): number {
  return value / PER_NM[unit];
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

/** "1.8 Kt", "2.1 mph". */
export function formatSpeed(knots: number, unit: SpeedUnit): string {
  return `${convertSpeed(knots, unit).toFixed(1)} ${speedUnitLabel(unit)}`;
}

/** A distance in nautical miles, in the speed unit's distance family. */
export function convertDistance(nm: number, unit: SpeedUnit): number {
  return nm * PER_NM[unit];
}

/** A distance entered in the speed unit's distance family, in nautical miles. */
export function distanceToNM(value: number, unit: SpeedUnit): number {
  return value / PER_NM[unit];
}

/** Label of the speed unit's distance family. */
export function distanceUnitLabel(unit: SpeedUnit): string {
  switch (unit) {
    case "mph":
      return "mi";
    case "kph":
      return "km";
    default:
      return "NM";
  }
}

/**
 * Format a route/track distance in the speed unit's distance family.
 * Whole numbers from 5 up, one decimal below.
 */
export function formatDistanceInSpeedUnits(
  nm: number,
  unit: SpeedUnit,
): string {
  const d = convertDistance(nm, unit);
  return `${d >= 5 ? Math.round(d) : d.toFixed(1)} ${distanceUnitLabel(unit)}`;
}

/**
 * Format a nav-instrument distance in the speed unit's distance family
 * (digits only, no unit): hundredths below 10, tenths to 100, whole units
 * beyond — the DTW cell's precision, and never more than five characters.
 */
export function formatNavDistance(nm: number, unit: SpeedUnit): string {
  const d = convertDistance(nm, unit);
  if (d < 10) return d.toFixed(2);
  return d < 100 ? d.toFixed(1) : d.toFixed(0);
}

/** {@link formatNavDistance} with its unit: "0.30 NM", "12.4 mi", "127 km". */
export function formatDistanceShort(nm: number, unit: SpeedUnit): string {
  return `${formatNavDistance(Math.max(0, nm), unit)} ${distanceUnitLabel(unit)}`;
}

/** A short distance as a whole-unit length: "500 ft" or "152 m". */
export function formatDistanceAsLength(
  nm: number,
  depthUnit: DepthUnit,
): string {
  return depthUnit === "meters"
    ? `${Math.round(nm * NM_TO_METERS)} m`
    : `${Math.round(nm * NM_TO_FEET)} ft`;
}

/**
 * Format a distance for on-chart labels and readouts (measure, plotting,
 * COB, anchor) with two decimals in the speed unit's distance family; below
 * 0.1 of that unit, where it would read "0.05", as a length in feet or
 * metres per the depth unit.
 */
export function formatDistance(
  nm: number,
  speedUnit: SpeedUnit,
  depthUnit: DepthUnit,
): string {
  const d = convertDistance(nm, speedUnit);
  if (d < 0.1) return formatDistanceAsLength(nm, depthUnit);
  return `${d.toFixed(2)} ${distanceUnitLabel(speedUnit)}`;
}
