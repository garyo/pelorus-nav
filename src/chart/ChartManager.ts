import maplibregl from "maplibre-gl";
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
    return {
      version: 8,
      sprite: `${window.location.origin}/sprites/nautical`,
      glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
      sources: {
        [provider.id]: provider.getSource(),
      },
      layers: provider.getLayers(),
    };
  }
}
