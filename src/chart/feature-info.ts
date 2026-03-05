/**
 * Pure formatting functions for S-57 feature attributes.
 * Converts raw vector tile properties into human-readable display info.
 */

import { formatDepth, getSettings } from "../settings";

export interface FeatureInfo {
  type: string;
  name?: string;
  details: { label: string; value: string }[];
}

// S-57 attribute code lookup tables
const CATLAM: Record<number, string> = {
  1: "Port",
  2: "Starboard",
};

const CATWRK: Record<number, string> = {
  1: "Non-dangerous",
  2: "Dangerous",
  4: "Showing hull",
  5: "Showing mast",
};

const CATOBS: Record<number, string> = {
  1: "Snag/stump",
  2: "Wellhead",
  5: "Foul area",
  6: "Foul ground",
};

const WATLEV: Record<number, string> = {
  1: "Partly submerged",
  2: "Always dry",
  3: "Always underwater",
  4: "Covers and uncovers",
};

const BOYSHP: Record<number, string> = {
  1: "Conical",
  2: "Can",
  3: "Spherical",
  4: "Pillar",
  5: "Spar",
};

const CATREA: Record<number, string> = {
  1: "Offshore safety zone",
  4: "Nature reserve",
  7: "Bird sanctuary",
  14: "No anchoring",
  27: "No wake",
};

// Fields that are internal/structural and should not be shown to users
const INTERNAL_FIELDS = new Set([
  "RCID",
  "PRIM",
  "GRUP",
  "OBJL",
  "RVER",
  "AGEN",
  "FIDN",
  "FIDS",
  "LNAM",
  "LNAM_REFS",
  "FFPT_RIND",
  "SORDAT",
  "SORIND",
  "SCAMIN",
  "SCAMAX",
]);

// Human-readable names for S-57 object classes
const LAYER_NAMES: Record<string, string> = {
  BOYLAT: "Lateral Buoy",
  BOYCAR: "Cardinal Buoy",
  BOYSAW: "Safe Water Buoy",
  BOYSPP: "Special Purpose Buoy",
  BOYISD: "Isolated Danger Buoy",
  BCNLAT: "Lateral Beacon",
  BCNCAR: "Cardinal Beacon",
  LIGHTS: "Navigation Light",
  LNDMRK: "Landmark",
  FOGSIG: "Fog Signal",
  WRECKS: "Wreck",
  OBSTRN: "Obstruction",
  UWTROC: "Underwater Rock",
  DEPARE: "Depth Area",
  SOUNDG: "Sounding",
  RESARE: "Restricted Area",
  ACHARE: "Anchorage Area",
  CTNARE: "Caution Area",
  FAIRWY: "Fairway",
  TSSLPT: "Traffic Separation Lane",
  LNDARE: "Land Area",
  SEAARE: "Sea Area",
  BUISGL: "Building",
  BERTHS: "Berth",
  PILPNT: "Piling",
  MORFAC: "Mooring Facility",
};

function lookupCode(
  table: Record<number, string>,
  value: unknown,
): string | undefined {
  if (value == null) return undefined;
  // Handle stringified arrays like '["17"]' from vector tiles
  if (typeof value === "string" && value.startsWith("[")) {
    try {
      const arr = JSON.parse(value);
      if (Array.isArray(arr) && arr.length > 0) {
        const num = Number(arr[0]);
        if (!Number.isNaN(num)) return table[num];
      }
    } catch {
      // fall through
    }
  }
  const num = Number(value);
  if (Number.isNaN(num)) return undefined;
  return table[num];
}

const COLOUR: Record<number, string> = {
  1: "White",
  2: "Black",
  3: "Red",
  4: "Green",
  5: "Blue",
  6: "Yellow",
  7: "Grey",
  8: "Brown",
  9: "Amber",
  10: "Violet",
  11: "Orange",
  12: "Magenta",
  13: "Pink",
};

/** Look up all codes in a stringified array, returning a joined string. */
function lookupAllCodes(
  table: Record<number, string>,
  value: unknown,
): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string" && value.startsWith("[")) {
    try {
      const arr = JSON.parse(value);
      if (Array.isArray(arr) && arr.length > 0) {
        const names = arr
          .map((v: unknown) => {
            const n = Number(v);
            return Number.isNaN(n) ? String(v) : (table[n] ?? String(v));
          })
          .filter(Boolean);
        if (names.length > 0) return names.join(", ");
      }
    } catch {
      // fall through
    }
  }
  const num = Number(value);
  if (Number.isNaN(num)) return typeof value === "string" ? value : undefined;
  return table[num] ?? String(value);
}

function addIfPresent(
  details: { label: string; value: string }[],
  label: string,
  value: unknown,
): void {
  if (value != null && value !== "") {
    details.push({ label, value: String(value) });
  }
}

function quoteNumber(val: unknown): string | null {
  if (val == null || val === "") return null;
  return `"${val}"`;
}

function formatBuoy(
  props: Record<string, unknown>,
): { label: string; value: string }[] {
  const details: { label: string; value: string }[] = [];
  addIfPresent(details, "Number", quoteNumber(props.LABEL ?? props.OBJNAM));
  const cat = lookupCode(CATLAM, props.CATLAM);
  if (cat) details.push({ label: "Category", value: cat });
  const shape = lookupCode(BOYSHP, props.BOYSHP);
  if (shape) details.push({ label: "Shape", value: shape });
  addIfPresent(details, "Color", lookupAllCodes(COLOUR, props.COLOUR));
  return details;
}

function formatBeacon(
  props: Record<string, unknown>,
): { label: string; value: string }[] {
  const details: { label: string; value: string }[] = [];
  addIfPresent(details, "Number", quoteNumber(props.LABEL ?? props.OBJNAM));
  const cat = lookupCode(CATLAM, props.CATLAM);
  if (cat) details.push({ label: "Category", value: cat });
  addIfPresent(details, "Color", lookupAllCodes(COLOUR, props.COLOUR));
  return details;
}

const CATLIT: Record<number, string> = {
  1: "Directional",
  4: "Leading",
  5: "Aero",
  6: "Air obstruction",
  7: "Fog detector",
  8: "Flood",
  9: "Strip",
  11: "Horizontally disposed",
  12: "Vertically disposed",
  17: "Floodlit (structure)",
};

const LITVIS: Record<number, string> = {
  1: "High intensity",
  2: "Low intensity",
  3: "Faint",
  5: "Intensified sector",
  7: "Obscured",
  8: "Partially obscured",
};

function formatLight(
  props: Record<string, unknown>,
): { label: string; value: string }[] {
  const details: { label: string; value: string }[] = [];
  addIfPresent(details, "Characteristic", props.LABEL);
  const cat = lookupCode(CATLIT, props.CATLIT);
  if (cat) details.push({ label: "Category", value: cat });
  const vis = lookupCode(LITVIS, props.LITVIS);
  if (vis) details.push({ label: "Visibility", value: vis });
  addIfPresent(
    details,
    "Height",
    props.HEIGHT != null
      ? formatDepth(Number(props.HEIGHT), getSettings().depthUnit)
      : null,
  );
  addIfPresent(
    details,
    "Nominal Range",
    props.VALNMR ? `${props.VALNMR} NM` : null,
  );
  addIfPresent(details, "Color", lookupAllCodes(COLOUR, props.COLOUR));
  addIfPresent(details, "Information", props.INFORM);
  return details;
}

function formatWreck(
  props: Record<string, unknown>,
): { label: string; value: string }[] {
  const details: { label: string; value: string }[] = [];
  const unit = getSettings().depthUnit;
  const cat = lookupCode(CATWRK, props.CATWRK);
  if (cat) details.push({ label: "Category", value: cat });
  addIfPresent(
    details,
    "Depth",
    props.VALSOU != null ? formatDepth(Number(props.VALSOU), unit) : null,
  );
  const wl = lookupCode(WATLEV, props.WATLEV);
  if (wl) details.push({ label: "Water Level", value: wl });
  return details;
}

function formatObstruction(
  props: Record<string, unknown>,
): { label: string; value: string }[] {
  const details: { label: string; value: string }[] = [];
  const unit = getSettings().depthUnit;
  const cat = lookupCode(CATOBS, props.CATOBS);
  if (cat) details.push({ label: "Category", value: cat });
  addIfPresent(
    details,
    "Depth",
    props.VALSOU != null ? formatDepth(Number(props.VALSOU), unit) : null,
  );
  const wl = lookupCode(WATLEV, props.WATLEV);
  if (wl) details.push({ label: "Water Level", value: wl });
  return details;
}

function formatUnderwaterRock(
  props: Record<string, unknown>,
): { label: string; value: string }[] {
  const details: { label: string; value: string }[] = [];
  const unit = getSettings().depthUnit;
  addIfPresent(
    details,
    "Depth",
    props.VALSOU != null ? formatDepth(Number(props.VALSOU), unit) : null,
  );
  const wl = lookupCode(WATLEV, props.WATLEV);
  if (wl) details.push({ label: "Water Level", value: wl });
  return details;
}

function formatDepthArea(
  props: Record<string, unknown>,
): { label: string; value: string }[] {
  const details: { label: string; value: string }[] = [];
  const unit = getSettings().depthUnit;
  if (props.DRVAL1 != null && props.DRVAL2 != null) {
    details.push({
      label: "Depth Range",
      value: `${formatDepth(Number(props.DRVAL1), unit)} - ${formatDepth(Number(props.DRVAL2), unit)}`,
    });
  } else if (props.DRVAL1 != null) {
    details.push({
      label: "Min Depth",
      value: formatDepth(Number(props.DRVAL1), unit),
    });
  }
  return details;
}

function formatSounding(
  props: Record<string, unknown>,
): { label: string; value: string }[] {
  const details: { label: string; value: string }[] = [];
  const unit = getSettings().depthUnit;
  addIfPresent(
    details,
    "Depth",
    props.DEPTH != null ? formatDepth(Number(props.DEPTH), unit) : null,
  );
  return details;
}

function formatRestrictedArea(
  props: Record<string, unknown>,
): { label: string; value: string }[] {
  const details: { label: string; value: string }[] = [];
  const cat = lookupCode(CATREA, props.CATREA);
  if (cat) details.push({ label: "Restriction", value: cat });
  addIfPresent(details, "Information", props.INFORM);
  return details;
}

function formatFallback(
  props: Record<string, unknown>,
): { label: string; value: string }[] {
  const details: { label: string; value: string }[] = [];
  for (const [key, value] of Object.entries(props)) {
    if (!INTERNAL_FIELDS.has(key) && value != null && value !== "") {
      details.push({ label: key, value: String(value) });
    }
  }
  return details;
}

const CATLMK: Record<number, string> = {
  1: "Cairn",
  3: "Chimney",
  5: "Flagstaff",
  7: "Monument",
  9: "Tower",
  15: "Windmill",
  17: "Lighthouse",
  20: "Windmotor",
};

function formatLandmark(
  props: Record<string, unknown>,
): { label: string; value: string }[] {
  const details: { label: string; value: string }[] = [];
  const cat = lookupCode(CATLMK, props.CATLMK);
  if (cat) details.push({ label: "Type", value: cat });
  addIfPresent(details, "Color", lookupAllCodes(COLOUR, props.COLOUR));
  addIfPresent(details, "Information", props.INFORM);
  return details;
}

const CATFOG: Record<number, string> = {
  1: "Explosive",
  2: "Diaphone",
  3: "Siren",
  4: "Nautophone",
  5: "Reed",
  6: "Tyfon",
  7: "Bell",
  8: "Whistle",
  9: "Gong",
  10: "Horn",
};

function formatFogSignal(
  props: Record<string, unknown>,
): { label: string; value: string }[] {
  const details: { label: string; value: string }[] = [];
  const cat = lookupCode(CATFOG, props.CATFOG);
  if (cat) details.push({ label: "Type", value: cat });
  if (props.SIGPER != null) {
    details.push({ label: "Period", value: `${props.SIGPER}s` });
  }
  addIfPresent(details, "Information", props.INFORM);
  return details;
}

const FORMATTERS: Record<
  string,
  (props: Record<string, unknown>) => { label: string; value: string }[]
> = {
  BOYLAT: formatBuoy,
  BOYCAR: formatBuoy,
  BOYSAW: formatBuoy,
  BOYSPP: formatBuoy,
  BOYISD: formatBuoy,
  BCNLAT: formatBeacon,
  BCNCAR: formatBeacon,
  LNDMRK: formatLandmark,
  LIGHTS: formatLight,
  FOGSIG: formatFogSignal,
  WRECKS: formatWreck,
  OBSTRN: formatObstruction,
  UWTROC: formatUnderwaterRock,
  DEPARE: formatDepthArea,
  SOUNDG: formatSounding,
  RESARE: formatRestrictedArea,
  ACHARE: formatRestrictedArea,
  CTNARE: formatRestrictedArea,
};

function formatDDM(deg: number, pos: string, neg: string): string {
  const dir = deg >= 0 ? pos : neg;
  const abs = Math.abs(deg);
  const d = Math.floor(abs);
  const m = ((abs - d) * 60).toFixed(3);
  return `${d}\u00b0${String(m).padStart(6, "0")}'${dir}`;
}

export function formatFeatureInfo(
  sourceLayer: string,
  properties: Record<string, unknown>,
  lngLat?: { lng: number; lat: number },
): FeatureInfo {
  const type = LAYER_NAMES[sourceLayer] ?? sourceLayer;
  const name =
    properties.OBJNAM != null ? String(properties.OBJNAM) : undefined;

  const formatter = FORMATTERS[sourceLayer];
  const details = formatter
    ? formatter(properties)
    : formatFallback(properties);

  if (lngLat) {
    details.push({
      label: "Position",
      value: `${formatDDM(lngLat.lat, "N", "S")} ${formatDDM(lngLat.lng, "E", "W")}`,
    });
  }

  return { type, name, details };
}
