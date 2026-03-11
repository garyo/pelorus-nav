/**
 * User settings persisted to localStorage.
 */

export type DepthUnit = "meters" | "feet" | "fathoms";
export type SpeedUnit = "knots" | "mph" | "kph";
export type ChartMode = "follow" | "course-up" | "north-up" | "free";
export type DetailLevel = -1 | 0 | 1 | 2;
export type CourseLineDuration = 0 | 15 | 30 | 60;
export type DisplayTheme = "day" | "dusk" | "night" | "eink";
export type BearingMode = "true" | "magnetic";
export type SymbologyScheme =
  | "pelorus-standard"
  | "iho-s52"
  | "simplified-minimal";

export interface Settings {
  depthUnit: DepthUnit;
  speedUnit: SpeedUnit;
  chartMode: ChartMode;
  gpsSource: string;
  updateRateHz: number;
  showAccuracyCircle: boolean;
  detailLevel: DetailLevel;
  layerGroups: Record<string, boolean>;
  showInstrumentHUD: boolean;
  instrumentCells: [string, string];
  trackRecordingEnabled: boolean;
  activeTrackColor: string;
  activeRegion: string;
  courseLineDuration: CourseLineDuration;
  simulatorSpeed: number;
  displayTheme: DisplayTheme;
  symbologyScheme: SymbologyScheme;
  /** Arrival radius in NM — auto-advance route legs when closer than this. */
  arrivalRadiusNM: number;
  /** Display bearings as true or magnetic. */
  bearingMode: BearingMode;
  /** Show OSM raster tiles underneath S-57 vector charts for land context. */
  showOSMUnderlay: boolean;
  /** Shallow water threshold in meters (areas < this get DEPVS color). */
  shallowDepth: number;
  /** Deep water threshold in meters (areas >= this get DEPDW color). */
  deepDepth: number;
}

const STORAGE_KEY = "pelorus-nav-settings";

export const LAYER_GROUP_LABELS: Record<string, string> = {
  routing: "Routing",
  restrictedAreas: "Restricted/Caution Areas",
  anchorage: "Anchorage",
  cablesAndPipes: "Cables & Pipes",
  facilities: "Facilities",
  magneticVariation: "Magnetic Variation",
  depthContourLabels: "Depth Contour Labels",
  seabed: "Seabed",
  daymarksTopmarks: "Daymarks & Topmarks",
};

const DEFAULT_LAYER_GROUPS: Record<string, boolean> = Object.fromEntries(
  Object.keys(LAYER_GROUP_LABELS).map((k) => [k, true]),
);

const DEFAULTS: Settings = {
  depthUnit: "meters",
  speedUnit: "knots",
  chartMode: "north-up",
  gpsSource: "none",
  updateRateHz: 1,
  showAccuracyCircle: true,
  detailLevel: 0,
  layerGroups: { ...DEFAULT_LAYER_GROUPS },
  showInstrumentHUD: false,
  instrumentCells: ["sog", "cog"],
  trackRecordingEnabled: false,
  activeTrackColor: "#ff4444",
  activeRegion: "new-england",
  courseLineDuration: 0,
  arrivalRadiusNM: 0.1,
  simulatorSpeed: 1,
  displayTheme: "day",
  symbologyScheme: "iho-s52",
  bearingMode: "magnetic",
  showOSMUnderlay: false,
  shallowDepth: 5,
  deepDepth: 20,
};

type SettingsListener = (settings: Settings) => void;

let current: Settings = load();
const listeners: SettingsListener[] = [];

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Settings>;
      // Migrate old scheme names
      if (parsed.symbologyScheme === ("ecdis-simplified" as string)) {
        parsed.symbologyScheme = "pelorus-standard";
      } else if (parsed.symbologyScheme === ("int-paper" as string)) {
        parsed.symbologyScheme = "iho-s52";
      }
      return {
        ...DEFAULTS,
        ...parsed,
        layerGroups: { ...DEFAULT_LAYER_GROUPS, ...parsed.layerGroups },
      };
    }
  } catch {
    // ignore
  }
  return { ...DEFAULTS, layerGroups: { ...DEFAULT_LAYER_GROUPS } };
}

function save(): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
}

function notify(): void {
  for (const fn of listeners) {
    fn(current);
  }
}

export function getSettings(): Readonly<Settings> {
  return current;
}

export function updateSettings(partial: Partial<Settings>): void {
  current = { ...current, ...partial };
  save();
  notify();
}

export function onSettingsChange(fn: SettingsListener): () => void {
  listeners.push(fn);
  return () => {
    const idx = listeners.indexOf(fn);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}

/** Meters-to-unit conversion factor. */
export function depthConversionFactor(unit: DepthUnit): number {
  switch (unit) {
    case "feet":
      return 3.28084;
    case "fathoms":
      return 0.546807;
    default:
      return 1;
  }
}

/** Unit abbreviation for display. */
export function depthUnitLabel(unit: DepthUnit): string {
  switch (unit) {
    case "feet":
      return "ft";
    case "fathoms":
      return "fm";
    default:
      return "m";
  }
}

/** Convert a depth value from meters to the given unit. */
export function convertDepth(meters: number, unit: DepthUnit): number {
  return meters * depthConversionFactor(unit);
}

/** Format a depth value with unit suffix. */
export function formatDepth(meters: number, unit: DepthUnit): string {
  const converted = convertDepth(meters, unit);
  const decimals = unit === "fathoms" ? 1 : unit === "feet" ? 0 : 1;
  return `${converted.toFixed(decimals)}${depthUnitLabel(unit)}`;
}
