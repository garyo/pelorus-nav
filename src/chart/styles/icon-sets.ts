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
  superbuoy: "ecdis-buoy-pillar-yellow",
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
  "topmark-2cones-up": "ecdis-topmark-2cones-up",
  "topmark-2cones-down": "ecdis-topmark-2cones-down",
  "topmark-2cones-base-to-base": "ecdis-topmark-2cones-up",
  "topmark-2cones-point-to-point": "ecdis-topmark-2cones-down",
  "topmark-sphere": "ecdis-topmark-sphere",
  "topmark-2spheres": "ecdis-topmark-sphere",
  "topmark-cylinder": "ecdis-topmark-sphere",
  "topmark-board": "ecdis-topmark-sphere",
  "topmark-x": "ecdis-topmark-x",
  "topmark-flag": "ecdis-topmark-sphere",
  "topmark-t-shape": "ecdis-topmark-sphere",

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

  // Preferred channel (banded) buoys — use lateral symbols for dominant color
  // Red-green-red (preferred-port): dominant red = starboard lateral symbol
  // Green-red-green (preferred-stbd): dominant green = port lateral symbol
  "preferred-port": "BOYLAT14",
  "preferred-stbd": "BOYLAT13",

  // Special buoys
  safewater: "BOYSAW12",
  special: "BOYSPP11",
  "special-wo": "BOYSPP35",
  superbuoy: "BOYSUP02",
  "isolated-danger": "BOYISD12",

  // Cardinal buoys
  "cardinal-n": "BOYCAR01",
  "cardinal-s": "BOYCAR02",
  "cardinal-e": "BOYCAR03",
  "cardinal-w": "BOYCAR04",

  // Beacons
  "beacon-port": "BCNLAT16",
  "beacon-stbd": "BCNLAT15",
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

  // Topmarks (buoy variants: TOPMAR02–17)
  "topmark-cone-up": "TOPMAR02",
  "topmark-cone-down": "TOPMAR04",
  "topmark-2cones-up": "TOPMAR05",
  "topmark-2cones-down": "TOPMAR06",
  "topmark-2cones-base-to-base": "TOPMAR07",
  "topmark-2cones-point-to-point": "TOPMAR08",
  "topmark-sphere": "TOPMAR10",
  "topmark-2spheres": "TOPMAR12",
  "topmark-cylinder": "TOPMAR13",
  "topmark-board": "TOPMAR14",
  "topmark-x": "TOPMAR65",
  "topmark-flag": "TOPMAR17",
  "topmark-t-shape": "TOPMAR18",

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
  BOYSUP02: [-2, 0],
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
  TOPMAR02: [2.5, -8],
  TOPMAR04: [2.5, -8],
  TOPMAR05: [2.5, -12],
  TOPMAR06: [2.5, -12],
  TOPMAR07: [2.5, -12],
  TOPMAR08: [2.5, -12],
  TOPMAR10: [2, -9],
  TOPMAR12: [2, -12],
  TOPMAR13: [2.5, -8],
  TOPMAR14: [2.5, -8],
  TOPMAR17: [2.5, -8],
  TOPMAR18: [2.5, -8],
  TOPMAR24: [2.5, -8],
  TOPMAR25: [2.5, -8],
  TOPMAR65: [2.5, -8],
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
  /** Icon size scale factor (default 1.0). Single value or per-theme overrides. */
  iconSizeScale: number | Partial<Record<DisplayTheme, number>>;
  /** Whether this scheme has per-symbol offsets. */
  hasOffsets: boolean;
}

/** Map scheme ID to the icon set mapping and sprite sheet prefix. */
const SCHEME_MAP: Record<SymbologyScheme, SchemeConfig> = {
  "pelorus-standard": {
    icons: PELORUS_STANDARD,
    sprite: "nautical",
    fallback: "ecdis-buoy-default",
    iconSizeScale: { eink: 2.0 },
    hasOffsets: false,
  },
  "iho-s52": {
    icons: IHO_S52,
    sprite: {
      day: "s52-day",
      dusk: "s52-dusk",
      night: "s52-night",
      eink: "s52-eink",
    },
    fallback: "BCNGEN01",
    iconSizeScale: { eink: 2.0 },
    hasOffsets: true,
  },
  "simplified-minimal": {
    icons: SIMPLIFIED_MINIMAL,
    sprite: "nautical",
    fallback: "ecdis-buoy-default",
    iconSizeScale: { eink: 2.0 },
    hasOffsets: false,
  },
};

/** Get the full scheme config for a symbology scheme. */
export function getSchemeConfig(scheme: SymbologyScheme): SchemeConfig {
  return SCHEME_MAP[scheme];
}

/** Resolve the icon size scale factor for a scheme + theme. */
export function getIconSizeScale(
  scheme: SymbologyScheme,
  theme: DisplayTheme = "day",
): number {
  const raw = SCHEME_MAP[scheme].iconSizeScale;
  if (typeof raw === "number") return raw;
  return raw[theme] ?? 1.0;
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

// ── S-57 attribute constants ───────────────────────────────────────────────
// COLOUR codes
const RED = 3;
const GREEN = 4;
const WHITE = 1;
// const YELLOW = 6;
const ORANGE = 11;
// BOYSHP codes
const CONICAL = 1;
const CAN = 2;
const SPHERICAL = 3;
const PILLAR = 4;
const SPAR = 5;
const BARREL = 6;
const SUPER = 7;
const ICE = 8;
// CATLAM
const PORT = 1;
const STBD = 2;
const CATLAM_PREF_STBD = 3; // preferred channel to starboard (red/green/red in IALA-B)
const CATLAM_PREF_PORT = 4; // preferred channel to port (green/red/green in IALA-B)
// CATCAM
// const CATCAM_N = 1;
// const CATCAM_S = 2;
// const CATCAM_E = 3;
// const CATCAM_W = 4;
// WATLEV
const WATLEV_DRY = 2;
const WATLEV_SUBMERGED = 3;
const WATLEV_AWASH = 5;
// CATWRK
const CATWRK_NONDANGEROUS = 1;
const CATWRK_DANGEROUS = 2;
const CATWRK_MAST = 4;
// CATOBS
const CATOBS_FOUL_AREA = 6;
const CATOBS_FOUL_GROUND = 7;
// TOPSHP codes
const TOPSHP_CONE_UP = 1;
const TOPSHP_CONE_DOWN = 2;
const TOPSHP_SPHERE = 3;
const TOPSHP_2SPHERES = 4;
const TOPSHP_CYLINDER = 5;
const TOPSHP_BOARD = 6;
const TOPSHP_X = 7;
const TOPSHP_2CONES_PTP = 10;
const TOPSHP_2CONES_BTB = 11;
const TOPSHP_2CONES_UP = 13;
const TOPSHP_2CONES_DOWN = 14;
const TOPSHP_FLAG = 17;
const TOPSHP_T_SHAPE = 28;
// CATLMK
const CATLMK_CHIMNEY = 3;
const CATLMK_FLAGSTAFF = 5;
const CATLMK_MAST = 7;
const CATLMK_MONUMENT = 9;
const CATLMK_TOWER = 17;
const CATLMK_WINDMILL = 18;
const CATLMK_WINDMOTOR = 19;

/**
 * Build per-layer MapLibre icon and offset expressions from raw S-57 attributes.
 *
 * This replaces the role of the Python compute_symbol() function in symbols.py,
 * but operates at the MapLibre expression level so symbol logic can change
 * without rebuilding tiles.
 */
export function buildLayerExpressions(
  layerName: string,
  iconSet: Record<string, string>,
  fallback: string,
): { iconExpr: ExpressionSpecification; offsetExpr: ExpressionSpecification | null } {
  // Helper: look up sprite for a semantic symbol name
  const sp = (key: string): string => iconSet[key] ?? fallback;
  // Helper: get offset for a sprite name
  const off = (sprite: string): [number, number] => S52_OFFSETS[sprite] ?? [0, 0];

  // Helper: constant symbol (no attribute lookup needed)
  const constant = (sym: string) => {
    const sprite = sp(sym);
    const o = off(sprite);
    return {
      iconExpr: sprite as unknown as ExpressionSpecification,
      offsetExpr:
        o[0] !== 0 || o[1] !== 0
          ? (["literal", o] as unknown as ExpressionSpecification)
          : null,
    };
  };

  // Helper: match on a single attribute; cases is [[value, symbolName], ...]
  const matchOnAttr = (
    attrExpr: unknown,
    cases: Array<[number, string]>,
    defaultSym: string,
  ) => {
    const iconArr: unknown[] = ["match", attrExpr];
    const offArr: unknown[] = ["match", attrExpr];
    let hasOffsets = false;
    for (const [val, sym] of cases) {
      const sprite = sp(sym);
      const o = off(sprite);
      iconArr.push(val, sprite);
      offArr.push(val, ["literal", o]);
      if (o[0] !== 0 || o[1] !== 0) hasOffsets = true;
    }
    const defSprite = sp(defaultSym);
    const defOff = off(defSprite);
    iconArr.push(defSprite);
    offArr.push(["literal", defOff]);
    if (defOff[0] !== 0 || defOff[1] !== 0) hasOffsets = true;
    return {
      iconExpr: iconArr as unknown as ExpressionSpecification,
      offsetExpr: hasOffsets
        ? (offArr as unknown as ExpressionSpecification)
        : null,
    };
  };

  // Shared colour helpers.
  // MVT doesn't support array properties, so COLOUR is a comma-separated
  // string (or int for single-colour features from GDAL). We use comma-padding
  // for reliable "contains" checks: ",3," in ",3,4,3," matches but ",1," in
  // ",11," does not (no false positives). For ordered first/second checks,
  // we extract c0 and c1 at runtime using string slice/index operations.
  const colourStr = ["to-string", ["coalesce", ["get", "COLOUR"], ""]];
  // Append trailing comma so single-value "3" → "3," and index-of always finds a comma.
  const cps = ["concat", colourStr, ","];
  const colourPadded = ["concat", ",", colourStr, ","];
  const colContains = (code: number): unknown[] => ["in", `,${code},`, colourPadded];
  // First colour code: characters before the first comma
  const firstComma = ["index-of", ",", cps];
  const c0 = ["to-number", ["slice", cps, 0, firstComma], 0];
  // Second colour code: characters between first and second comma
  const afterFirst = ["concat", ["slice", cps, ["+", firstComma, 1]], ","];
  const secondComma = ["index-of", ",", afterFirst];
  const c1 = ["to-number", ["slice", afterFirst, 0, secondComma], 0];
  const isPrefPort = ["all", ["==", c0, RED], ["==", c1, GREEN]];
  const isPrefStbd = ["all", ["==", c0, GREEN], ["==", c1, RED]];
  // S-52 BOYSPP01: CATSPM=9 (ODAS) and CATSPM=15 (LANBY) trigger the superbuoy trapezoid,
  // same as BOYSHP=7. (Source: OpenCPN chartsymbols.xml lookup IDs 1053/1063)
  // GDAL/ogr2ogr encodes StringList attributes as JSON arrays (e.g. ["9"]), so we
  // check for the quoted value as a substring: "9" in ["9"] or ["9","15"].
  const catsStr = ["to-string", ["coalesce", ["get", "CATSPM"], ""]];
  const isSuperbuoyByCat = ["any", ["in", '"9"', catsStr], ["in", '"15"', catsStr]];

  switch (layerName) {
    // ── Simple constants ─────────────────────────────────────────────────
    case "BOYSAW":
      return constant("safewater");
    case "BOYISD":
      return constant("isolated-danger");
    case "FOGSIG":
      return constant("fogsig");
    case "MORFAC":
      return constant("mooring");
    case "PILPNT":
      return constant("piling");
    case "BCNSPP":
      return constant("beacon-special");
    case "HRBFAC":
      return constant("harbor");
    case "OFSPLF":
      return constant("platform");
    case "SILTNK":
      return constant("tank");
    case "BCNCAR":
      return constant("beacon-cardinal");
    case "PILBOP":
      return constant("beacon-default");

    // ── Simple attribute matches ─────────────────────────────────────────
    case "BOYCAR":
      return matchOnAttr(["get", "CATCAM"], [[1, "cardinal-n"], [2, "cardinal-s"], [3, "cardinal-e"], [4, "cardinal-w"]], "cardinal-n");
    case "BCNLAT":
      return matchOnAttr(["get", "CATLAM"], [[PORT, "beacon-port"], [STBD, "beacon-stbd"]], "beacon-default");
    case "UWTROC":
      return matchOnAttr(["get", "WATLEV"], [[WATLEV_DRY, "rock-above"], [WATLEV_AWASH, "rock-awash"]], "rock-underwater");
    case "OBSTRN":
      return matchOnAttr(["get", "CATOBS"], [[CATOBS_FOUL_AREA, "obstruction-foul"], [CATOBS_FOUL_GROUND, "obstruction-foul"]], "obstruction");
    case "TOPMAR":
      return matchOnAttr(
        ["get", "TOPSHP"],
        [
          [TOPSHP_CONE_UP, "topmark-cone-up"],
          [TOPSHP_CONE_DOWN, "topmark-cone-down"],
          [TOPSHP_SPHERE, "topmark-sphere"],
          [TOPSHP_2SPHERES, "topmark-2spheres"],
          [TOPSHP_CYLINDER, "topmark-cylinder"],
          [TOPSHP_BOARD, "topmark-board"],
          [TOPSHP_X, "topmark-x"],
          [TOPSHP_2CONES_PTP, "topmark-2cones-point-to-point"],
          [TOPSHP_2CONES_BTB, "topmark-2cones-base-to-base"],
          [TOPSHP_2CONES_UP, "topmark-2cones-up"],
          [TOPSHP_2CONES_DOWN, "topmark-2cones-down"],
          [TOPSHP_FLAG, "topmark-flag"],
          [TOPSHP_T_SHAPE, "topmark-t-shape"],
        ],
        "topmark-sphere",
      );
    case "LNDMRK":
      return matchOnAttr(
        ["to-number", ["coalesce", ["get", "CATLMK"], 0], 0],
        [
          [CATLMK_CHIMNEY, "landmark-chimney"],
          [CATLMK_FLAGSTAFF, "landmark-flagstaff"],
          [CATLMK_MAST, "landmark-tower"],
          [CATLMK_MONUMENT, "landmark-monument"],
          [CATLMK_TOWER, "landmark-tower"],
          [CATLMK_WINDMILL, "landmark-windmill"],
          [CATLMK_WINDMOTOR, "landmark-windmotor"],
        ],
        "landmark-default",
      );

    // ── WRECKS ────────────────────────────────────────────────────────────
    case "WRECKS": {
      const iconExpr = [
        "case",
        ["==", ["get", "CATWRK"], CATWRK_MAST], sp("wreck-mast"),
        ["==", ["get", "CATWRK"], CATWRK_NONDANGEROUS], sp("wreck-nondangerous"),
        ["==", ["get", "WATLEV"], WATLEV_SUBMERGED], sp("wreck-dangerous"),
        ["==", ["get", "CATWRK"], CATWRK_DANGEROUS], sp("wreck-dangerous"),
        sp("wreck-nondangerous"),
      ] as unknown as ExpressionSpecification;
      // Compute offsets for wreck sprites
      const mastOff = off(sp("wreck-mast"));
      const nonDangOff = off(sp("wreck-nondangerous"));
      const dangOff = off(sp("wreck-dangerous"));
      const hasWreckOff =
        mastOff[0] !== 0 || mastOff[1] !== 0 ||
        nonDangOff[0] !== 0 || nonDangOff[1] !== 0 ||
        dangOff[0] !== 0 || dangOff[1] !== 0;
      const offsetExpr = hasWreckOff
        ? ([
            "case",
            ["==", ["get", "CATWRK"], CATWRK_MAST], ["literal", mastOff],
            ["==", ["get", "CATWRK"], CATWRK_NONDANGEROUS], ["literal", nonDangOff],
            ["==", ["get", "WATLEV"], WATLEV_SUBMERGED], ["literal", dangOff],
            ["==", ["get", "CATWRK"], CATWRK_DANGEROUS], ["literal", dangOff],
            ["literal", nonDangOff],
          ] as unknown as ExpressionSpecification)
        : null;
      return { iconExpr, offsetExpr };
    }

    // ── LIGHTS ────────────────────────────────────────────────────────────
    case "LIGHTS": {
      const majorGreen = sp("light-major-green");
      const minorGreen = sp("light-minor-green");
      const majorRed = sp("light-major-red");
      const minorRed = sp("light-minor-red");
      const majorWhite = sp("light-major-white");
      const minorWhite = sp("light-minor-white");
      const isMajor = [">=", ["coalesce", ["get", "VALNMR"], 0], 10];
      const iconExpr = [
        "case",
        colContains(GREEN), ["case", isMajor, majorGreen, minorGreen],
        colContains(RED), ["case", isMajor, majorRed, minorRed],
        ["case", isMajor, majorWhite, minorWhite],
      ] as unknown as ExpressionSpecification;
      // Offsets — all light sprites typically share the same offset
      const oMajorG = off(majorGreen);
      const oMinorG = off(minorGreen);
      const oMajorR = off(majorRed);
      const oMinorR = off(minorRed);
      const oMajorW = off(majorWhite);
      const oMinorW = off(minorWhite);
      const hasLightOff = [oMajorG, oMinorG, oMajorR, oMinorR, oMajorW, oMinorW].some(
        (o) => o[0] !== 0 || o[1] !== 0,
      );
      const offsetExpr = hasLightOff
        ? ([
            "case",
            colContains(GREEN),
            ["case", isMajor, ["literal", oMajorG], ["literal", oMinorG]],
            colContains(RED),
            ["case", isMajor, ["literal", oMajorR], ["literal", oMinorR]],
            ["case", isMajor, ["literal", oMajorW], ["literal", oMinorW]],
          ] as unknown as ExpressionSpecification)
        : null;
      return { iconExpr, offsetExpr };
    }

    // ── BOYSPP ────────────────────────────────────────────────────────────
    case "BOYSPP": {
      const iconExpr = [
        "case",
        isPrefPort, sp("preferred-port"),
        isPrefStbd, sp("preferred-stbd"),
        ["all", colContains(WHITE), colContains(ORANGE)], sp("special-wo"),
        // Superbuoys: BOYSHP=7, CATSPM=9 (ODAS), or CATSPM=15 (LANBY)
        ["any", ["==", ["get", "BOYSHP"], SUPER], isSuperbuoyByCat], sp("superbuoy"),
        sp("special"),
      ] as unknown as ExpressionSpecification;
      const oPrefPort = off(sp("preferred-port"));
      const oPrefStbd = off(sp("preferred-stbd"));
      const oSpecialWo = off(sp("special-wo"));
      const oSuperbuoy = off(sp("superbuoy"));
      const oSpecial = off(sp("special"));
      const hasBoysppOff = [oPrefPort, oPrefStbd, oSpecialWo, oSuperbuoy, oSpecial].some(
        (o) => o[0] !== 0 || o[1] !== 0,
      );
      const offsetExpr = hasBoysppOff
        ? ([
            "case",
            isPrefPort, ["literal", oPrefPort],
            isPrefStbd, ["literal", oPrefStbd],
            ["all", colContains(WHITE), colContains(ORANGE)], ["literal", oSpecialWo],
            ["any", ["==", ["get", "BOYSHP"], SUPER], isSuperbuoyByCat], ["literal", oSuperbuoy],
            ["literal", oSpecial],
          ] as unknown as ExpressionSpecification)
        : null;
      return { iconExpr, offsetExpr };
    }

    // ── BOYLAT ────────────────────────────────────────────────────────────
    case "BOYLAT": {
      const boyshp = ["coalesce", ["get", "BOYSHP"], CAN];
      // Port shapes
      const portConical = sp("lateral-port-conical");
      const portCan = sp("lateral-port-can");
      const portSpherical = sp("lateral-port-spherical");
      const portPillar = sp("lateral-port-pillar");
      const portSpar = sp("lateral-port-spar");
      // Starboard shapes
      const stbdConical = sp("lateral-stbd-conical");
      const stbdCan = sp("lateral-stbd-can");
      const stbdSpherical = sp("lateral-stbd-spherical");
      const stbdPillar = sp("lateral-stbd-pillar");
      const stbdSpar = sp("lateral-stbd-spar");
      // Preferred channel
      const prefPort = sp("preferred-port");
      const prefStbd = sp("preferred-stbd");

      const portShapeExpr = [
        "match", boyshp,
        CONICAL, portConical,
        CAN, portCan,
        SPHERICAL, portSpherical,
        PILLAR, portPillar,
        SPAR, portSpar,
        BARREL, portPillar,
        SUPER, portPillar,
        ICE, portPillar,
        portCan, // default
      ];
      const stbdShapeExpr = [
        "match", boyshp,
        CONICAL, stbdConical,
        CAN, stbdCan,
        SPHERICAL, stbdSpherical,
        PILLAR, stbdPillar,
        SPAR, stbdSpar,
        BARREL, stbdPillar,
        SUPER, stbdPillar,
        ICE, stbdPillar,
        stbdConical, // default for stbd (IALA-B default is conical)
      ];

      const iconExpr = [
        "case",
        // Preferred-channel buoys: CATLAM=3/4 takes priority over colour checks
        ["==", ["get", "CATLAM"], CATLAM_PREF_STBD], prefPort,
        ["==", ["get", "CATLAM"], CATLAM_PREF_PORT], prefStbd,
        isPrefPort, prefPort,
        isPrefStbd, prefStbd,
        ["==", ["get", "CATLAM"], PORT], portShapeExpr,
        ["==", ["get", "CATLAM"], STBD], stbdShapeExpr,
        fallback,
      ] as unknown as ExpressionSpecification;

      // Offset: pillar-type shapes get pillar offset; can-type shapes get can offset
      const oPillarPort = off(portPillar);
      const oCanPort = off(portCan);
      const oConicalPort = off(portConical);
      const oPillarStbd = off(stbdPillar);
      const oCanStbd = off(stbdCan);
      const oConicalStbd = off(stbdConical);
      const oPrefPort = off(prefPort);
      const oPrefStbd = off(prefStbd);
      const hasBoylatOff = [oPillarPort, oCanPort, oConicalPort, oPillarStbd, oCanStbd, oConicalStbd, oPrefPort, oPrefStbd].some(
        (o) => o[0] !== 0 || o[1] !== 0,
      );

      let offsetExpr: ExpressionSpecification | null = null;
      if (hasBoylatOff) {
        // Pillar shapes: PILLAR(4), SPAR(5), BARREL(6), SUPER(7), ICE(8)
        const isPillarShape = ["in", boyshp, ["literal", [PILLAR, SPAR, BARREL, SUPER, ICE]]];
        const portOffExpr = ["case", isPillarShape, ["literal", oPillarPort], ["literal", oCanPort]];
        const stbdOffExpr = ["case", isPillarShape, ["literal", oPillarStbd], ["literal", oCanStbd]];
        offsetExpr = [
          "case",
          ["==", ["get", "CATLAM"], CATLAM_PREF_STBD], ["literal", oPrefPort],
          ["==", ["get", "CATLAM"], CATLAM_PREF_PORT], ["literal", oPrefStbd],
          isPrefPort, ["literal", oPrefPort],
          isPrefStbd, ["literal", oPrefStbd],
          ["==", ["get", "CATLAM"], PORT], portOffExpr,
          ["==", ["get", "CATLAM"], STBD], stbdOffExpr,
          ["literal", [0, 0]],
        ] as unknown as ExpressionSpecification;
      }

      return { iconExpr, offsetExpr };
    }

    // ── DAYMAR ────────────────────────────────────────────────────────────
    case "DAYMAR": {
      const topIsTriangle = ["==", ["get", "TOPSHP"], TOPSHP_CONE_UP];
      const colHasGreen = colContains(GREEN);
      const iconExpr = [
        "case",
        ["all", topIsTriangle, colHasGreen], sp("daymark-triangle-green"),
        topIsTriangle, sp("daymark-triangle-red"),
        colHasGreen, sp("daymark-square-green"),
        sp("daymark-square-red"),
      ] as unknown as ExpressionSpecification;
      const oTG = off(sp("daymark-triangle-green"));
      const oTR = off(sp("daymark-triangle-red"));
      const oSG = off(sp("daymark-square-green"));
      const oSR = off(sp("daymark-square-red"));
      const hasDaymarOff = [oTG, oTR, oSG, oSR].some((o) => o[0] !== 0 || o[1] !== 0);
      const offsetExpr = hasDaymarOff
        ? ([
            "case",
            ["all", topIsTriangle, colHasGreen], ["literal", oTG],
            topIsTriangle, ["literal", oTR],
            colHasGreen, ["literal", oSG],
            ["literal", oSR],
          ] as unknown as ExpressionSpecification)
        : null;
      return { iconExpr, offsetExpr };
    }

    default:
      return constant(fallback);
  }
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
