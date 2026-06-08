/**
 * PluginHost implementation: the scoped, capability-gated API surface handed
 * to each plugin's `activate`. Wraps the MapLibre map (namespaced + slot-aware
 * + tracked), bridges core settings/events, and routes overlay layers, chart/
 * nav providers, data assets, and pickables into the app's registries.
 */

import type maplibregl from "maplibre-gl";
import type { ChartManager } from "../chart/ChartManager";
import type { ChartProvider } from "../chart/ChartProvider";
import type { FeatureInfo } from "../chart/feature-info";
import { type DataAsset, registerDataAsset } from "../data/chart-catalog";
import type { NavigationDataProvider } from "../navigation/NavigationData";
import type { NavigationDataManager } from "../navigation/NavigationDataManager";
import {
  getPluginSetting,
  getSettings,
  isLayerGroupEnabled,
  onSettingsChange,
  registerLayerGroup,
  registerPluginSettingsSchema,
  type Settings,
  setPluginSetting,
} from "../settings";
import type { LegendHost } from "./legend";
import type { PickContributor, PickRegistry } from "./picking";
import { slotBeforeId } from "./slots";
import { createTileCacheProtocol } from "./tile-cache";
import type {
  Capability,
  MapOverlay,
  PickableRegistration,
  Plugin,
  PluginHost,
  PluginInstance,
  PluginMap,
  Slot,
} from "./types";

export interface HostDeps {
  map: maplibregl.Map;
  chartManager: ChartManager;
  navManager: NavigationDataManager;
  picks: PickRegistry;
  legends: LegendHost;
}

/** Per-plugin teardown handle returned by `createHost`. */
export interface ActivePlugin {
  instance: PluginInstance | void;
  deactivate(): void;
}

/** Namespaced, slot-aware, tracked wrapper over the MapLibre map. */
class HostMap implements PluginMap {
  readonly raw: maplibregl.Map;
  private readonly sourceIds = new Set<string>();
  private readonly layerIds = new Set<string>();

  constructor(raw: maplibregl.Map) {
    this.raw = raw;
  }

  /** Forget tracked ids after a style rebuild wiped them (before re-setup). */
  beginSetup(): void {
    this.sourceIds.clear();
    this.layerIds.clear();
  }

  addSource(id: string, source: maplibregl.SourceSpecification): void {
    if (!this.raw.getSource(id)) this.raw.addSource(id, source);
    this.sourceIds.add(id);
  }

  addLayer(layer: maplibregl.LayerSpecification, slot: Slot): void {
    if (this.raw.getLayer(layer.id)) this.raw.removeLayer(layer.id);
    const before = slotBeforeId(slot);
    this.raw.addLayer(layer, this.raw.getLayer(before) ? before : undefined);
    this.layerIds.add(layer.id);
  }

  removeLayer(id: string): void {
    if (this.raw.getLayer(id)) this.raw.removeLayer(id);
    this.layerIds.delete(id);
  }

  removeSource(id: string): void {
    if (this.raw.getSource(id)) this.raw.removeSource(id);
    this.sourceIds.delete(id);
  }

  hasSource(id: string): boolean {
    return !!this.raw.getSource(id);
  }

  /** Remove everything this plugin added (on deactivate). */
  teardown(): void {
    for (const id of this.layerIds) {
      if (this.raw.getLayer(id)) this.raw.removeLayer(id);
    }
    for (const id of this.sourceIds) {
      if (this.raw.getSource(id)) this.raw.removeSource(id);
    }
    this.layerIds.clear();
    this.sourceIds.clear();
  }
}

/** Activate one plugin, building its capability-scoped host. */
export function activatePlugin(plugin: Plugin, deps: HostDeps): ActivePlugin {
  const { manifest } = plugin;
  const granted = new Set<Capability>(manifest.capabilities);
  const cleanups: Array<() => void> = [];
  const hostMap = new HostMap(deps.map);

  // Declarative manifest contributions, registered before activate runs.
  for (const lg of manifest.layerGroups ?? []) registerLayerGroup(lg);
  for (const asset of manifest.dataAssets ?? []) registerDataAsset(asset);
  if (manifest.settingsSchema) {
    registerPluginSettingsSchema(
      manifest.id,
      manifest.name,
      manifest.settingsSchema,
      // Hide the settings section when the plugin's layer group is off.
      manifest.layerGroups?.[0]?.id,
    );
  }

  const require = (cap: Capability): void => {
    if (!granted.has(cap)) {
      throw new Error(
        `Plugin "${manifest.id}" used capability "${cap}" it did not declare`,
      );
    }
  };

  const host: PluginHost = {
    manifest,
    map: hostMap,

    overlays: {
      register(overlay: MapOverlay) {
        require("map.overlay");
        const runSetup = () => {
          hostMap.beginSetup();
          overlay.setup(hostMap);
          overlay.update?.();
        };
        deps.map.on("style.load", runSetup);
        cleanups.push(() => {
          deps.map.off("style.load", runSetup);
          overlay.destroy?.();
        });
        if (deps.map.isStyleLoaded()) runSetup();
      },
    },

    charts: {
      register(provider: ChartProvider) {
        require("chart.provider");
        deps.chartManager.registerProvider(provider);
      },
    },

    nav: {
      register(provider: NavigationDataProvider) {
        require("nav.provider");
        deps.navManager.registerProvider(provider);
      },
    },

    data: {
      register(asset: DataAsset) {
        registerDataAsset(asset);
      },
      registerTileCache(opts) {
        require("data.network");
        const handle = createTileCacheProtocol(opts);
        cleanups.push(() => handle.dispose());
        return handle;
      },
    },

    picking: {
      register(reg: PickableRegistration) {
        require("map.overlay");
        // Contribute candidates into the unified pick list; the chart query
        // handler merges and cycles through them with chart features.
        const contributor: PickContributor = {
          collect(point) {
            const live = reg.layers.filter((id) => deps.map.getLayer(id));
            if (live.length === 0) return [];
            const bbox: [maplibregl.PointLike, maplibregl.PointLike] = [
              [point.x - 10, point.y - 10],
              [point.x + 10, point.y + 10],
            ];
            const hits = deps.map.queryRenderedFeatures(bbox, { layers: live });
            const infos: FeatureInfo[] = [];
            const seen = new Set<string>();
            for (const hit of hits) {
              const info = reg.resolve(hit);
              if (!info) continue;
              const key = `${info.type}:${info.name ?? ""}`;
              if (seen.has(key)) continue;
              seen.add(key);
              infos.push(info);
            }
            return infos;
          },
        };
        cleanups.push(deps.picks.register(contributor));
      },
    },

    ui: {
      setLegend(spec) {
        deps.legends.set(manifest.id, spec);
      },
      setStatus(text) {
        deps.legends.setStatus(manifest.id, text);
      },
    },

    events: {
      onMapMove(fn, debounceMs = 0) {
        let timer: ReturnType<typeof setTimeout> | null = null;
        const handler = () => {
          if (debounceMs <= 0) {
            fn();
            return;
          }
          if (timer) clearTimeout(timer);
          timer = setTimeout(fn, debounceMs);
        };
        deps.map.on("moveend", handler);
        const off = () => {
          if (timer) clearTimeout(timer);
          deps.map.off("moveend", handler);
        };
        cleanups.push(off);
        return off;
      },
      onTimeTick(fn, intervalMs) {
        const id = setInterval(fn, intervalMs);
        const off = () => clearInterval(id);
        cleanups.push(off);
        return off;
      },
    },

    settings: {
      get(): Readonly<Settings> {
        return getSettings();
      },
      onChange(fn) {
        const off = onSettingsChange(fn);
        cleanups.push(off);
        return off;
      },
      isLayerGroupEnabled(groupId: string) {
        return isLayerGroupEnabled(groupId);
      },
      getOwn<T = unknown>(key: string): T | undefined {
        const stored = getPluginSetting<T>(manifest.id, key);
        if (stored !== undefined) return stored;
        const ctrl = manifest.settingsSchema?.find((c) => c.key === key);
        return ctrl?.default as T | undefined;
      },
      setOwn(key: string, value: unknown) {
        setPluginSetting(manifest.id, key, value);
      },
      onOwnChange(fn: () => void) {
        const off = onSettingsChange(() => fn());
        cleanups.push(off);
        return off;
      },
    },

    log(msg: string) {
      console.info(`[plugin ${manifest.id}] ${msg}`);
    },
  };

  const instance = plugin.activate(host);

  return {
    instance,
    deactivate() {
      (instance as PluginInstance | undefined)?.deactivate?.();
      for (const c of cleanups) c();
      hostMap.teardown();
      deps.legends.set(manifest.id, null);
      deps.legends.setStatus(manifest.id, null);
    },
  };
}
