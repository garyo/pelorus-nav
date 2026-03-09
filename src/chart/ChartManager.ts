import maplibregl from "maplibre-gl";
import type { DepthUnit, DetailLevel, DisplayTheme } from "../settings";
import { getSettings, onSettingsChange } from "../settings";
import type { ChartProvider } from "./ChartProvider";

export interface ChartManagerOptions {
  container: string | HTMLElement;
  center: [number, number];
  zoom: number;
  providers: ChartProvider[];
  /** ID of the provider to activate initially. Defaults to first provider. */
  initialProviderId?: string;
}

/**
 * Manages the MapLibre map instance and chart provider switching.
 * Owns the map lifecycle and exposes it for other layers to use.
 */
export class ChartManager {
  readonly map: maplibregl.Map;

  private providers: Map<string, ChartProvider>;
  private activeProviderId: string | null = null;
  private prevDepthUnit: DepthUnit;
  private prevDetailLevel: DetailLevel;
  private prevLayerGroups: Record<string, boolean>;
  private prevDisplayTheme: DisplayTheme;

  constructor(options: ChartManagerOptions) {
    if (options.providers.length === 0) {
      throw new Error("ChartManager requires at least one provider");
    }

    this.providers = new Map(options.providers.map((p) => [p.id, p]));

    const initialId = options.initialProviderId ?? options.providers[0].id;
    const initialProvider = this.providers.get(initialId);
    if (!initialProvider) {
      throw new Error(`Provider "${initialId}" not found`);
    }

    // Build initial style from the first provider
    this.map = new maplibregl.Map({
      container: options.container,
      style: this.buildStyle(initialProvider),
      center: options.center,
      zoom: options.zoom,
    });

    this.activeProviderId = initialId;

    this.map.addControl(new maplibregl.NavigationControl(), "top-right");
    this.map.addControl(
      new maplibregl.ScaleControl({ unit: "nautical" }),
      "bottom-left",
    );

    const initial = getSettings();
    this.prevDepthUnit = initial.depthUnit;
    this.prevDetailLevel = initial.detailLevel;
    this.prevLayerGroups = { ...initial.layerGroups };
    this.prevDisplayTheme = initial.displayTheme;

    // Re-apply style only when chart-relevant settings change
    onSettingsChange(() => {
      const s = getSettings();
      const layersChanged =
        JSON.stringify(s.layerGroups) !== JSON.stringify(this.prevLayerGroups);
      if (
        s.depthUnit !== this.prevDepthUnit ||
        s.detailLevel !== this.prevDetailLevel ||
        s.displayTheme !== this.prevDisplayTheme ||
        layersChanged
      ) {
        this.prevDepthUnit = s.depthUnit;
        this.prevDetailLevel = s.detailLevel;
        this.prevLayerGroups = { ...s.layerGroups };
        this.prevDisplayTheme = s.displayTheme;
        this.refreshStyle();
      }
    });
  }

  /** Re-apply the current provider's style (e.g. after settings change). */
  refreshStyle(): void {
    const provider = this.getActiveProvider();
    if (provider) {
      this.map.setStyle(this.buildStyle(provider));
    }
  }

  /** Get the currently active provider, or null if none. */
  getActiveProvider(): ChartProvider | null {
    if (!this.activeProviderId) return null;
    return this.providers.get(this.activeProviderId) ?? null;
  }

  /** Get all registered provider IDs and names. */
  getProviders(): Array<{ id: string; name: string }> {
    return [...this.providers.values()].map((p) => ({
      id: p.id,
      name: p.name,
    }));
  }

  /** Switch to a different chart provider. */
  setActiveProvider(providerId: string): void {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new Error(`Provider "${providerId}" not found`);
    }
    if (providerId === this.activeProviderId) return;

    // Use setStyle to fully replace the style. This ensures custom protocols
    // (like pmtiles://) are resolved the same way as the initial style load.
    const style = this.buildStyle(provider);
    this.map.setStyle(style);
    this.activeProviderId = providerId;
  }

  private buildStyle(provider: ChartProvider): maplibregl.StyleSpecification {
    const extraSources = provider.getExtraSources?.() ?? {};
    return {
      version: 8,
      sprite: `${window.location.origin}/sprites/nautical`,
      glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
      sources: {
        [provider.id]: provider.getSource(),
        ...extraSources,
      },
      layers: provider.getLayers(),
    };
  }
}
