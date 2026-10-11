/**
 * Matching user depth settings to the depths stored in ENC data.
 *
 * NOAA compiles most US charts in feet but encodes their depths in metres,
 * truncated to 0.1 m: the 6 ft contour is stored as 1.8 (not 1.8288), 12 ft
 * as 3.6, 20 ft as 6.0, 30 ft as 9.1 — and labelled 5, 11, 19 and 29 ft once
 * converted back (see `chartDepthValue` in settings.ts). Settings compare
 * against those stored values exactly, as NOAA Custom Chart does: a 5 ft
 * safety setting selects the contour labelled 5 ft, while 6 ft skips it for
 * the next deeper one.
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

/** Absorbs float error (6 × 0.3048 × 10 = 18.287999…). */
const EPSILON = 1e-6;

/** A stored setting (rounded metres) snapped back to the unit step it was chosen at. */
function chosenValue(metres: number, unit: Exclude<DepthUnit, "meters">) {
  const step = SETTING_STEP[unit];
  return Math.round(metres / METRES_PER_UNIT[unit] / step) * step;
}

/**
 * The ENC depth a user's depth setting compares against. A setting made in
 * feet or fathoms is snapped to the unit step it was chosen at (stored values
 * are inexact conversions, e.g. 1.83 m for 6 ft) and converted exactly, so
 * 5 ft → 1.524 m selects the 1.8 m contour and 6 ft → 1.8288 m does not.
 * Metric settings are returned unchanged.
 */
export function chartDepthThreshold(metres: number, unit: DepthUnit): number {
  if (unit === "meters") return metres;
  return chosenValue(metres, unit) * METRES_PER_UNIT[unit];
}

/**
 * Rewrite a settings-v2 depth so it keeps selecting the same contour. v2
 * truncated the converted setting to 0.1 m like the stored contours (6 ft →
 * 1.8 m, matching the 6 ft contour); v3 compares exactly, so the setting
 * becomes that contour's displayed value instead: 6 ft → 5 ft, 20 ft → 19 ft.
 */
export function migrateV2DepthSetting(metres: number, unit: DepthUnit): number {
  if (unit === "meters") return metres;
  const perUnit = METRES_PER_UNIT[unit];
  const step = SETTING_STEP[unit];
  const v2Threshold =
    Math.floor(chosenValue(metres, unit) * perUnit * 10 + EPSILON) / 10;
  return Math.floor(v2Threshold / perUnit / step + EPSILON) * step * perUnit;
}
