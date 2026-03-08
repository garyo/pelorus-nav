/**
 * User settings persisted to localStorage.
 */

export type DepthUnit = "meters" | "feet" | "fathoms";
export type SpeedUnit = "knots" | "mph" | "kph";
export type ChartMode = "follow" | "course-up" | "north-up" | "free";
export type DetailLevel = -1 | 0 | 1 | 2;

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
}

const STORAGE_KEY = "pelorus-nav-settings";

export const LAYER_GROUP_LABELS: Record<string, string> = {
  routing: "Routing",
  restrictedAreas: "Restricted/Caution Areas",
  anchorage: "Anchorage",
  cablesAndPipes: "Cables & Pipes",
  facilities: "Facilities",
  magneticVariation: "Magnetic Variation",
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
};

type SettingsListener = (settings: Settings) => void;

let current: Settings = load();
const listeners: SettingsListener[] = [];

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Settings>;
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

export function onSettingsChange(fn: SettingsListener): void {
  listeners.push(fn);
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
