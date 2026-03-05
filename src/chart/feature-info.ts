/**
 * Pure formatting functions for S-57 feature attributes.
 * Converts raw vector tile properties into human-readable display info.
 */

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
  BOYSAW: "Safe Water Buoy",
  BOYSPP: "Special Purpose Buoy",
  BOYISD: "Isolated Danger Buoy",
  BCNLAT: "Lateral Beacon",
  LIGHTS: "Navigation Light",
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
  const num = Number(value);
  if (Number.isNaN(num)) return undefined;
  return table[num];
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
  addIfPresent(details, "Color", props.COLOUR);
  return details;
}

function formatBeacon(
  props: Record<string, unknown>,
): { label: string; value: string }[] {
  const details: { label: string; value: string }[] = [];
  addIfPresent(details, "Number", quoteNumber(props.LABEL ?? props.OBJNAM));
  const cat = lookupCode(CATLAM, props.CATLAM);
  if (cat) details.push({ label: "Category", value: cat });
  addIfPresent(details, "Color", props.COLOUR);
  return details;
}

function formatLight(
  props: Record<string, unknown>,
): { label: string; value: string }[] {
  const details: { label: string; value: string }[] = [];
  addIfPresent(details, "Characteristic", props.LABEL);
  addIfPresent(details, "Height", props.HEIGHT ? `${props.HEIGHT}m` : null);
  addIfPresent(
    details,
    "Nominal Range",
    props.VALNMR ? `${props.VALNMR} NM` : null,
  );
  addIfPresent(details, "Color", props.COLOUR);
  return details;
}

function formatWreck(
  props: Record<string, unknown>,
): { label: string; value: string }[] {
  const details: { label: string; value: string }[] = [];
  const cat = lookupCode(CATWRK, props.CATWRK);
  if (cat) details.push({ label: "Category", value: cat });
  addIfPresent(details, "Depth", props.VALSOU ? `${props.VALSOU}m` : null);
  const wl = lookupCode(WATLEV, props.WATLEV);
  if (wl) details.push({ label: "Water Level", value: wl });
  return details;
}

function formatObstruction(
  props: Record<string, unknown>,
): { label: string; value: string }[] {
  const details: { label: string; value: string }[] = [];
  const cat = lookupCode(CATOBS, props.CATOBS);
  if (cat) details.push({ label: "Category", value: cat });
  addIfPresent(details, "Depth", props.VALSOU ? `${props.VALSOU}m` : null);
  const wl = lookupCode(WATLEV, props.WATLEV);
  if (wl) details.push({ label: "Water Level", value: wl });
  return details;
}

function formatUnderwaterRock(
  props: Record<string, unknown>,
): { label: string; value: string }[] {
  const details: { label: string; value: string }[] = [];
  addIfPresent(details, "Depth", props.VALSOU ? `${props.VALSOU}m` : null);
  const wl = lookupCode(WATLEV, props.WATLEV);
  if (wl) details.push({ label: "Water Level", value: wl });
  return details;
}

function formatDepthArea(
  props: Record<string, unknown>,
): { label: string; value: string }[] {
  const details: { label: string; value: string }[] = [];
  if (props.DRVAL1 != null && props.DRVAL2 != null) {
    details.push({
      label: "Depth Range",
      value: `${props.DRVAL1}m - ${props.DRVAL2}m`,
    });
  } else if (props.DRVAL1 != null) {
    details.push({ label: "Min Depth", value: `${props.DRVAL1}m` });
  }
  return details;
}

function formatSounding(
  props: Record<string, unknown>,
): { label: string; value: string }[] {
  const details: { label: string; value: string }[] = [];
  addIfPresent(details, "Depth", props.DEPTH ? `${props.DEPTH}m` : null);
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

const FORMATTERS: Record<
  string,
  (props: Record<string, unknown>) => { label: string; value: string }[]
> = {
  BOYLAT: formatBuoy,
  BOYSAW: formatBuoy,
  BOYSPP: formatBuoy,
  BOYISD: formatBuoy,
  BCNLAT: formatBeacon,
  LIGHTS: formatLight,
  WRECKS: formatWreck,
  OBSTRN: formatObstruction,
  UWTROC: formatUnderwaterRock,
  DEPARE: formatDepthArea,
  SOUNDG: formatSounding,
  RESARE: formatRestrictedArea,
  ACHARE: formatRestrictedArea,
  CTNARE: formatRestrictedArea,
};

export function formatFeatureInfo(
  sourceLayer: string,
  properties: Record<string, unknown>,
): FeatureInfo {
  const type = LAYER_NAMES[sourceLayer] ?? sourceLayer;
  const name =
    properties.OBJNAM != null ? String(properties.OBJNAM) : undefined;

  const formatter = FORMATTERS[sourceLayer];
  const details = formatter
    ? formatter(properties)
    : formatFallback(properties);

  return { type, name, details };
}
