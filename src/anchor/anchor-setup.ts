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

/**
 * How far the bow can lie from the anchor: the horizontal leg of the
 * right triangle formed by the rode and the vertical drop to the seabed
 * (depth + bow height), never more than the rode itself.
 *
 * Rode length overstates this, and the error grows sharply with depth —
 * 100 m of rode in 26 m of water reaches 96.6 m, but in 66 m of water only
 * 75 m. Since every excess metre of radius is drag that sounds no alarm,
 * the geometry is computed rather than approximated; catenary sag means
 * the true swing is always somewhat less than this maximum, so the result
 * still errs safely. Returns 0 when the rode cannot reach the bottom.
 */
export function horizontalReachM(
  rodeM: number | undefined,
  depthM: number | undefined,
  bowHeightM: number | undefined,
): number {
  const rode = rodeM ?? 0;
  if (rode <= 0) return 0;
  const vertical = (depthM ?? 0) + (bowHeightM ?? 0);
  if (vertical <= 0) return rode;
  if (vertical >= rode) return 0;
  return Math.sqrt(rode * rode - vertical * vertical);
}

/**
 * Default watch radius: horizontal reach + boat length + GPS margin, whole
 * meters up. The boat-length term covers the antenna lying up to a hull
 * length behind the bow as the boat swings; the margin covers position
 * uncertainty. With no depth entered the reach falls back to the rode.
 */
export function defaultRadiusM(
  rodeM: number | undefined,
  boatLengthM: number | undefined,
  marginM: number,
  depthM?: number | undefined,
  bowHeightM?: number | undefined,
): number {
  const reach =
    depthM !== undefined && depthM > 0
      ? horizontalReachM(rodeM, depthM, bowHeightM)
      : (rodeM ?? 0);
  return Math.ceil(reach + (boatLengthM ?? 0) + marginM);
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
