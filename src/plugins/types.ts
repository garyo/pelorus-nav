/**
 * Public plugin SDK contract for Pelorus Nav.
 *
 * A plugin is metadata (`manifest`) plus an `activate(host)` function. The
 * `host` is the ONLY object a plugin may touch — it is the stable API boundary
 * and, in a later phase, the seam at which runtime-loaded plugins are sandboxed.
 *
 * This file is the frozen surface: changing it in a breaking way must bump
 * `PLUGIN_API_VERSION` (see `isApiCompatible`).
 */

import type { LayerSpecification, SourceSpecification } from "maplibre-gl";
import type { ChartProvider } from "../chart/ChartProvider";
import type { FeatureInfo } from "../chart/feature-info";
import type { DataAsset } from "../data/chart-catalog";
import type { NavigationDataProvider } from "../navigation/NavigationData";
import type { LayerGroupDecl, Settings, SettingsSchema } from "../settings";
import type { LegendSpec } from "./legend";
import type { TileCacheHandle, TileCacheOptions } from "./tile-cache";

/** SDK version. Bump the major on any breaking change to this contract. */
export const PLUGIN_API_VERSION = "1.0.0";

/** Things a plugin may ask to do; the host grants the matching host facets. */
export type Capability =
  | "map.overlay"
  | "chart.provider"
  | "nav.provider"
  | "data.network"
  | "data.files"
  | "settings";

/**
 * Named z-order bands a plugin layer can be placed into. The core owns the
 * critical chart ordering between these anchors; plugins may only place
 * relative to a band, never relative to an internal core layer id.
 * See `src/plugins/slots.ts`.
 */
export type Slot =
  | "overlay-low" // above soundings, below buoys/lights/labels (e.g. current arrows)
  | "overlay-data" // above all chart symbols, below nav (e.g. tide gauges, weather)
  | "overlay-nav" // routes / tracks / bearing lines
  | "vessel" // vessel marker + course line
  | "annotations"; // top: measurement, highlights, transient markers

export interface PluginManifest {
  /** Reverse-DNS unique id, e.g. "app.pelorus.tides". */
  id: string;
  name: string;
  version: string;
  /** SDK version this plugin was written against (semver). */
  apiVersion: string;
  description?: string;
  author?: string;
  /** Capabilities the plugin needs; build-time plugins are auto-granted. */
  capabilities: Capability[];
  /** Layer-group toggles the plugin contributes to the Layers settings tab. */
  layerGroups?: LayerGroupDecl[];
  /** Downloadable data assets surfaced in the Chart Regions panel. */
  dataAssets?: DataAsset[];
  /** Declarative settings controls the host renders for this plugin. */
  settingsSchema?: SettingsSchema;
}

export interface Plugin {
  manifest: PluginManifest;
  /** Wire the plugin up. Return an instance to receive teardown callbacks. */
  activate(host: PluginHost): PluginInstance | void;
}

export interface PluginInstance {
  /** Called when the plugin is disabled/torn down. */
  deactivate?(): void;
}

// ── Map overlay lifecycle ────────────────────────────────────────────────

/**
 * A map overlay managed by the host. `setup` is (re-)invoked on every
 * `style.load` (style rebuilds wipe imperatively-added layers), so it must be
 * idempotent and add all of its sources/layers through the supplied PluginMap.
 */
export interface MapOverlay {
  readonly id: string;
  setup(map: PluginMap): void;
  /** Refresh data after a map move / time tick / settings change. */
  update?(): void;
  /** Close any popup/transient UI (e.g. on idle auto-return). */
  onIdleClose?(): void;
  destroy?(): void;
}

/**
 * Namespaced, slot-aware wrapper over the MapLibre map handed to plugins.
 * `addLayer` places into a z-order band (never a raw beforeId); the host
 * tracks every added source/layer and tears them down on deactivate.
 */
export interface PluginMap {
  /** Add a source layer's layer into the given z-order band. */
  addLayer(layer: LayerSpecification, slot: Slot): void;
  addSource(id: string, source: SourceSpecification): void;
  removeLayer(id: string): void;
  removeSource(id: string): void;
  hasSource(id: string): boolean;
  /** Read-only access to the underlying map for queries (zoom, bounds, etc). */
  readonly raw: import("maplibre-gl").Map;
}

// ── Host facets ──────────────────────────────────────────────────────────

export interface OverlayRegistrar {
  register(overlay: MapOverlay): void;
}

export interface ChartRegistrar {
  register(provider: ChartProvider): void;
}

export interface NavRegistrar {
  register(provider: NavigationDataProvider): void;
}

export interface DataRegistrar {
  register(asset: DataAsset): void;
  /** Register a cached XYZ-tile protocol (offline tile caching). */
  registerTileCache(opts: TileCacheOptions): TileCacheHandle;
}

/**
 * A pickable contribution. The host hit-tests these layers at a clicked point
 * and merges the resolved infos into the chart query handler's single cyclable
 * feature-info list — so an overlay station never "eats" the click; the user
 * can scroll through it and any co-located chart feature.
 */
export interface PickableRegistration {
  /** Layer ids (as added via PluginMap) to hit-test. */
  layers: string[];
  /** Map a hit feature to popup content, or null to ignore it. */
  resolve(feature: import("maplibre-gl").MapGeoJSONFeature): FeatureInfo | null;
}

export interface PickingRegistrar {
  register(reg: PickableRegistration): void;
}

/** On-map chrome the host renders on the plugin's behalf (DOM-free plugins). */
/**
 * A top-bar action button contributed by a plugin — an icon + short label that
 * runs `onSelect` when tapped. Lets a plugin add an on-demand entry point (a
 * popup, a panel, a toggle) without owning any persistent map real estate.
 */
export interface PluginAction {
  /** Stable id, unique within the plugin (the host namespaces it). */
  id: string;
  /** Inline SVG markup for the icon (e.g. an export from `src/ui/icons`). */
  icon: string;
  /** Short uppercase label shown under the icon (e.g. "SUN"). */
  label: string;
  /** Tooltip / accessible name. */
  title: string;
  /** Longer descriptive label shown in the mobile overflow menu. */
  fullLabel?: string;
  /** Invoked when the button is activated. */
  onSelect(): void;
}

export interface PluginActionHandle {
  /** Toggle pressed/active styling (e.g. while the action's popup is open). */
  setActive(active: boolean): void;
  /** Remove the button. Also done automatically when the plugin deactivates. */
  remove(): void;
}

export interface UiRegistrar {
  /** Show/replace this plugin's map legend, or remove it with `null`. */
  setLegend(spec: LegendSpec | null): void;
  /** Show/replace a one-line status chip (e.g. "loading", "rate-limited"), or
   * clear it with `null`. For transient overlay state the user should see. */
  setStatus(text: string | null): void;
  /** Add a top-bar action button; the returned handle updates/removes it. */
  registerAction(action: PluginAction): PluginActionHandle;
}

export interface HostEvents {
  /** Debounced map-move (moveend) subscription. Returns an unsubscribe fn. */
  onMapMove(fn: () => void, debounceMs?: number): () => void;
  /** Periodic tick on a wall-clock interval. Returns an unsubscribe fn. */
  onTimeTick(fn: () => void, intervalMs: number): () => void;
}

export interface PluginSettings {
  /** Read core app settings (units, theme, symbology, scales, …). */
  get(): Readonly<Settings>;
  /** Subscribe to any core settings change. Returns an unsubscribe fn. */
  onChange(fn: (s: Readonly<Settings>) => void): () => void;
  /** Whether a layer-group toggle (core or plugin-registered) is enabled. */
  isLayerGroupEnabled(groupId: string): boolean;
  /** Read this plugin's own setting, falling back to its schema default. */
  getOwn<T = unknown>(key: string): T | undefined;
  /** Persist one of this plugin's own settings. */
  setOwn(key: string, value: unknown): void;
  /** Subscribe to changes (fires on any settings change; re-read with getOwn). */
  onOwnChange(fn: () => void): () => void;
}

/** The scoped API surface handed to a plugin's `activate`. */
export interface PluginHost {
  readonly manifest: PluginManifest;
  readonly map: PluginMap;
  readonly overlays: OverlayRegistrar;
  readonly charts: ChartRegistrar;
  readonly nav: NavRegistrar;
  readonly data: DataRegistrar;
  readonly picking: PickingRegistrar;
  readonly ui: UiRegistrar;
  readonly events: HostEvents;
  readonly settings: PluginSettings;
  log(msg: string): void;
}

/** Compatible if the plugin's targeted major version matches the host's. */
export function isApiCompatible(pluginApiVersion: string): boolean {
  const hostMajor = PLUGIN_API_VERSION.split(".")[0];
  const pluginMajor = pluginApiVersion.split(".")[0];
  return hostMajor === pluginMajor;
}
