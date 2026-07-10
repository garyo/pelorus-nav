import maplibregl from "maplibre-gl";
import { regionsInView } from "../data/chart-catalog";
import { applySlotAnchors } from "../plugins/slots";
import type {
  ChartBlend,
  DepthUnit,
  DetailLevel,
  DisplayTheme,
  StreetUnderlayMode,
  SymbologyScheme,
} from "../settings";
import { getSettings, onSettingsChange } from "../settings";
import {
  getBasemapLayers,
  getBasemapSources,
  hasStoredBasemap,
} from "./basemap-underlay";
import type { ChartProvider } from "./ChartProvider";
import {
  applyOSMUnderlay,
  applyUnderlay,
  getOSMUnderlaySource,
} from "./osm-underlay";
import { getRasterChartLayers, getRasterChartSources } from "./raster-charts";
import { getIconScheme } from "./styles/icon-sets";

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
  private prevSymbology: SymbologyScheme;
  private prevStreetUnderlay: StreetUnderlayMode;
  private prevChartBlend: ChartBlend;
  private prevActiveRegion: string;
  private prevShallowDepth: number;
  private prevDeepDepth: number;
  private prevTextScale: number;
  private prevIconScale: number;
  /** Region ids whose layers are in the style as of the last build. */
  private lastRegionIds: string[] = [];

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
      attributionControl: false,
      // No label cross-fade: a chartplotter wants labels immediately, and
      // every fade frame is a full (~1 s) panel refresh on e-ink.
      fadeDuration: 0,
      // Dev only: keep the WebGL backbuffer readable so headless render
      // harnesses can capture the chart via getCanvas().toDataURL(). Disabled
      // in prod — preserving the buffer costs a copy each frame.
      canvasContextAttributes: import.meta.env.DEV
        ? { preserveDrawingBuffer: true }
        : undefined,
    });

    this.activeProviderId = initialId;

    this.map.addControl(new maplibregl.NavigationControl(), "top-right");
    this.map.addControl(
      new maplibregl.ScaleControl({ unit: "nautical" }),
      "bottom-left",
    );

    // Detect sprite loading failures and warn the user
    this.setupSpriteWarning();

    // When panning/zooming brings a different set of regions into view, rebuild
    // so their layers appear (and out-of-view ones drop). Cheap now that the
    // style only carries in-view regions; the set rarely changes, so most
    // moveends are a no-op equality check.
    this.map.on("moveend", () => {
      const ids = regionsInView(
        this.viewportBounds(),
        getSettings().activeRegion,
      );
      if (ids.join(",") !== this.lastRegionIds.join(",")) {
        this.throttledRefreshStyle();
      }
    });

    const initial = getSettings();
    this.prevDepthUnit = initial.depthUnit;
    this.prevDetailLevel = initial.detailLevel;
    this.prevLayerGroups = { ...initial.layerGroups };
    this.prevDisplayTheme = initial.displayTheme;
    this.prevSymbology = initial.symbologyScheme;
    this.prevStreetUnderlay = initial.streetUnderlay;
    this.prevChartBlend = initial.chartBlend;
    this.prevActiveRegion = initial.activeRegion;
    this.prevShallowDepth = initial.shallowDepth;
    this.prevDeepDepth = initial.deepDepth;
    this.prevTextScale = initial.textScale;
    this.prevIconScale = initial.iconScale;

    // Re-apply style only when chart-relevant settings change. Structural
    // changes (which layers exist, their geometry/colours) need a style rebuild;
    // a layer-group toggle alone only flips visibility, which is ~1000× cheaper.
    onSettingsChange(() => {
      const s = getSettings();
      const structuralChanged =
        s.depthUnit !== this.prevDepthUnit ||
        s.detailLevel !== this.prevDetailLevel ||
        s.displayTheme !== this.prevDisplayTheme ||
        s.symbologyScheme !== this.prevSymbology ||
        s.streetUnderlay !== this.prevStreetUnderlay ||
        s.chartBlend !== this.prevChartBlend ||
        s.activeRegion !== this.prevActiveRegion ||
        s.shallowDepth !== this.prevShallowDepth ||
        s.deepDepth !== this.prevDeepDepth ||
        s.textScale !== this.prevTextScale ||
        s.iconScale !== this.prevIconScale;
      const layersChanged =
        JSON.stringify(s.layerGroups) !== JSON.stringify(this.prevLayerGroups);

      if (structuralChanged) {
        this.prevDepthUnit = s.depthUnit;
        this.prevDetailLevel = s.detailLevel;
        this.prevLayerGroups = { ...s.layerGroups };
        this.prevDisplayTheme = s.displayTheme;
        this.prevSymbology = s.symbologyScheme;
        this.prevStreetUnderlay = s.streetUnderlay;
        this.prevChartBlend = s.chartBlend;
        this.prevActiveRegion = s.activeRegion;
        this.prevShallowDepth = s.shallowDepth;
        this.prevDeepDepth = s.deepDepth;
        this.prevTextScale = s.textScale;
        this.prevIconScale = s.iconScale;
        // A rebuild re-applies layer-group visibility too, so it subsumes
        // layersChanged.
        this.throttledRefreshStyle();
      } else if (layersChanged) {
        this.applyLayerGroupVisibility(this.prevLayerGroups, s.layerGroups);
        this.prevLayerGroups = { ...s.layerGroups };
      }
    });
  }

  /**
   * Flip `visibility` on the layers of any layer group whose toggle changed,
   * instead of rebuilding the whole style. Layers carry their group in
   * `metadata.group` (set by getNauticalLayers). Plugin overlays manage their
   * own group visibility, so their groups simply match no chart layers here.
   */
  private applyLayerGroupVisibility(
    prev: Record<string, boolean>,
    next: Record<string, boolean>,
  ): void {
    const changed = new Set<string>();
    for (const [group, on] of Object.entries(next)) {
      if (prev[group] !== on) changed.add(group);
    }
    if (changed.size === 0) return;
    for (const layer of this.map.getStyle().layers) {
      const group = (layer.metadata as { group?: string } | undefined)?.group;
      if (group && changed.has(group)) {
        this.map.setLayoutProperty(
          layer.id,
          "visibility",
          next[group] === false ? "none" : "visible",
        );
      }
    }
  }

  private refreshPending = false;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly REFRESH_THROTTLE_MS = 250;

  /** Throttle style rebuilds — fire immediately, then at most once per 250ms. */
  private throttledRefreshStyle(): void {
    if (!this.refreshTimer) {
      this.refreshStyle();
      this.refreshTimer = setTimeout(() => {
        this.refreshTimer = null;
        if (this.refreshPending) {
          this.refreshPending = false;
          this.refreshStyle();
        }
      }, ChartManager.REFRESH_THROTTLE_MS);
    } else {
      this.refreshPending = true;
    }
  }

  /** Re-apply the current provider's style (e.g. after settings change). */
  refreshStyle(): void {
    const provider = this.getActiveProvider();
    if (provider) {
      this.map.setStyle(this.buildStyle(provider), { diff: true });
    }
  }

  /** Current map viewport as [west, south, east, north]. */
  private viewportBounds(): [number, number, number, number] {
    const b = this.map.getBounds();
    return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
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

    // Use setStyle to replace the style. diff:false forces a full rebuild
    // since sources change across providers (e.g. different pmtiles:// URLs).
    const style = this.buildStyle(provider);
    const center = this.map.getCenter();
    const zoom = this.map.getZoom();
    const bearing = this.map.getBearing();
    const pitch = this.map.getPitch();
    this.map.setStyle(style, { diff: false });
    this.map.jumpTo({ center, zoom, bearing, pitch });
    this.activeProviderId = providerId;
  }

  /**
   * Show a warning banner when MapLibre can't find sprite images.
   * A burst of missing images right after style load usually means the
   * sprite sheet failed to load (e.g. offline / stale cache).
   */
  private setupSpriteWarning(): void {
    let missingCount = 0;
    let warningShown = false;
    let resetTimer: ReturnType<typeof setTimeout> | null = null;

    this.map.on("styleimagemissing", () => {
      missingCount++;
      // A few missing images can be normal; a burst means the sheet failed
      if (missingCount >= 5 && !warningShown) {
        warningShown = true;
        this.showWarningBanner(
          "Chart symbols could not be loaded — icons may appear incorrect. Check your network connection.",
        );
      }
    });

    // Reset counter after each style load so a fresh load gets a fresh check
    this.map.on("style.load", () => {
      missingCount = 0;
      warningShown = false;
      if (resetTimer) clearTimeout(resetTimer);
      // Allow a short window after style load for missing-image events
      resetTimer = setTimeout(() => {
        missingCount = 0;
      }, 5000);
    });
  }

  private showWarningBanner(message: string): void {
    const banner = document.createElement("div");
    banner.textContent = message;
    Object.assign(banner.style, {
      position: "fixed",
      top: "0",
      left: "0",
      right: "0",
      padding: "10px 16px",
      background: "#c44",
      color: "#fff",
      fontSize: "14px",
      textAlign: "center",
      zIndex: "9999",
      cursor: "pointer",
    });
    banner.title = "Click to dismiss";
    banner.addEventListener("click", () => banner.remove());
    document.body.appendChild(banner);
    // Auto-dismiss after 15 seconds
    setTimeout(() => banner.remove(), 15000);
  }

  private buildStyle(provider: ChartProvider): maplibregl.StyleSpecification {
    const settings = getSettings();
    const { sprite } = getIconScheme(
      settings.symbologyScheme,
      settings.displayTheme,
    );

    let sources: Record<string, maplibregl.SourceSpecification> = {
      ...provider.getSources(),
    };
    // Limit chart layers to the regions in view (active + viewport overlaps).
    // `this.map` is undefined during the initial build (it's the `style` arg of
    // the Map constructor) → no bounds → active region only.
    const regionIds = regionsInView(
      this.map ? this.viewportBounds() : null,
      settings.activeRegion,
    );
    this.lastRegionIds = regionIds;
    let layers = provider.getLayers(regionIds);

    // Composite raster charts (RNC) for vector providers — vector-preferred
    // quilt: the raster sits below the ENC area fills (so ENC wins where it has
    // cells) and shows through where ENC has no data (e.g. the BVI). The no-data
    // hatch is moved below the raster so it only shows where NEITHER covers.
    // "raster" blend puts the raster on top instead; "vector" hides it.
    if (provider.type === "vector" && settings.chartBlend !== "vector") {
      const rasterLayers = getRasterChartLayers();
      if (rasterLayers.length > 0) {
        sources = { ...sources, ...getRasterChartSources() };
        if (settings.chartBlend === "raster") {
          layers = [...layers, ...rasterLayers];
        } else {
          const hatch = layers.filter((l) => l.id === "s57-no-coverage");
          const rest = layers.filter((l) => l.id !== "s57-no-coverage");
          const bgIdx = rest.findIndex((l) => l.type === "background");
          const at = bgIdx >= 0 ? bgIdx + 1 : 0;
          layers = [
            ...rest.slice(0, at),
            ...hatch,
            ...rasterLayers,
            ...rest.slice(at),
          ];
        }
      }
    }

    // Merge street underlay for vector chart providers. "auto" prefers the
    // active region's offline vector basemap when downloaded; "osm" forces
    // the network OSM raster tiles.
    if (settings.streetUnderlay !== "off" && provider.type === "vector") {
      if (
        settings.streetUnderlay === "auto" &&
        hasStoredBasemap(settings.activeRegion)
      ) {
        sources = {
          ...sources,
          ...getBasemapSources(settings.activeRegion),
        };
        layers = applyUnderlay(
          layers,
          getBasemapLayers(settings.displayTheme),
          0.3,
        );
      } else {
        const osm = getOSMUnderlaySource();
        sources = { ...sources, [osm.id]: osm.source };
        layers = applyOSMUnderlay(layers, 0.3, settings.displayTheme);
      }
    }

    return {
      version: 8,
      sprite: `${window.location.origin}/sprites/${sprite}`,
      glyphs: "local-glyphs://{fontstack}/{range}",
      sources,
      // Invisible anchor layers demarcate the z-order bands plugin overlays
      // place into (see src/plugins/slots.ts).
      layers: applySlotAnchors(layers),
    };
  }

  /**
   * Register an additional chart provider at runtime (e.g. from a plugin).
   * Does not change the active provider; it becomes selectable in the UI.
   */
  registerProvider(provider: ChartProvider): void {
    this.providers.set(provider.id, provider);
  }
}
