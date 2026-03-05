import type maplibregl from "maplibre-gl";
import type { ChartManager } from "./ChartManager";
import { FeatureInfoPanel } from "./FeatureInfoPanel";
import { formatFeatureInfo } from "./feature-info";

/** Layers in query priority order: nav aids, hazards, regulatory, terrain */
const INTERACTIVE_LAYERS = [
  "s57-boylat",
  "s57-boysaw",
  "s57-boyspp",
  "s57-boyisd",
  "s57-bcnlat",
  "s57-lights",
  "s57-fogsig",
  "s57-wrecks",
  "s57-obstrn",
  "s57-uwtroc",
  "s57-resare",
  "s57-achare",
  "s57-ctnare",
  "s57-fairwy",
  "s57-tsslpt",
  "s57-pilpnt",
  "s57-berths-label",
  "s57-buisgl",
  "s57-seaare-label",
  "s57-lndare",
  "s57-soundg-circle",
];

interface QueriedFeature {
  sourceLayer: string;
  properties: Record<string, unknown>;
  geometry: GeoJSON.Geometry;
}

/**
 * Handles click/tap on map features and displays info in a panel.
 * Also manages hover cursor and feature highlighting.
 */
export class FeatureQueryHandler {
  private readonly panel: FeatureInfoPanel;
  private readonly map: maplibregl.Map;
  private currentFeatures: QueriedFeature[] = [];
  private currentIndex = 0;
  private highlightSourceId = "_feature-highlight";

  constructor(chartManager: ChartManager) {
    this.map = chartManager.map;

    // Create panel in map container
    const container = this.map.getContainer();
    this.panel = new FeatureInfoPanel(container);
    this.panel.onCycleNext = () => this.cycleNext();
    this.panel.onCyclePrev = () => this.cyclePrev();
    this.panel.onClose = () => this.dismiss();

    this.map.on("click", (e: maplibregl.MapMouseEvent) => this.handleClick(e));
    this.map.on("mousemove", (e: maplibregl.MapMouseEvent) =>
      this.handleMouseMove(e),
    );

    // Set up highlight source/layer after each style load
    this.map.on("style.load", () => this.setupHighlightLayer());
  }

  private getVisibleInteractiveLayers(): string[] {
    return INTERACTIVE_LAYERS.filter(
      (id) => this.map.getLayer(id) !== undefined,
    );
  }

  private handleClick(e: maplibregl.MapMouseEvent): void {
    const layers = this.getVisibleInteractiveLayers();
    if (layers.length === 0) {
      this.dismiss();
      return;
    }

    const raw = this.map.queryRenderedFeatures(e.point, { layers });
    const features = deduplicateFeatures(raw, layers);

    if (features.length === 0) {
      this.dismiss();
      return;
    }

    this.currentFeatures = features;
    this.currentIndex = 0;
    this.showCurrent();
  }

  private handleMouseMove(e: maplibregl.MapMouseEvent): void {
    const layers = this.getVisibleInteractiveLayers();
    if (layers.length === 0) {
      this.map.getCanvas().style.cursor = "";
      return;
    }

    const features = this.map.queryRenderedFeatures(e.point, { layers });
    this.map.getCanvas().style.cursor = features.length > 0 ? "pointer" : "";
  }

  private showCurrent(): void {
    const feature = this.currentFeatures[this.currentIndex];
    const info = formatFeatureInfo(feature.sourceLayer, feature.properties);
    this.panel.show(info, this.currentIndex, this.currentFeatures.length);
    this.highlightFeature(feature);
  }

  private cycleNext(): void {
    if (this.currentIndex >= this.currentFeatures.length - 1) return;
    this.currentIndex++;
    this.showCurrent();
  }

  private cyclePrev(): void {
    if (this.currentIndex <= 0) return;
    this.currentIndex--;
    this.showCurrent();
  }

  private dismiss(): void {
    this.panel.hide();
    this.currentFeatures = [];
    this.currentIndex = 0;
    this.clearHighlight();
  }

  private setupHighlightLayer(): void {
    if (this.map.getSource(this.highlightSourceId)) return;

    this.map.addSource(this.highlightSourceId, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });

    this.map.addLayer({
      id: "_feature-highlight-line",
      type: "line",
      source: this.highlightSourceId,
      paint: {
        "line-color": "#ff6600",
        "line-width": 3,
        "line-opacity": 0.9,
      },
    });

    this.map.addLayer({
      id: "_feature-highlight-circle",
      type: "circle",
      source: this.highlightSourceId,
      filter: ["==", "$type", "Point"],
      paint: {
        "circle-radius": 14,
        "circle-color": "transparent",
        "circle-stroke-color": "#ff6600",
        "circle-stroke-width": 3,
        "circle-stroke-opacity": 0.9,
      },
    });

    this.map.addLayer({
      id: "_feature-highlight-fill",
      type: "fill",
      source: this.highlightSourceId,
      filter: ["==", "$type", "Polygon"],
      paint: {
        "fill-color": "#ff6600",
        "fill-opacity": 0.15,
      },
    });
  }

  private highlightFeature(feature: QueriedFeature): void {
    const source = this.map.getSource(this.highlightSourceId) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (!source) return;

    source.setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: feature.geometry,
          properties: {},
        },
      ],
    });
  }

  private clearHighlight(): void {
    const source = this.map.getSource(this.highlightSourceId) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (!source) return;

    source.setData({ type: "FeatureCollection", features: [] });
  }
}

/** Deduplicate features by source-layer, keeping priority order. */
function deduplicateFeatures(
  raw: maplibregl.MapGeoJSONFeature[],
  priorityLayers: string[],
): QueriedFeature[] {
  const seen = new Set<string>();
  const result: QueriedFeature[] = [];

  // Sort by priority layer order
  const priorityIndex = new Map(priorityLayers.map((id, i) => [id, i]));
  const sorted = [...raw].sort((a, b) => {
    const ai = priorityIndex.get(a.layer.id) ?? 999;
    const bi = priorityIndex.get(b.layer.id) ?? 999;
    return ai - bi;
  });

  for (const f of sorted) {
    const sourceLayer = f.sourceLayer ?? f.layer.id;
    // Deduplicate by source-layer + feature ID or properties hash
    const key =
      f.id != null
        ? `${sourceLayer}:${f.id}`
        : `${sourceLayer}:${JSON.stringify(f.properties)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    result.push({
      sourceLayer,
      properties: f.properties as Record<string, unknown>,
      geometry: f.geometry,
    });
  }

  return result;
}
