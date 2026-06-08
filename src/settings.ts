/**
 * User settings persisted to localStorage.
 */
import { Capacitor } from "@capacitor/core";

export type DepthUnit = "meters" | "feet" | "fathoms";
export type SpeedUnit = "knots" | "mph" | "kph";
export type ChartMode = "follow" | "course-up" | "north-up" | "free";
export type DetailLevel = -1 | 0 | 1 | 2;
export type CourseLineDuration = 0 | "auto" | 5 | 15 | 30 | 60;
export type DisplayTheme = "day" | "dusk" | "night" | "eink";
export type BearingMode = "true" | "magnetic";
export type StreetUnderlayMode = "auto" | "osm" | "off";
export type SymbologyScheme =
  | "pelorus-standard"
  | "iho-s52"
  | "simplified-minimal";
export type GpsRateMode = "adaptive" | "manual";
/**
 * "auto" detects jittery hardware and smooths harder only when needed.
 * "strong" forces heavy smoothing always (good for known-bad GPS).
 * "normal" disables adaptive smoothing (good for known-clean hardware).
 */
export type GpsFilterMode = "auto" | "strong" | "normal";
export type WakeLockMode = "off" | "when-nav" | "always";
/**
 * Instrument HUD layout on landscape phones (portrait/desktop are unaffected):
 * "standard" — top bar; all instruments packed into one tight row.
 * "side" — instruments move to a vertical column down the left edge.
 */
export type InstrumentLayout = "standard" | "side";

export interface Settings {
  /** Bumped when stored settings need a one-time migration on load. */
  settingsVersion: number;
  depthUnit: DepthUnit;
  speedUnit: SpeedUnit;
  chartMode: ChartMode;
  gpsSource: string;
  gpsRateMode: GpsRateMode;
  manualUpdateIntervalMs: number;
  /** Adaptive filter strength — auto-detect jittery GPS, or force. */
  gpsFilterMode: GpsFilterMode;
  showAccuracyCircle: boolean;
  detailLevel: DetailLevel;
  layerGroups: Record<string, boolean>;
  showInstrumentHUD: boolean;
  /** Instrument HUD layout on landscape phones. */
  instrumentLayout: InstrumentLayout;
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
  /** Planning speed (knots) for route pre-visualization ETAs. */
  routePlanSpeedKn: number;
  /** Display bearings as true or magnetic. */
  bearingMode: BearingMode;
  /**
   * Street map underneath S-57 vector charts for land context.
   * "auto" = offline vector basemap when downloaded, else OSM raster;
   * "osm" = always OSM raster; "off" = chart only.
   */
  streetUnderlay: StreetUnderlayMode;
  /** Shallow water threshold in meters (areas < this get DEPVS color). */
  shallowDepth: number;
  /** Safety depth in meters — soundings ≤ this are shown in high-contrast (SNDG2). */
  safetyDepth: number;
  /** Deep water threshold in meters (areas >= this get DEPDW color). */
  deepDepth: number;
  /** Screen wake lock: off, when GPS active, or always. */
  wakeLock: WakeLockMode;
  /** Auto-dim the screen after a stretch of no user interaction (native only). */
  autoDimWhenIdle: boolean;
  /** After a stretch of no interaction, close open dialogs and recenter on the vessel. */
  autoReturnWhenIdle: boolean;
  /** Scale factor for chart text labels (1 = default). */
  textScale: number;
  /** Scale factor for chart icons (1 = default, multiplied with scheme/theme scale). */
  iconScale: number;
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
  lightSectors: "Light Sectors",
};

const DEFAULT_LAYER_GROUPS: Record<string, boolean> = {
  ...Object.fromEntries(Object.keys(LAYER_GROUP_LABELS).map((k) => [k, true])),
  lightSectors: false,
};

/** A toggleable layer group contributed by a plugin (see `registerLayerGroup`). */
export interface LayerGroupDecl {
  id: string;
  label: string;
  /** Enabled state used when the user has no stored preference. */
  default: boolean;
}

const pluginLayerGroups: LayerGroupDecl[] = [];

/** Register a plugin layer-group toggle; appears in the Layers settings tab. */
export function registerLayerGroup(decl: LayerGroupDecl): void {
  if (!pluginLayerGroups.some((g) => g.id === decl.id)) {
    pluginLayerGroups.push(decl);
  }
}

/** Core + plugin-registered layer groups, in display order. */
export function getLayerGroups(): LayerGroupDecl[] {
  const core = Object.entries(LAYER_GROUP_LABELS).map(([id, label]) => ({
    id,
    label,
    default: DEFAULT_LAYER_GROUPS[id] ?? true,
  }));
  return [...core, ...pluginLayerGroups];
}

/** Whether a layer group (core or plugin) is currently enabled. */
export function isLayerGroupEnabled(groupId: string): boolean {
  const stored = current.layerGroups[groupId];
  if (typeof stored === "boolean") return stored;
  const reg = pluginLayerGroups.find((g) => g.id === groupId);
  if (reg) return reg.default;
  return DEFAULT_LAYER_GROUPS[groupId] ?? true;
}

const SETTINGS_VERSION = 2;

const DEFAULTS: Settings = {
  settingsVersion: SETTINGS_VERSION,
  depthUnit: "feet",
  speedUnit: "knots",
  chartMode: "north-up",
  gpsSource: Capacitor.isNativePlatform() ? "capacitor-gps" : "none",
  gpsRateMode: "adaptive",
  manualUpdateIntervalMs: 2000,
  gpsFilterMode: "auto",
  showAccuracyCircle: true,
  detailLevel: 0,
  layerGroups: { ...DEFAULT_LAYER_GROUPS },
  showInstrumentHUD: false,
  instrumentLayout: "side",
  instrumentCells: ["sog", "cog"],
  trackRecordingEnabled: false,
  activeTrackColor: "#ff4444",
  activeRegion: "northern-new-england",
  courseLineDuration: 0,
  arrivalRadiusNM: 0.1,
  routePlanSpeedKn: 5,
  simulatorSpeed: 1,
  displayTheme: "day",
  symbologyScheme: "iho-s52",
  bearingMode: "magnetic",
  streetUnderlay: "auto",
  shallowDepth: 1.83,
  safetyDepth: 6.1,
  deepDepth: 15.24,
  wakeLock: "when-nav",
  autoDimWhenIdle: false,
  autoReturnWhenIdle: true,
  textScale: 1,
  iconScale: 1,
};

type SettingsListener = (settings: Settings) => void;

let current: Settings = load();
const listeners: SettingsListener[] = [];

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Settings>;
      // Only IHO S-52 symbology is supported (the chooser was removed)
      parsed.symbologyScheme = "iho-s52";
      const legacy = parsed as Record<string, unknown>;
      // v2: street underlay became on-by-default
      if ((parsed.settingsVersion ?? 1) < 2) {
        legacy.showOSMUnderlay = true;
      }
      parsed.settingsVersion = SETTINGS_VERSION;
      // Migrate boolean showOSMUnderlay → streetUnderlay mode
      if (!parsed.streetUnderlay && "showOSMUnderlay" in legacy) {
        parsed.streetUnderlay = legacy.showOSMUnderlay ? "auto" : "off";
      }
      delete legacy.showOSMUnderlay;
      // Migrate old updateRateHz → gpsRateMode + manualUpdateIntervalMs
      if ("updateRateHz" in legacy) {
        if (!parsed.gpsRateMode) {
          parsed.gpsRateMode = "adaptive";
          const hz = legacy.updateRateHz as number;
          parsed.manualUpdateIntervalMs = Math.round(1000 / Math.max(hz, 0.1));
        }
        delete legacy.updateRateHz;
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
