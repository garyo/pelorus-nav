/**
 * User settings persisted to localStorage.
 */
import { Capacitor } from "@capacitor/core";

export type DepthUnit = "meters" | "feet" | "fathoms";
export type SpeedUnit = "knots" | "mph" | "kph";
export type ChartMode = "follow" | "course-up" | "north-up" | "free";
export type DetailLevel = -1 | 0 | 1 | 2;
export type SimulatorMode = "replay" | "route" | "custom";
export type CourseLineDuration = 0 | "auto" | 5 | 15 | 30 | 60;
export type DisplayTheme = "day" | "dusk" | "night" | "eink";
export type BearingMode = "true" | "magnetic";
export type StreetUnderlayMode = "auto" | "osm" | "off";
/**
 * How raster charts (RNC) blend with vector ENC:
 * "auto" = vector-preferred quilt (ENC where it has cells, raster fills gaps);
 * "vector" = hide raster entirely; "raster" = raster on top of ENC.
 */
export type ChartBlend = "auto" | "vector" | "raster";
export type SymbologyScheme = "iho-s52";
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
  /** WebSocket URL of the Signal K server (used when gpsSource is "signalk"). */
  signalkUrl: string;
  gpsRateMode: GpsRateMode;
  manualUpdateIntervalMs: number;
  /** Adaptive filter strength — auto-detect jittery GPS, or force. */
  gpsFilterMode: GpsFilterMode;
  showAccuracyCircle: boolean;
  detailLevel: DetailLevel;
  layerGroups: Record<string, boolean>;
  /** Raster chart ids (catalog RNCs or imports) the user has hidden. */
  hiddenRasterCharts: string[];
  /** Route-manager folder names the user has collapsed (list-only). */
  collapsedRouteFolders: string[];
  showInstrumentHUD: boolean;
  /** Instrument HUD layout on landscape phones. */
  instrumentLayout: InstrumentLayout;
  instrumentCells: [string, string];
  trackRecordingEnabled: boolean;
  activeTrackColor: string;
  activeRegion: string;
  courseLineDuration: CourseLineDuration;
  simulatorSpeed: number;
  /** What the simulator plays: a real recorded sail, the synthetic route
   *  loop, or the user's own route named SIMULATOR ("custom"). */
  simulatorMode: SimulatorMode;
  displayTheme: DisplayTheme;
  symbologyScheme: SymbologyScheme;
  /** Arrival radius in NM — auto-advance route legs when closer than this. */
  arrivalRadiusNM: number;
  /** Planning speed (knots) for route pre-visualization ETAs. */
  routePlanSpeedKn: number;
  /** Show auto-detected maneuver markers in the track viewer. */
  trackShowManeuvers: boolean;
  /** Display bearings as true or magnetic. */
  bearingMode: BearingMode;
  /**
   * Street map underneath S-57 vector charts for land context.
   * "auto" = offline vector basemap when downloaded, else OSM raster;
   * "osm" = always OSM raster; "off" = chart only.
   */
  streetUnderlay: StreetUnderlayMode;
  /** How raster charts (RNC) blend with the vector ENC. */
  chartBlend: ChartBlend;
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
  /**
   * Use the device's volume keys for chart control (native only): single press
   * zooms in/out, and a "Lock screen" menu item locks the touchscreen (a volume
   * press unlocks). Off by default so the keys keep their normal volume
   * behaviour.
   */
  volumeKeyControls: boolean;
  /** Scale factor for chart text labels (1 = default). */
  textScale: number;
  /** Scale factor for chart icons (1 = default, multiplied with scheme/theme scale). */
  iconScale: number;
  /** Per-plugin settings namespace, keyed by plugin id. */
  plugins?: Record<string, Record<string, unknown>>;
}

const STORAGE_KEY = "pelorus-nav-settings";

export const LAYER_GROUP_LABELS: Record<string, string> = {
  routing: "Routing",
  restrictedAreas: "Restricted/Caution Areas",
  anchorage: "Anchorage",
  hazards: "Kelp, Overfalls & Fish Farms",
  cablesAndPipes: "Cables & Pipes",
  facilities: "Facilities",
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

// ── Plugin-owned settings (a per-plugin namespace + declarative UI schema) ──

/** A single control a plugin contributes to its settings section. */
export interface SettingControl {
  key: string;
  label: string;
  type: "slider" | "select" | "toggle" | "text";
  default?: unknown;
  /** slider */
  min?: number;
  max?: number;
  step?: number;
  /** slider value formatter */
  format?: (v: number) => string;
  /** select */
  options?: { value: string; label: string }[];
  /** text */
  placeholder?: string;
  /** text — render as a password field (e.g. API keys) */
  secret?: boolean;
}

export type SettingsSchema = SettingControl[];

/** Read a plugin's stored setting (no default applied — callers fall back). */
export function getPluginSetting<T = unknown>(
  pluginId: string,
  key: string,
): T | undefined {
  return current.plugins?.[pluginId]?.[key] as T | undefined;
}

/** Persist a plugin setting and notify listeners. */
export function setPluginSetting(
  pluginId: string,
  key: string,
  value: unknown,
): void {
  const plugins = { ...(current.plugins ?? {}) };
  plugins[pluginId] = { ...(plugins[pluginId] ?? {}), [key]: value };
  current = { ...current, plugins };
  save();
  notify();
}

interface PluginSettingsSection {
  pluginId: string;
  name: string;
  schema: SettingsSchema;
  /** Layer-group id that gates this section's visibility (hidden when off). */
  gate?: string;
}

const pluginSettingsSchemas: PluginSettingsSection[] = [];

/** Register a plugin's settings UI schema (rendered in the Layers tab). */
export function registerPluginSettingsSchema(
  pluginId: string,
  name: string,
  schema: SettingsSchema,
  gate?: string,
): void {
  if (!pluginSettingsSchemas.some((s) => s.pluginId === pluginId)) {
    pluginSettingsSchemas.push({ pluginId, name, schema, gate });
  }
}

export function getPluginSettingsSchemas(): readonly PluginSettingsSection[] {
  return pluginSettingsSchemas;
}

const SETTINGS_VERSION = 2;

const DEFAULTS: Settings = {
  settingsVersion: SETTINGS_VERSION,
  depthUnit: "feet",
  speedUnit: "knots",
  chartMode: "north-up",
  gpsSource: Capacitor.isNativePlatform() ? "capacitor-gps" : "none",
  signalkUrl: "ws://localhost:3000/signalk/v1/stream?subscribe=none",
  gpsRateMode: "adaptive",
  manualUpdateIntervalMs: 2000,
  gpsFilterMode: "auto",
  showAccuracyCircle: true,
  detailLevel: 0,
  layerGroups: { ...DEFAULT_LAYER_GROUPS },
  hiddenRasterCharts: [],
  collapsedRouteFolders: [],
  showInstrumentHUD: false,
  instrumentLayout: "side",
  instrumentCells: ["sog", "cog"],
  trackRecordingEnabled: false,
  activeTrackColor: "#ff4444",
  activeRegion: "northern-new-england",
  courseLineDuration: "auto",
  arrivalRadiusNM: 0.1,
  routePlanSpeedKn: 5,
  trackShowManeuvers: true,
  simulatorSpeed: 1,
  simulatorMode: "replay",
  displayTheme: "day",
  symbologyScheme: "iho-s52",
  bearingMode: "magnetic",
  streetUnderlay: "auto",
  chartBlend: "auto",
  shallowDepth: 1.83,
  safetyDepth: 6.1,
  deepDepth: 15.24,
  wakeLock: "when-nav",
  autoDimWhenIdle: false,
  autoReturnWhenIdle: true,
  volumeKeyControls: false,
  textScale: 1,
  iconScale: 1,
};

type SettingsListener = (settings: Settings) => void;

/**
 * Allowed values for keys whose type is a string/number literal union.
 * Loaded values outside this list (or of the wrong `typeof`) fall back to
 * the default for that key — see `sanitize()`.
 */
export const ALLOWED_VALUES: Partial<
  Record<keyof Settings, readonly unknown[]>
> = {
  depthUnit: ["meters", "feet", "fathoms"],
  speedUnit: ["knots", "mph", "kph"],
  chartMode: ["follow", "course-up", "north-up", "free"],
  gpsRateMode: ["adaptive", "manual"],
  gpsFilterMode: ["auto", "strong", "normal"],
  detailLevel: [-1, 0, 1, 2],
  simulatorMode: ["replay", "route", "custom"],
  courseLineDuration: [0, "auto", 5, 15, 30, 60],
  displayTheme: ["day", "dusk", "night", "eink"],
  symbologyScheme: ["iho-s52"],
  bearingMode: ["true", "magnetic"],
  streetUnderlay: ["auto", "osm", "off"],
  chartBlend: ["auto", "vector", "raster"],
  wakeLock: ["off", "when-nav", "always"],
  instrumentLayout: ["standard", "side"],
};

/** Structural keys with their own merge/validation, skipped by the generic pass. */
const STRUCTURAL_KEYS = new Set<keyof Settings>([
  "layerGroups",
  "instrumentCells",
  "hiddenRasterCharts",
  "collapsedRouteFolders",
  "plugins",
]);

function isValidPrimitive(key: keyof Settings, value: unknown): boolean {
  const allowed = ALLOWED_VALUES[key];
  if (allowed) return allowed.includes(value);
  if (typeof value !== typeof DEFAULTS[key]) return false;
  if (typeof value === "number" && !Number.isFinite(value)) return false;
  return true;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Strip any loaded key whose value doesn't match its default's type/range —
 * corrupted or hand-edited localStorage (`textScale: "big"`, `shallowDepth:
 * null`) falls back to the default for that key instead of flowing into
 * layer builders, slider math, and the HUD. Mutates `parsed` in place.
 */
function sanitize(parsed: Partial<Settings>): void {
  const rec = parsed as Record<string, unknown>;
  for (const key of Object.keys(DEFAULTS) as (keyof Settings)[]) {
    if (STRUCTURAL_KEYS.has(key)) continue;
    if (key in rec && !isValidPrimitive(key, rec[key])) {
      delete rec[key];
    }
  }
  if ("instrumentCells" in rec) {
    const cells = rec.instrumentCells;
    if (
      !Array.isArray(cells) ||
      cells.length !== 2 ||
      cells.some((c) => typeof c !== "string")
    ) {
      delete rec.instrumentCells;
    }
  }
  if ("layerGroups" in rec && !isPlainObject(rec.layerGroups)) {
    delete rec.layerGroups;
  }
  if ("hiddenRasterCharts" in rec) {
    const ids = rec.hiddenRasterCharts;
    if (!Array.isArray(ids) || ids.some((v) => typeof v !== "string")) {
      delete rec.hiddenRasterCharts;
    }
  }
  if ("collapsedRouteFolders" in rec) {
    const names = rec.collapsedRouteFolders;
    if (!Array.isArray(names) || names.some((v) => typeof v !== "string")) {
      delete rec.collapsedRouteFolders;
    }
  }
  if ("plugins" in rec && !isPlainObject(rec.plugins)) {
    delete rec.plugins;
  }
}

let current: Settings = load();
const listeners: SettingsListener[] = [];

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Settings>;
      const originalVersion = parsed.settingsVersion ?? 1;
      // Only IHO S-52 symbology is supported. Coerce any stored value
      // (incl. legacy "pelorus-standard"/"simplified-minimal") to the one scheme.
      parsed.symbologyScheme = "iho-s52";
      const legacy = parsed as Record<string, unknown>;
      // v2: street underlay became on-by-default, but only when the user
      // never set a preference — an explicit prior "off" must survive.
      if (originalVersion < 2 && !("showOSMUnderlay" in legacy)) {
        legacy.showOSMUnderlay = true;
      }
      parsed.settingsVersion = SETTINGS_VERSION;
      // Migrate boolean showOSMUnderlay → streetUnderlay mode
      if (!parsed.streetUnderlay && "showOSMUnderlay" in legacy) {
        parsed.streetUnderlay = legacy.showOSMUnderlay ? "auto" : "off";
      }
      delete legacy.showOSMUnderlay;
      // Migrate old updateRateHz → gpsRateMode + manualUpdateIntervalMs
      const hadUpdateRateHz = "updateRateHz" in legacy;
      if (hadUpdateRateHz) {
        if (!parsed.gpsRateMode) {
          parsed.gpsRateMode = "adaptive";
          const hz = legacy.updateRateHz as number;
          parsed.manualUpdateIntervalMs = Math.round(1000 / Math.max(hz, 0.1));
        }
        delete legacy.updateRateHz;
      }
      sanitize(parsed);
      const merged: Settings = {
        ...DEFAULTS,
        ...parsed,
        layerGroups: { ...DEFAULT_LAYER_GROUPS, ...parsed.layerGroups },
      };
      // Persist once so a v1→v2 (or updateRateHz) migration doesn't re-run
      // — and re-derive the same result — on every startup.
      if (originalVersion < SETTINGS_VERSION || hadUpdateRateHz) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      }
      return merged;
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
