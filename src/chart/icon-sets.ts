import type { ExpressionSpecification } from "maplibre-gl";

/**
 * Icon set definitions for nautical chart symbology.
 *
 * Maps semantic SYMBOL values (from the S-57 pipeline) to sprite names
 * in the active icon set. To swap icon sets, change the active map +
 * sprite sheet — no tile regeneration needed.
 */

/** ECDIS simplified symbol set. */
export const ECDIS_SIMPLIFIED: Record<string, string> = {
  // Lateral buoys
  "lateral-port-conical": "ecdis-buoy-conical-green",
  "lateral-stbd-conical": "ecdis-buoy-conical-red",
  "lateral-port-can": "ecdis-buoy-can-green",
  "lateral-stbd-can": "ecdis-buoy-can-red",
  "lateral-port-pillar": "ecdis-buoy-pillar-green",
  "lateral-stbd-pillar": "ecdis-buoy-pillar-red",
  "lateral-port-spar": "ecdis-buoy-spar-green",
  "lateral-stbd-spar": "ecdis-buoy-spar-red",
  "lateral-port-spherical": "ecdis-buoy-spherical-rw",
  "lateral-stbd-spherical": "ecdis-buoy-spherical-rw",

  // Preferred channel (banded) buoys
  "preferred-port": "ecdis-buoy-can-rg",
  "preferred-stbd": "ecdis-buoy-can-gr",

  // Special buoys
  safewater: "ecdis-buoy-spherical-rw",
  special: "ecdis-buoy-pillar-yellow",
  "special-wo": "ecdis-buoy-pillar-wo",
  "isolated-danger": "ecdis-buoy-isolated-danger",

  // Cardinal buoys
  "cardinal-n": "ecdis-buoy-cardinal-n",
  "cardinal-s": "ecdis-buoy-cardinal-s",
  "cardinal-e": "ecdis-buoy-cardinal-e",
  "cardinal-w": "ecdis-buoy-cardinal-w",

  // Beacons
  "beacon-port": "ecdis-beacon-green",
  "beacon-stbd": "ecdis-beacon-red",
  "beacon-cardinal": "ecdis-beacon-cardinal",
  "beacon-default": "ecdis-beacon-default",

  // Lights
  "light-major": "ecdis-light-major",
  "light-minor": "ecdis-light-minor",

  // Hazards
  "wreck-dangerous": "ecdis-wreck-dangerous",
  "wreck-nondangerous": "ecdis-wreck-nondangerous",
  "wreck-mast": "ecdis-wreck-mast",
  obstruction: "ecdis-obstruction",
  "obstruction-foul": "ecdis-obstruction-foul",
  "rock-underwater": "ecdis-rock-underwater",
  "rock-awash": "ecdis-rock-awash",
  "rock-above": "ecdis-rock-above",

  // Other
  fogsig: "ecdis-fogsig",
  mooring: "ecdis-mooring",
  piling: "ecdis-piling",
  "bridge-symbol": "ecdis-bridge-symbol",
};

/**
 * Build a MapLibre `match` expression that maps a SYMBOL feature property
 * to a sprite name using the given icon set.
 *
 * Returns a raw array typed as `unknown` because MapLibre's
 * ExpressionSpecification tuple type doesn't support dynamic-length
 * match expressions via spread. The runtime accepts it fine.
 */
export function buildIconExpression(
  iconSet: Record<string, string>,
  fallback: string,
): ExpressionSpecification {
  // ["match", ["get", "SYMBOL"], sym1, sprite1, sym2, sprite2, ..., fallback]
  const expr: unknown[] = ["match", ["get", "SYMBOL"]];
  for (const [symbol, sprite] of Object.entries(iconSet)) {
    expr.push(symbol, sprite);
  }
  expr.push(fallback);
  return expr as ExpressionSpecification;
}
