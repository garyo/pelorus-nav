import type maplibregl from "maplibre-gl";
import { getMode } from "../map/InteractionMode";
import type { ChartManager } from "./ChartManager";
import { FeatureInfoPanel } from "./FeatureInfoPanel";
import { formatFeatureInfo } from "./feature-info";

/**
 * Interactive layer suffixes in query priority order.
 * Used to match multi-region prefixed layers (e.g. s57-new-england-boylat).
 */
const INTERACTIVE_SUFFIXES = [
  "-boylat",
  "-boycar",
  "-boysaw",
  "-boyspp",
  "-boyisd",
  "-bcnlat",
  "-bcncar",
  "-lndmrk",
  "-lights",
  "-fogsig",
  "-wrecks",
  "-obstrn",
  "-obstrn-area",
  "-obstrn-line",
  "-uwtroc",
  "-resare",
  "-achare",
  "-ctnare",
  "-fairwy",
  "-tsslpt",
  "-pilpnt",
  "-morfac",
  "-cblsub",
  "-cblohd",
  "-cblare",
  "-pipare",
  "-pipsol",
  "-siltnk",
  "-siltnk-icon",
  "-hrbfac",
  "-ofsplf",
  "-berths-label",
  "-buisgl",
  "-seaare-label",
  "-lndare-point",
  "-lndare",
  "-soundg",
  "-slcons-label",
  "-buisgl-label",
  "-smcfac-label",
  "-buaare-label",
  "-lndrgn-label",
  "-lndelv-label",
  "-bridge",
  "-prcare",
  "-prcare-outline",
  "-pilbop",
  "-wattur",
  "-gatcon",
  "-damcon",
  "-tunnel",
  "-fshfac",
  "-dykcon",
  "-slotop",
  "-pylons",
  "-cranes",
  "-forstc",
  "-forstc-outline",
  "-cgusta",
  "-hulkes",
  "-hulkes-outline",
  "-drydoc",
  "-drydoc-outline",
  "-runway",
  "-runway-outline",
  "-airare",
  "-airare-outline",
  "-fairwy-outline",
  "-achare-symbol",
];

/** Map suffix → priority rank for deduplication ordering. */
const SUFFIX_PRIORITY = new Map(INTERACTIVE_SUFFIXES.map((s, i) => [s, i]));

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
    return this.map
      .getStyle()
      .layers.map((l) => l.id)
      .filter(
        (id) =>
          id.startsWith("s57-") &&
          INTERACTIVE_SUFFIXES.some((s) => id.endsWith(s)),
      );
  }

  private handleClick(e: maplibregl.MapMouseEvent): void {
    if (getMode() !== "query") return;

    const layers = this.getVisibleInteractiveLayers();
    if (layers.length === 0) {
      this.dismiss();
      return;
    }

    // Query at click point for most layers, plus a wider bbox for thin
    // lines (bridges, cables, etc.) and text labels that are hard to tap.
    const raw = this.map.queryRenderedFeatures(e.point, { layers });
    const bbox: [maplibregl.PointLike, maplibregl.PointLike] = [
      [e.point.x - 10, e.point.y - 10],
      [e.point.x + 10, e.point.y + 10],
    ];
    // Use bbox for labels, outlines, and all line-type layers (thin targets)
    const looseLayers = layers.filter((id) => {
      if (id.endsWith("-label") || id.endsWith("-outline")) return true;
      const layer = this.map.getLayer(id);
      return layer?.type === "line";
    });
    if (looseLayers.length > 0) {
      const extra = this.map.queryRenderedFeatures(bbox, {
        layers: looseLayers,
      });
      for (const f of extra) {
        if (!raw.some((r) => r.id === f.id && r.layer.id === f.layer.id)) {
          raw.push(f);
        }
      }
    }

    const features = deduplicateFeatures(raw);

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

/**
 * Pick-relevance rank for a queried feature.
 *
 * Uses the MapLibre layer rendering type (not source geometry type)
 * so that e.g. a polygon rendered as a line outline still ranks as
 * an area feature. Outline layers (rendered as lines but representing
 * area boundaries) are demoted to area rank.
 */
function pickRank(f: maplibregl.MapGeoJSONFeature): number {
  const layerType = f.layer.type; // "circle" | "symbol" | "line" | "fill"
  const isOutline = f.layer.id.endsWith("-outline");
  if (layerType === "circle" || layerType === "symbol") return 0; // points
  if (layerType === "line" && !isOutline) return 1; // true lines
  // Background terrain (land, sea, depth areas) is almost never the target
  const src = (f.layer as Record<string, unknown>)["source-layer"] as
    | string
    | undefined;
  if (src === "LNDARE" || src === "SEAARE" || src === "DEPARE") return 3;
  return 2; // fills + outline strokes (area features)
}

/** Get priority rank for a layer ID based on its suffix. */
function layerPriority(layerId: string): number {
  for (const [suffix, rank] of SUFFIX_PRIORITY) {
    if (layerId.endsWith(suffix)) return rank;
  }
  return 999;
}

/**
 * Deduplicate features and sort by pick relevance.
 *
 * Sort order: geometry type (point > line > polygon), then by layer
 * priority index as a tiebreaker. This ensures specific features
 * (buoys, bridges) appear before large area features (fairways,
 * anchorages) that happen to contain the click point, while
 * co-located same-type features (e.g. lighthouse vs fog signal)
 * retain their intended layer priority order.
 */
function deduplicateFeatures(
  raw: maplibregl.MapGeoJSONFeature[],
): QueriedFeature[] {
  const seen = new Set<string>();
  const result: QueriedFeature[] = [];

  const sorted = [...raw].sort((a, b) => {
    const ra = pickRank(a);
    const rb = pickRank(b);
    if (ra !== rb) return ra - rb;
    const ai = layerPriority(a.layer.id);
    const bi = layerPriority(b.layer.id);
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
