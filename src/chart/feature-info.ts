/**
 * Pure formatting functions for S-57 feature attributes.
 * Converts raw vector tile properties into human-readable display info.
 */

import { formatDepth, getSettings } from "../settings";
import { formatLatLon } from "../utils/coordinates";

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

const STATUS: Record<number, string> = {
  1: "Permanent",
  2: "Occasional",
  3: "Recommended",
  5: "Temporary",
  8: "Private",
  11: "Extinguished",
  12: "Illuminated",
  15: "Watched",
  17: "Unwatched",
  18: "Existence Doubtful",
};

const RESTRN: Record<number, string> = {
  1: "Anchoring prohibited",
  2: "Anchoring restricted",
  3: "Fishing prohibited",
  4: "Fishing restricted",
  5: "Trawling prohibited",
  6: "No wake",
  7: "Entry restricted",
  8: "Entry prohibited",
  13: "Speed restricted",
  16: "Discharging prohibited",
};

const CATBRG: Record<number, string> = {
  2: "Fixed",
  3: "Opening",
  4: "Swing",
  5: "Lifting/Bascule",
  6: "Bascule",
  7: "Pontoon",
  8: "Draw",
};

const CATCBL: Record<number, string> = {
  1: "Power",
  2: "Telephone/Telegraph",
  3: "Mooring",
};

const CATSCF: Record<number, string> = {
  1: "Boat Hoist",
  2: "Boat Yard",
  3: "Chandler",
  4: "Provisions",
  7: "Fuel Station",
  8: "Electricity",
  10: "Launching Ramp",
  11: "Slipway",
  14: "Marina",
  18: "Sailmaker",
  26: "Pumpout",
  27: "Emergency Phone",
};

const CATMOR: Record<number, string> = {
  1: "Dolphin",
  2: "Deviation Dolphin",
  3: "Bollard",
  4: "Wall",
  5: "Pile",
  6: "Chain",
  7: "Buoy",
};

const TRAFIC: Record<number, string> = {
  1: "Inbound",
  2: "Outbound",
  3: "One-way",
  4: "Two-way",
};

const CATWAT: Record<number, string> = {
  1: "Breakers",
  2: "Eddies",
  3: "Overfalls",
  4: "Tide Rips",
  5: "Bombora",
};

const CATGAT: Record<number, string> = {
  1: "General",
  2: "Flood Barrage",
  3: "Caisson",
  4: "Lock",
  5: "Dyke Gate",
};

const CATPIL: Record<number, string> = {
  1: "Cruising vessel",
  2: "Helicopter",
  3: "From shore",
};

const CATACH: Record<number, string> = {
  1: "Unrestricted",
  2: "Deep water",
  3: "Tanker",
  5: "Small craft",
  6: "Small craft (mooring)",
  9: "24-hour",
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
  "_scale_band",
  "_disp_cat",
  "_disp_pri",
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
  NAVLNE: "Navigation Line",
  RECTRC: "Recommended Track",
  DWRTCL: "Deep Water Route Centreline",
  TSSBND: "TSS Boundary",
  TSEZNE: "TSS Zone",
  TWRTPT: "Two-Way Route",
  ACHBRT: "Anchorage Berth",
  BCNSPP: "Special Purpose Beacon",
  SBDARE: "Seabed Area",
  CBLSUB: "Submarine Cable",
  CBLOHD: "Overhead Cable",
  CBLARE: "Cable Area",
  PIPARE: "Pipeline Area",
  PIPSOL: "Submarine Pipeline",
  DMPGRD: "Dumping Ground",
  HRBFAC: "Harbor Facility",
  OFSPLF: "Offshore Platform",
  SILTNK: "Silo/Tank",
  MAGVAR: "Magnetic Variation",
  DAYMAR: "Daymark",
  TOPMAR: "Topmark",
  SLCONS: "Shoreline Construction",
  SMCFAC: "Small Craft Facility",
  BUAARE: "Built-Up Area",
  LNDRGN: "Land Region",
  LNDELV: "Land Elevation",
  BRIDGE: "Bridge",
  PRCARE: "Precautionary Area",
  PILBOP: "Pilot Boarding Place",
  WATTUR: "Water Turbulence",
  GATCON: "Gate",
  DAMCON: "Dam",
  TUNNEL: "Tunnel",
  FSHFAC: "Fishing Facility",
  DYKCON: "Dyke",
  SLOTOP: "Slope/Cliff",
  PYLONS: "Pylon",
  CRANES: "Crane",
  FORSTC: "Fort",
  CGUSTA: "Coast Guard Station",
  HULKES: "Hulk",
  DRYDOC: "Dry Dock",
  RUNWAY: "Runway",
  AIRARE: "Airport",
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
      if (Array.isArray(arr)) {
        if (arr.length === 0) return undefined;
        const names = arr
          .map((v: unknown) => {
            const n = Number(v);
            return Number.isNaN(n) ? String(v) : (table[n] ?? String(v));
          })
          .filter(Boolean);
        if (names.length > 0) return names.join(", ");
        return undefined;
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
  const status = lookupAllCodes(STATUS, props.STATUS);
  addIfPresent(details, "Status", status);
  addIfPresent(details, "Information", props.INFORM);
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
  const status = lookupAllCodes(STATUS, props.STATUS);
  addIfPresent(details, "Status", status);
  addIfPresent(details, "Information", props.INFORM);
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
  const restrn = lookupAllCodes(RESTRN, props.RESTRN);
  addIfPresent(details, "Restriction", restrn);
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
  2: "Cemetery",
  3: "Chimney",
  4: "Dish Aerial",
  5: "Flagstaff",
  6: "Flare Stack",
  7: "Mast",
  8: "Windsock",
  9: "Monument",
  10: "Column",
  11: "Memorial Plaque",
  12: "Obelisk",
  13: "Statue",
  14: "Cross",
  15: "Dome",
  16: "Radar Scanner",
  17: "Tower",
  18: "Windmill",
  19: "Windmotor",
  20: "Spire/Minaret",
};

const FUNCTN: Record<number, string> = {
  2: "Harbour Master's Office",
  3: "Customs Office",
  4: "Coastguard Station",
  5: "Health Office",
  7: "Hospital",
  8: "Post Office",
  9: "Hotel",
  10: "Railway Station",
  11: "Police Station",
  12: "Water-Police Station",
  13: "Pilot Office",
  15: "Bank",
  16: "Power Station",
  18: "Transit Shed/Warehouse",
  19: "Factory",
  20: "Church",
  21: "Chapel",
  22: "Temple",
  23: "Pagoda",
  24: "Shinto Shrine",
  25: "Buddhist Temple",
  26: "Mosque",
  27: "Marabout",
  28: "Lookout",
  29: "Communication",
  30: "Television",
  31: "Radio",
  32: "Radar",
  33: "Light Support",
  35: "Microwave",
  36: "Cooling",
  37: "Observation",
  38: "Timeball",
  39: "Clock",
  40: "Control",
  41: "Airship Mooring",
  42: "Stadium",
  43: "Bus Station",
};

const NATCON: Record<number, string> = {
  1: "Masonry",
  2: "Concrete",
  3: "Boulder",
  4: "Hard-surfaced",
  5: "Unsurfaced",
  6: "Wooden",
  7: "Metal",
  8: "Glass Reinforced Plastic",
};

function formatLandmark(
  props: Record<string, unknown>,
): { label: string; value: string }[] {
  const details: { label: string; value: string }[] = [];
  const cat = lookupAllCodes(CATLMK, props.CATLMK);
  addIfPresent(details, "Type", cat);
  const func = lookupAllCodes(FUNCTN, props.FUNCTN);
  addIfPresent(details, "Function", func);
  addIfPresent(details, "Color", lookupAllCodes(COLOUR, props.COLOUR));
  const natcon = lookupAllCodes(NATCON, props.NATCON);
  addIfPresent(details, "Construction", natcon);
  const unit = getSettings().depthUnit;
  if (props.HEIGHT != null && Number(props.HEIGHT) > 0) {
    details.push({
      label: "Height",
      value: formatDepth(Number(props.HEIGHT), unit),
    });
  }
  if (props.ELEVAT != null && Number(props.ELEVAT) > 0) {
    details.push({
      label: "Elevation",
      value: formatDepth(Number(props.ELEVAT), unit),
    });
  }
  const vis = lookupCode(CONVIS, props.CONVIS);
  addIfPresent(details, "Visibility", vis);
  addIfPresent(details, "Information", props.INFORM);
  return details;
}

const CONVIS: Record<number, string> = {
  1: "Visually conspicuous",
  2: "Not visually conspicuous",
};

function formatBuilding(
  props: Record<string, unknown>,
): { label: string; value: string }[] {
  const details: { label: string; value: string }[] = [];
  const func = lookupAllCodes(FUNCTN, props.FUNCTN);
  addIfPresent(details, "Function", func);
  addIfPresent(details, "Color", lookupAllCodes(COLOUR, props.COLOUR));
  const natcon = lookupAllCodes(NATCON, props.NATCON);
  addIfPresent(details, "Construction", natcon);
  const unit = getSettings().depthUnit;
  if (props.HEIGHT != null && Number(props.HEIGHT) > 0) {
    details.push({
      label: "Height",
      value: formatDepth(Number(props.HEIGHT), unit),
    });
  }
  if (props.ELEVAT != null && Number(props.ELEVAT) > 0) {
    details.push({
      label: "Elevation",
      value: formatDepth(Number(props.ELEVAT), unit),
    });
  }
  const vis = lookupCode(CONVIS, props.CONVIS);
  addIfPresent(details, "Visibility", vis);
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

const NATSUR: Record<number, string> = {
  1: "Mud",
  2: "Clay",
  3: "Silt",
  4: "Sand",
  5: "Stone",
  6: "Gravel",
  7: "Pebbles",
  8: "Cobbles",
  9: "Rock",
  11: "Lava",
  14: "Coral",
  17: "Shells",
  18: "Boulder",
};

function formatSeabed(
  props: Record<string, unknown>,
): { label: string; value: string }[] {
  const details: { label: string; value: string }[] = [];
  const nat = lookupAllCodes(NATSUR, props.NATSUR);
  if (nat) details.push({ label: "Nature of Surface", value: nat });
  addIfPresent(details, "Information", props.INFORM);
  return details;
}

function formatHarbor(
  props: Record<string, unknown>,
): { label: string; value: string }[] {
  const details: { label: string; value: string }[] = [];
  addIfPresent(details, "Information", props.INFORM);
  return details;
}

const CATOFP: Record<number, string> = {
  1: "Oil Derrick",
  2: "Production Platform",
  3: "Observation/Research",
  4: "Articulated Loading Platform",
  5: "Single Anchor Leg Mooring",
  6: "Mooring Tower",
  7: "Artificial Island",
  8: "Floating Production",
  9: "Accommodation Platform",
  10: "Navigation Aid Support",
};

function formatOffshorePlatform(
  props: Record<string, unknown>,
): { label: string; value: string }[] {
  const details: { label: string; value: string }[] = [];
  const cat = lookupAllCodes(CATOFP, props.CATOFP);
  addIfPresent(details, "Type", cat);
  addIfPresent(details, "Color", lookupAllCodes(COLOUR, props.COLOUR));
  const unit = getSettings().depthUnit;
  if (props.HEIGHT != null && Number(props.HEIGHT) > 0) {
    details.push({
      label: "Height",
      value: formatDepth(Number(props.HEIGHT), unit),
    });
  }
  const vis = lookupCode(CONVIS, props.CONVIS);
  addIfPresent(details, "Visibility", vis);
  addIfPresent(details, "Information", props.INFORM);
  return details;
}

const CATSIL: Record<number, string> = {
  1: "Silo",
  2: "Tank",
  3: "Grain Elevator",
  4: "Water Tower",
};

function formatSiloTank(
  props: Record<string, unknown>,
): { label: string; value: string }[] {
  const details: { label: string; value: string }[] = [];
  const cat = lookupAllCodes(CATSIL, props.CATSIL);
  addIfPresent(details, "Type", cat);
  addIfPresent(details, "Color", lookupAllCodes(COLOUR, props.COLOUR));
  const natcon = lookupAllCodes(NATCON, props.NATCON);
  addIfPresent(details, "Construction", natcon);
  const unit = getSettings().depthUnit;
  if (props.HEIGHT != null && Number(props.HEIGHT) > 0) {
    details.push({
      label: "Height",
      value: formatDepth(Number(props.HEIGHT), unit),
    });
  }
  if (props.ELEVAT != null && Number(props.ELEVAT) > 0) {
    details.push({
      label: "Elevation",
      value: formatDepth(Number(props.ELEVAT), unit),
    });
  }
  const vis = lookupCode(CONVIS, props.CONVIS);
  addIfPresent(details, "Visibility", vis);
  addIfPresent(details, "Information", props.INFORM);
  return details;
}

function formatMagVar(
  props: Record<string, unknown>,
): { label: string; value: string }[] {
  const details: { label: string; value: string }[] = [];
  addIfPresent(
    details,
    "Value",
    props.VALMAG != null ? `${props.VALMAG}\u00b0` : null,
  );
  addIfPresent(details, "Year", props.RYRMGV);
  return details;
}

function formatLandArea(
  props: Record<string, unknown>,
): { label: string; value: string }[] {
  const details: { label: string; value: string }[] = [];
  addIfPresent(details, "Information", props.INFORM);
  return details;
}

function formatLandElevation(
  props: Record<string, unknown>,
): { label: string; value: string }[] {
  const details: { label: string; value: string }[] = [];
  addIfPresent(details, "Name", props.OBJNAM);
  const unit = getSettings().depthUnit;
  if (props.ELEVAT != null) {
    details.push({
      label: "Elevation",
      value: formatDepth(Number(props.ELEVAT), unit),
    });
  }
  addIfPresent(details, "Information", props.INFORM);
  return details;
}

function formatBridge(
  props: Record<string, unknown>,
): { label: string; value: string }[] {
  const details: { label: string; value: string }[] = [];
  addIfPresent(details, "Name", props.OBJNAM);
  const cat = lookupCode(CATBRG, props.CATBRG);
  addIfPresent(details, "Type", cat);
  const unit = getSettings().depthUnit;
  if (props.VERCLR != null) {
    details.push({
      label: "Vertical Clearance",
      value: formatDepth(Number(props.VERCLR), unit),
    });
  }
  if (props.HORCLR != null) {
    details.push({
      label: "Horizontal Clearance",
      value: formatDepth(Number(props.HORCLR), unit),
    });
  }
  if (props.VERCCL != null) {
    details.push({
      label: "Clearance (closed)",
      value: formatDepth(Number(props.VERCCL), unit),
    });
  }
  if (props.VERCOP != null) {
    details.push({
      label: "Clearance (open)",
      value: formatDepth(Number(props.VERCOP), unit),
    });
  }
  addIfPresent(details, "Information", props.INFORM);
  return details;
}

function formatOverheadCable(
  props: Record<string, unknown>,
): { label: string; value: string }[] {
  const details: { label: string; value: string }[] = [];
  addIfPresent(details, "Name", props.OBJNAM);
  const cat = lookupCode(CATCBL, props.CATCBL);
  addIfPresent(details, "Type", cat);
  const unit = getSettings().depthUnit;
  if (props.VERCLR != null) {
    details.push({
      label: "Vertical Clearance",
      value: formatDepth(Number(props.VERCLR), unit),
    });
  }
  if (props.VERCSA != null) {
    details.push({
      label: "Safe Clearance",
      value: formatDepth(Number(props.VERCSA), unit),
    });
  }
  addIfPresent(details, "Information", props.INFORM);
  return details;
}

function formatSmallCraftFacility(
  props: Record<string, unknown>,
): { label: string; value: string }[] {
  const details: { label: string; value: string }[] = [];
  addIfPresent(details, "Name", props.OBJNAM);
  const cat = lookupAllCodes(CATSCF, props.CATSCF);
  addIfPresent(details, "Facility", cat);
  addIfPresent(details, "Information", props.INFORM);
  return details;
}

function formatMooringFacility(
  props: Record<string, unknown>,
): { label: string; value: string }[] {
  const details: { label: string; value: string }[] = [];
  addIfPresent(details, "Name", props.OBJNAM);
  const cat = lookupCode(CATMOR, props.CATMOR);
  addIfPresent(details, "Type", cat);
  addIfPresent(details, "Information", props.INFORM);
  return details;
}

function formatFairway(
  props: Record<string, unknown>,
): { label: string; value: string }[] {
  const details: { label: string; value: string }[] = [];
  addIfPresent(details, "Name", props.OBJNAM);
  const trafic = lookupCode(TRAFIC, props.TRAFIC);
  addIfPresent(details, "Traffic", trafic);
  const unit = getSettings().depthUnit;
  if (props.DRVAL1 != null) {
    details.push({
      label: "Controlling Depth",
      value: formatDepth(Number(props.DRVAL1), unit),
    });
  }
  if (props.ORIENT != null) {
    details.push({
      label: "Orientation",
      value: `${props.ORIENT}\u00b0`,
    });
  }
  addIfPresent(details, "Information", props.INFORM);
  return details;
}

function formatPrecautionaryArea(
  props: Record<string, unknown>,
): { label: string; value: string }[] {
  const details: { label: string; value: string }[] = [];
  addIfPresent(details, "Name", props.OBJNAM);
  const restrn = lookupAllCodes(RESTRN, props.RESTRN);
  addIfPresent(details, "Restriction", restrn);
  addIfPresent(details, "Information", props.INFORM);
  return details;
}

function formatWaterTurbulence(
  props: Record<string, unknown>,
): { label: string; value: string }[] {
  const details: { label: string; value: string }[] = [];
  const cat = lookupCode(CATWAT, props.CATWAT);
  addIfPresent(details, "Type", cat);
  addIfPresent(details, "Name", props.OBJNAM);
  addIfPresent(details, "Information", props.INFORM);
  return details;
}

function formatGate(
  props: Record<string, unknown>,
): { label: string; value: string }[] {
  const details: { label: string; value: string }[] = [];
  const cat = lookupCode(CATGAT, props.CATGAT);
  addIfPresent(details, "Type", cat);
  addIfPresent(details, "Name", props.OBJNAM);
  addIfPresent(details, "Information", props.INFORM);
  return details;
}

function formatPilotBoarding(
  props: Record<string, unknown>,
): { label: string; value: string }[] {
  const details: { label: string; value: string }[] = [];
  const cat = lookupCode(CATPIL, props.CATPIL);
  addIfPresent(details, "Type", cat);
  addIfPresent(details, "Name", props.OBJNAM);
  addIfPresent(details, "Pilot District", props.NPLDST);
  addIfPresent(details, "Information", props.INFORM);
  return details;
}

function formatAnchorageArea(
  props: Record<string, unknown>,
): { label: string; value: string }[] {
  const details: { label: string; value: string }[] = [];
  addIfPresent(details, "Name", props.OBJNAM);
  const cat = lookupCode(CATACH, props.CATACH);
  addIfPresent(details, "Type", cat);
  const restrn = lookupAllCodes(RESTRN, props.RESTRN);
  addIfPresent(details, "Restriction", restrn);
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
  ACHARE: formatAnchorageArea,
  CTNARE: formatRestrictedArea,
  BRIDGE: formatBridge,
  CBLOHD: formatOverheadCable,
  SMCFAC: formatSmallCraftFacility,
  MORFAC: formatMooringFacility,
  FAIRWY: formatFairway,
  PRCARE: formatPrecautionaryArea,
  WATTUR: formatWaterTurbulence,
  GATCON: formatGate,
  PILBOP: formatPilotBoarding,
  BCNSPP: formatBeacon,
  SBDARE: formatSeabed,
  HRBFAC: formatHarbor,
  OFSPLF: formatOffshorePlatform,
  MAGVAR: formatMagVar,
  SILTNK: formatSiloTank,
  LNDARE: formatLandArea,
  LNDELV: formatLandElevation,
  BUISGL: formatBuilding,
};

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
      value: `${formatLatLon(lngLat.lat, "lat")} ${formatLatLon(lngLat.lng, "lon")}`,
    });
  }

  return { type, name, details };
}
