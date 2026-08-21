/**
 * Pure setup math and unit helpers for the anchor-mode UI.
 *
 * The default watch radius follows the documented formula (see
 * docs/anchor-watch-design.md): rode paid out + boat length + a GPS margin.
 * The margin is the worst of the live horizontal accuracy and the local
 * position scatter, floored at {@link GPS_MARGIN_MIN_M} so a briefly
 * optimistic receiver can't produce a radius the boat swings out of at rest.
 *
 * Lengths in the anchor UI (radius, rode, boat length, bow height, depth)
 * display in the depth-unit family: meters, or feet when the depth unit is
 * feet or fathoms — the same family formatDistanceNM uses for sub-0.1 NM
 * distances. Values are stored in meters everywhere.
 */

import type { DepthUnit } from "../settings";
import { NM_TO_FEET, NM_TO_METERS } from "../utils/units";

/** Smallest GPS margin added to the computed radius, meters. */
export const GPS_MARGIN_MIN_M = 10;

export const M_TO_FT = NM_TO_FEET / NM_TO_METERS;

export type AnchorLengthUnit = "m" | "ft";

/** Display unit for anchor lengths under the given depth-unit setting. */
export function anchorLengthUnit(depthUnit: DepthUnit): AnchorLengthUnit {
  return depthUnit === "meters" ? "m" : "ft";
}

/**
 * GPS margin for the radius formula: the worst of reported accuracy and
 * local scatter, never below the floor. Null/unknown signals contribute 0.
 */
export function gpsMarginM(
  accuracyM: number | null | undefined,
  scatterM: number | null | undefined,
): number {
  return Math.max(GPS_MARGIN_MIN_M, accuracyM ?? 0, scatterM ?? 0);
}

/** Default watch radius: rode + boat length + GPS margin, whole meters up. */
export function defaultRadiusM(
  rodeM: number | undefined,
  boatLengthM: number | undefined,
  marginM: number,
): number {
  return Math.ceil((rodeM ?? 0) + (boatLengthM ?? 0) + marginM);
}

/** Meters → display value in the given unit, rounded to whole units. */
export function toDisplayLength(
  meters: number,
  unit: AnchorLengthUnit,
): number {
  return Math.round(unit === "ft" ? meters * M_TO_FT : meters);
}

/** Display value in the given unit → meters. */
export function fromDisplayLength(
  value: number,
  unit: AnchorLengthUnit,
): number {
  return unit === "ft" ? value / M_TO_FT : value;
}

/** "25 m" / "82 ft". */
export function formatLength(meters: number, unit: AnchorLengthUnit): string {
  return `${toDisplayLength(meters, unit)} ${unit}`;
}

/** Radius quick-adjust step: a clean value in the display unit. */
export function radiusStepM(unit: AnchorLengthUnit): number {
  return unit === "ft" ? 15 / M_TO_FT : 5;
}
