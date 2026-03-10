import type { ExpressionSpecification } from "maplibre-gl";
import type { DisplayTheme, SymbologyScheme } from "../../settings";

/**
 * Icon set definitions for nautical chart symbology.
 *
 * Maps semantic SYMBOL values (from the S-57 pipeline) to sprite names
 * in the active icon set. To swap icon sets, change the active map +
 * sprite sheet — no tile regeneration needed.
 */

/** Pelorus Standard symbol set (hand-drawn ECDIS-style icons). */
export const PELORUS_STANDARD: Record<string, string> = {
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

  // Lights (color-specific; Pelorus Standard uses same icon for all colors)
  "light-major-red": "ecdis-light-major",
  "light-major-green": "ecdis-light-major",
  "light-major-white": "ecdis-light-major",
  "light-minor-red": "ecdis-light-minor",
  "light-minor-green": "ecdis-light-minor",
  "light-minor-white": "ecdis-light-minor",

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

  // Special beacons
  "beacon-special": "ecdis-beacon-special",

  // Daymarks
  "daymark-square-red": "ecdis-daymark-square-red",
  "daymark-square-green": "ecdis-daymark-square-green",
  "daymark-triangle-red": "ecdis-daymark-triangle-red",
  "daymark-triangle-green": "ecdis-daymark-triangle-green",

  // Topmarks
  "topmark-cone-up": "ecdis-topmark-cone-up",
  "topmark-cone-down": "ecdis-topmark-cone-down",
  "topmark-sphere": "ecdis-topmark-sphere",
  "topmark-x": "ecdis-topmark-x",
  "topmark-2cones-up": "ecdis-topmark-2cones-up",
  "topmark-2cones-down": "ecdis-topmark-2cones-down",

  // Infrastructure
  harbor: "ecdis-harbor",
  platform: "ecdis-platform",
  tank: "ecdis-tank",

  // Landmarks
  "landmark-tower": "ecdis-landmark-tower",
  "landmark-chimney": "ecdis-landmark-chimney",
  "landmark-windmotor": "ecdis-landmark-windmotor",
  "landmark-windmill": "ecdis-landmark-windmill",
  "landmark-monument": "ecdis-landmark-monument",
  "landmark-flagstaff": "ecdis-landmark-flagstaff",
  "landmark-default": "ecdis-landmark-default",
};

/**
 * IHO S-52 symbol set — official symbols from the IHO S-101 Portrayal Catalogue.
 * Maps semantic SYMBOL names to S-52 sprite names (from s52-{theme} sprite sheets).
 */
export const IHO_S52: Record<string, string> = {
  // Lateral buoys (IALA-B: port=green, starboard=red)
  "lateral-port-conical": "BOYLAT13",
  "lateral-stbd-conical": "BOYLAT14",
  "lateral-port-can": "BOYLAT13",
  "lateral-stbd-can": "BOYLAT14",
  "lateral-port-pillar": "BOYLAT23",
  "lateral-stbd-pillar": "BOYLAT24",
  "lateral-port-spar": "BOYLAT23",
  "lateral-stbd-spar": "BOYLAT24",
  "lateral-port-spherical": "BOYSAW12",
  "lateral-stbd-spherical": "BOYSAW12",

  // Preferred channel (banded) buoys
  "preferred-port": "BOYSPP15",
  "preferred-stbd": "BOYSPP25",

  // Special buoys
  safewater: "BOYSAW12",
  special: "BOYSPP11",
  "special-wo": "BOYSPP35",
  "isolated-danger": "BOYISD12",

  // Cardinal buoys
  "cardinal-n": "BOYCAR01",
  "cardinal-s": "BOYCAR02",
  "cardinal-e": "BOYCAR03",
  "cardinal-w": "BOYCAR04",

  // Beacons
  "beacon-port": "BCNLAT15",
  "beacon-stbd": "BCNLAT16",
  "beacon-cardinal": "BCNCAR01",
  "beacon-default": "BCNGEN01",

  // Lights (LIGHTS11=red, LIGHTS12=green, LIGHTS13=white/yellow)
  "light-major-red": "LIGHTS11",
  "light-major-green": "LIGHTS12",
  "light-major-white": "LIGHTS13",
  "light-minor-red": "LIGHTS11",
  "light-minor-green": "LIGHTS12",
  "light-minor-white": "LIGHTS13",

  // Hazards
  "wreck-dangerous": "WRECKS01",
  "wreck-nondangerous": "WRECKS05",
  "wreck-mast": "WRECKS04",
  obstruction: "OBSTRN01",
  "obstruction-foul": "OBSTRN11",
  "rock-underwater": "UWTROC03",
  "rock-awash": "UWTROC04",
  "rock-above": "UWTROC04",

  // Other
  fogsig: "FOGSIG01",
  mooring: "MORFAC03",
  piling: "PILPNT02",
  "bridge-symbol": "BRIDGE01",

  // Special beacons
  "beacon-special": "BCNSPP13",

  // Daymarks (using pricke/beacon symbols)
  "daymark-square-red": "PRICKE03",
  "daymark-square-green": "PRICKE04",
  "daymark-triangle-red": "PRICKE03",
  "daymark-triangle-green": "PRICKE04",

  // Topmarks
  "topmark-cone-up": "TOPMAR02",
  "topmark-cone-down": "TOPMAR04",
  "topmark-sphere": "TOPMAR10",
  "topmark-x": "TOPMAR12",
  "topmark-2cones-up": "TOPMAR24",
  "topmark-2cones-down": "TOPMAR25",

  // Infrastructure
  harbor: "HRBFAC09",
  platform: "OFSPLF01",
  tank: "SILBUI11",

  // Landmarks
  "landmark-tower": "TOWERS01",
  "landmark-chimney": "CHIMNY01",
  "landmark-windmotor": "WNDMIL02",
  "landmark-windmill": "WNDMIL12",
  "landmark-monument": "MONUMT02",
  "landmark-flagstaff": "FLGSTF01",
  "landmark-default": "TOWERS02",
};

/**
 * Simplified minimal symbol set — reduced set for e-ink / low-detail displays.
 * Uses the same sprite names as Pelorus Standard for now;
 * future sprite sheets will provide minimal, high-contrast symbols.
 */
export const SIMPLIFIED_MINIMAL: Record<string, string> = {
  ...PELORUS_STANDARD,
};

/**
 * Per-symbol icon-offset data for S-52 symbols (from symbols.json).
 * Values represent the shift needed to align the symbol's pivot point
 * with the geographic location. Format: [dx, dy] in pixels.
 */
const S52_OFFSETS: Record<string, [number, number]> = {
  BOYLAT13: [-3, -3],
  BOYLAT14: [-3, -3],
  BOYLAT23: [-2, 0],
  BOYLAT24: [-2, 0],
  BOYCAR01: [-2.5, 0],
  BOYCAR02: [-2.5, -1],
  BOYCAR03: [-2.5, 0],
  BOYCAR04: [-2.5, -1],
  BOYSAW12: [-3, -3],
  BOYISD12: [-2, 0],
  BOYSPP11: [-2, 0],
  BOYSPP15: [-2, 0],
  BOYSPP25: [-2, 0],
  BOYSPP35: [-2, 0],
  BCNLAT15: [0.5, 0],
  BCNLAT16: [0.5, 0],
  BCNCAR01: [0, 0],
  BCNGEN01: [0, 0],
  BCNSPP13: [0.5, 0],
  // Light flares are rotated 135° in the build script (pointing down-right
  // per S-52/Chart No. 1 convention). Offset shifts flare away from the
  // co-located buoy/beacon so it's visible.
  LIGHTS11: [12, 12],
  LIGHTS12: [12, 12],
  LIGHTS13: [12, 12],
  WRECKS01: [-1, -4.5],
  WRECKS04: [-1, -4],
  WRECKS05: [0, -0.5],
  UWTROC03: [0, 0],
  UWTROC04: [0, 0],
  OBSTRN01: [0.5, 0.5],
  OBSTRN11: [0, 0],
  FOGSIG01: [-9.5, 8],
  MORFAC03: [-1, 0],
  PILPNT02: [0.5, 0.5],
  BRIDGE01: [0, 0],
  HRBFAC09: [0, 0],
  OFSPLF01: [0, 0],
  SILBUI11: [0, 0],
  PRICKE03: [0, 0],
  PRICKE04: [0, 0],
  TOPMAR02: [4, -12.5],
  TOPMAR04: [4, -12.5],
  TOPMAR10: [3.5, -13.5],
  TOPMAR12: [3.5, -13],
  TOPMAR24: [4, -12.5],
  TOPMAR25: [4, -12.5],
  TOWERS01: [0, -9.5],
  TOWERS02: [0, -9.5],
  CHIMNY01: [2.5, -10.5],
  CHIMNY11: [2.5, -10.5],
  WNDMIL02: [0, -12],
  WNDMIL12: [0, -12],
  MONUMT02: [0, -10],
  MONUMT12: [0, -10],
  FLGSTF01: [0, -12.5],
  FLGSTF02: [0, -12.5],
  BCNSPP21: [0, 0],
};

/** Sprite sheet configuration per scheme. */
interface SchemeConfig {
  icons: Record<string, string>;
  /** Single sprite prefix or per-theme prefixes for S-52 colour variants. */
  sprite: string | Record<DisplayTheme, string>;
  fallback: string;
  /** Icon size scale factor (default 1.0). S-52 symbols are smaller than Pelorus Standard. */
  iconSizeScale: number;
  /** Whether this scheme has per-symbol offsets. */
  hasOffsets: boolean;
}

/** Map scheme ID to the icon set mapping and sprite sheet prefix. */
const SCHEME_MAP: Record<SymbologyScheme, SchemeConfig> = {
  "pelorus-standard": {
    icons: PELORUS_STANDARD,
    sprite: "nautical",
    fallback: "ecdis-buoy-default",
    iconSizeScale: 1.0,
    hasOffsets: false,
  },
  "iho-s52": {
    icons: IHO_S52,
    sprite: {
      day: "s52-day",
      dusk: "s52-dusk",
      night: "s52-night",
      eink: "s52-day",
    },
    fallback: "BCNGEN01",
    iconSizeScale: 1.0,
    hasOffsets: true,
  },
  "simplified-minimal": {
    icons: SIMPLIFIED_MINIMAL,
    sprite: "nautical",
    fallback: "ecdis-buoy-default",
    iconSizeScale: 1.0,
    hasOffsets: false,
  },
};

/** Get the full scheme config for a symbology scheme. */
export function getSchemeConfig(scheme: SymbologyScheme): SchemeConfig {
  return SCHEME_MAP[scheme];
}

/** Get the icon set, resolved sprite prefix, and fallback for a symbology scheme. */
export function getIconScheme(
  scheme: SymbologyScheme,
  theme: DisplayTheme = "day",
): {
  icons: Record<string, string>;
  sprite: string;
  fallback: string;
} {
  const config = SCHEME_MAP[scheme];
  const sprite =
    typeof config.sprite === "string" ? config.sprite : config.sprite[theme];
  return { icons: config.icons, sprite, fallback: config.fallback };
}

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

/**
 * Build a MapLibre `match` expression for icon-offset, mapping SYMBOL values
 * to per-symbol [dx, dy] offsets. Returns null if the scheme has no offsets.
 */
export function buildOffsetExpression(
  iconSet: Record<string, string>,
): ExpressionSpecification | null {
  // Check if any mapped sprites have offsets
  const spriteNames = new Set(Object.values(iconSet));
  const hasAny = [...spriteNames].some(
    (name) => S52_OFFSETS[name] !== undefined,
  );
  if (!hasAny) return null;

  // ["match", ["get", "SYMBOL"], sym1, [dx, dy], sym2, [dx, dy], ..., [0, 0]]
  const expr: unknown[] = ["match", ["get", "SYMBOL"]];
  for (const [symbol, spriteName] of Object.entries(iconSet)) {
    const offset = S52_OFFSETS[spriteName];
    if (offset && (offset[0] !== 0 || offset[1] !== 0)) {
      expr.push(symbol, ["literal", offset]);
    }
  }
  expr.push(["literal", [0, 0]]);
  return expr as ExpressionSpecification;
}
