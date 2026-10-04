/**
 * Matching user depth settings to the depths stored in ENC data.
 *
 * NOAA compiles most US charts in feet but encodes their depths in metres,
 * truncated to 0.1 m: the 6 ft contour is stored as 1.8 (not 1.8288), 12 ft
 * as 3.6, 20 ft as 6.0, 30 ft as 9.1. Compared against an exact conversion,
 * the area beyond the 6 ft contour (DRVAL1 = 1.8) would read as shallower
 * than a 6 ft setting.
 */

import type { DepthUnit } from "../settings";

/** Exact metres per display unit (international foot and fathom). */
const METRES_PER_UNIT: Record<Exclude<DepthUnit, "meters">, number> = {
  feet: 0.3048,
  fathoms: 1.8288,
};

/** Steps the depth settings snap to in each non-metric unit. */
const SETTING_STEP: Record<Exclude<DepthUnit, "meters">, number> = {
  feet: 1,
  fathoms: 0.5,
};

/** Truncate metres to ENC precision (0.1 m), as NOAA encodes depths. */
function truncateToEncPrecision(metres: number): number {
  // The epsilon absorbs float error (6 × 0.3048 × 10 = 18.287999…).
  return Math.floor(metres * 10 + 1e-6) / 10;
}

/**
 * The ENC-encoded depth equivalent to a user's depth setting. A setting made
 * in feet or fathoms is snapped to the unit step it was chosen at (stored
 * values are rounded conversions, e.g. 6.1 m for 20 ft), converted exactly,
 * and truncated to 0.1 m — so 6 ft → 1.8, 20 ft → 6.0, 50 ft → 15.2. Metric
 * settings are returned unchanged.
 */
export function chartDepthThreshold(metres: number, unit: DepthUnit): number {
  if (unit === "meters") return metres;
  const perUnit = METRES_PER_UNIT[unit];
  const step = SETTING_STEP[unit];
  const chosen = Math.round(metres / perUnit / step) * step;
  return truncateToEncPrecision(chosen * perUnit);
}

/** Exact metres per display unit. */
export function metresPerUnit(unit: Exclude<DepthUnit, "meters">): number {
  return METRES_PER_UNIT[unit];
}
