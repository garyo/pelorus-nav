import type maplibregl from "maplibre-gl";
import { getMode } from "../map/InteractionMode";
import type { ChartManager } from "./ChartManager";
import { FeatureInfoPanel } from "./FeatureInfoPanel";
import { formatFeatureInfo } from "./feature-info";

/** Layers in query priority order: nav aids, hazards, regulatory, terrain */
const INTERACTIVE_LAYERS = [
  "s57-boylat",
  "s57-boycar",
  "s57-boysaw",
  "s57-boyspp",
  "s57-boyisd",
  "s57-bcnlat",
  "s57-bcncar",
  "s57-lndmrk",
  "s57-lights",
  "s57-fogsig",
  "s57-wrecks",
  "s57-obstrn",
  "s57-obstrn-area",
  "s57-obstrn-line",
  "s57-uwtroc",
  "s57-resare",
  "s57-achare",
  "s57-ctnare",
  "s57-fairwy",
  "s57-tsslpt",
  "s57-pilpnt",
  "s57-morfac",
  "s57-cblsub",
  "s57-cblohd",
  "s57-cblare",
  "s57-pipare",
  "s57-pipsol",
  "s57-siltnk",
  "s57-siltnk-icon",
  "s57-hrbfac",
  "s57-ofsplf",
  "s57-berths-label",
  "s57-buisgl",
  "s57-seaare-label",
  "s57-lndare-point",
  "s57-lndare",
  "s57-soundg",
  "s57-slcons-label",
  "s57-buisgl-label",
  "s57-smcfac-label",
  "s57-buaare-label",
  "s57-lndrgn-label",
  "s57-lndelv-label",
  "s57-bridge",
  "s57-prcare",
  "s57-prcare-outline",
  "s57-pilbop",
  "s57-wattur",
  "s57-gatcon",
  "s57-damcon",
  "s57-tunnel",
  "s57-fshfac",
  "s57-dykcon",
  "s57-slotop",
  "s57-pylons",
  "s57-cranes",
  "s57-forstc",
  "s57-cgusta",
  "s57-hulkes",
  "s57-drydoc",
  "s57-drydoc-outline",
  "s57-runway",
  "s57-runway-outline",
  "s57-airare",
  "s57-airare-outline",
  "s57-fairwy-outline",
  "s57-achare-symbol",
];

interface QueriedFeature {
  sourceLayer: string;
  properties: Record<string, unknown>;
  geometry: GeoJSON.Geometry;
  lngLat?: { lng: number; lat: number };
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
    if (getMode() !== "query") return;

    const layers = this.getVisibleInteractiveLayers();
    if (layers.length === 0) {
      this.dismiss();
      return;
    }

    // Query at click point, plus a wider box for text-only layers (LNDMRK)
    const raw = this.map.queryRenderedFeatures(e.point, { layers });
    const bbox: [maplibregl.PointLike, maplibregl.PointLike] = [
      [e.point.x - 20, e.point.y - 20],
      [e.point.x + 20, e.point.y + 20],
    ];
    const labelLayers = layers.filter((id) => id.endsWith("-label"));
    if (labelLayers.length > 0) {
      const extra = this.map.queryRenderedFeatures(bbox, {
        layers: labelLayers,
      });
      for (const f of extra) {
        if (!raw.some((r) => r.id === f.id && r.layer.id === f.layer.id)) {
          raw.push(f);
        }
      }
    }

    const features = deduplicateFeatures(raw, layers);

    if (features.length === 0) {
      this.dismiss();
      return;
    }

    // Attach click coordinates to each feature
    const lngLat = { lng: e.lngLat.lng, lat: e.lngLat.lat };
    for (const f of features) {
      f.lngLat = lngLat;
    }

    // Transfer LNDMRK names to co-located LIGHTS that lack OBJNAM
    correlateLandmarkNames(features);

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
    if (!feature) return;
    const info = formatFeatureInfo(
      feature.sourceLayer,
      feature.properties,
      feature.lngLat,
    );
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

/**
 * Transfer OBJNAM from co-located LNDMRK features to LIGHTS/FOGSIG
 * that lack a name. S-57 stores names on the landmark, not the light.
 * The LNDMRK entry is kept because it carries useful attributes
 * (height, function, construction, conspicuous) not on the light.
 * Also removes featureless LNDARE entries.
 */
function correlateLandmarkNames(features: QueriedFeature[]): void {
  const lndmrkIdx = features.findIndex(
    (f) => f.sourceLayer === "LNDMRK" && f.properties.OBJNAM,
  );
  if (lndmrkIdx >= 0) {
    const lndmrkName = features[lndmrkIdx].properties.OBJNAM;
    for (const f of features) {
      if (
        (f.sourceLayer === "LIGHTS" || f.sourceLayer === "FOGSIG") &&
        !f.properties.OBJNAM
      ) {
        f.properties.OBJNAM = lndmrkName;
      }
    }
  }

  // Remove featureless LNDARE (just "Land Area" with no useful details)
  for (let i = features.length - 1; i >= 0; i--) {
    if (
      features[i].sourceLayer === "LNDARE" &&
      !features[i].properties.OBJNAM &&
      !features[i].properties.INFORM
    ) {
      features.splice(i, 1);
    }
  }
}

/** Fields to ignore when computing dedup key (internal/tile metadata). */
const DEDUP_IGNORE = new Set([
  "RCID",
  "PRIM",
  "GRUP",
  "OBJL",
  "RVER",
  "AGEN",
  "FIDN",
  "FIDS",
  "LNAM",
  "LNAM_REFS",
  "FFPT_RIND",
  "SORDAT",
  "SORIND",
  "SCAMIN",
  "SCAMAX",
  "SYMBOL",
]);

/** Build a stable key from user-visible properties for deduplication.
 *  Uses FIDN (S-57 feature ID) when available — same FIDN from different
 *  ENC cells is the same real-world feature. Falls back to visible props. */
function dedupKey(sourceLayer: string, props: Record<string, unknown>): string {
  // FIDN uniquely identifies an S-57 feature across overlapping cells
  if (props.FIDN != null) {
    return `${sourceLayer}:FIDN=${props.FIDN}`;
  }
  const visible: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if (!DEDUP_IGNORE.has(k) && v != null && v !== "") {
      visible[k] = v;
    }
  }
  return `${sourceLayer}:${JSON.stringify(visible)}`;
}

/** Deduplicate features by visible properties, keeping priority order. */
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
    const props = f.properties as Record<string, unknown>;
    const key = dedupKey(sourceLayer, props);
    if (seen.has(key)) continue;
    seen.add(key);

    result.push({
      sourceLayer,
      properties: props,
      geometry: f.geometry,
    });
  }

  return result;
}
