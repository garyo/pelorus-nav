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

import type {
  LayerSpecification,
  MapMouseEvent,
  SourceSpecification,
} from "maplibre-gl";
import type { ChartProvider } from "../chart/ChartProvider";
import type { FeatureInfo } from "../chart/feature-info";
import type { DataAsset } from "../data/chart-catalog";
import type { NavigationDataProvider } from "../navigation/NavigationData";
import type { LayerGroupDecl, Settings } from "../settings";

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
}

/** A pickable contribution: the host runs one ordered click dispatch. */
export interface PickableRegistration {
  /** Layer ids (as added via PluginMap) to hit-test. */
  layers: string[];
  /** Map a hit feature to popup content, or null to ignore it. */
  resolve(feature: import("maplibre-gl").MapGeoJSONFeature): FeatureInfo | null;
}

export interface PickingRegistrar {
  register(reg: PickableRegistration): void;
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
  readonly events: HostEvents;
  readonly settings: PluginSettings;
  log(msg: string): void;
}

// ── Internal picking contract (used by the host + core chart picker) ──────

/**
 * A single click responder. The PickingManager queries responders in
 * descending priority and lets the first that handles the click win,
 * dismissing the rest — guaranteeing one popup at a time.
 */
export interface MapPicker {
  /** Higher = checked first. Overlays above the chart use higher values. */
  readonly priority: number;
  /** Returns true if it showed something for this click. */
  tryPick(e: MapMouseEvent): boolean;
  /** Hide its popup / highlight. */
  dismiss(): void;
}

/** Compatible if the plugin's targeted major version matches the host's. */
export function isApiCompatible(pluginApiVersion: string): boolean {
  const hostMajor = PLUGIN_API_VERSION.split(".")[0];
  const pluginMajor = pluginApiVersion.split(".")[0];
  return hostMajor === pluginMajor;
}
