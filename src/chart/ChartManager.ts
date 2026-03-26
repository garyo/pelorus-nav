import maplibregl from "maplibre-gl";
import type {
  DepthUnit,
  DetailLevel,
  DisplayTheme,
  SymbologyScheme,
} from "../settings";
import { getSettings, onSettingsChange } from "../settings";
import type { ChartProvider } from "./ChartProvider";
import { applyOSMUnderlay, getOSMUnderlaySource } from "./osm-underlay";
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
  private prevShowOSMUnderlay: boolean;
  private prevShallowDepth: number;
  private prevDeepDepth: number;
  private prevTextScale: number;
  private prevIconScale: number;

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
    });

    this.activeProviderId = initialId;

    this.map.addControl(new maplibregl.NavigationControl(), "top-right");
    this.map.addControl(
      new maplibregl.ScaleControl({ unit: "nautical" }),
      "bottom-left",
    );

    // Detect sprite loading failures and warn the user
    this.setupSpriteWarning();

    const initial = getSettings();
    this.prevDepthUnit = initial.depthUnit;
    this.prevDetailLevel = initial.detailLevel;
    this.prevLayerGroups = { ...initial.layerGroups };
    this.prevDisplayTheme = initial.displayTheme;
    this.prevSymbology = initial.symbologyScheme;
    this.prevShowOSMUnderlay = initial.showOSMUnderlay;
    this.prevShallowDepth = initial.shallowDepth;
    this.prevDeepDepth = initial.deepDepth;
    this.prevTextScale = initial.textScale;
    this.prevIconScale = initial.iconScale;

    // Re-apply style only when chart-relevant settings change
    onSettingsChange(() => {
      const s = getSettings();
      const layersChanged =
        JSON.stringify(s.layerGroups) !== JSON.stringify(this.prevLayerGroups);
      if (
        s.depthUnit !== this.prevDepthUnit ||
        s.detailLevel !== this.prevDetailLevel ||
        s.displayTheme !== this.prevDisplayTheme ||
        s.symbologyScheme !== this.prevSymbology ||
        s.showOSMUnderlay !== this.prevShowOSMUnderlay ||
        s.shallowDepth !== this.prevShallowDepth ||
        s.deepDepth !== this.prevDeepDepth ||
        s.textScale !== this.prevTextScale ||
        s.iconScale !== this.prevIconScale ||
        layersChanged
      ) {
        this.prevDepthUnit = s.depthUnit;
        this.prevDetailLevel = s.detailLevel;
        this.prevLayerGroups = { ...s.layerGroups };
        this.prevDisplayTheme = s.displayTheme;
        this.prevSymbology = s.symbologyScheme;
        this.prevShowOSMUnderlay = s.showOSMUnderlay;
        this.prevShallowDepth = s.shallowDepth;
        this.prevDeepDepth = s.deepDepth;
        this.prevTextScale = s.textScale;
        this.prevIconScale = s.iconScale;
        this.throttledRefreshStyle();
      }
    });
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
    let layers = provider.getLayers();

    // Merge OSM underlay for vector chart providers
    if (settings.showOSMUnderlay && provider.type === "vector") {
      const osm = getOSMUnderlaySource();
      sources = { ...sources, [osm.id]: osm.source };
      layers = applyOSMUnderlay(layers, 0.3, settings.displayTheme);
    }

    return {
      version: 8,
      sprite: `${window.location.origin}/sprites/${sprite}`,
      glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
      sources,
      layers,
    };
  }
}
