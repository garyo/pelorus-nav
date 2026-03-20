import type maplibregl from "maplibre-gl";
import { getMode } from "../map/InteractionMode";
import type { ChartManager } from "./ChartManager";
import { FeatureInfoPanel } from "./FeatureInfoPanel";
import { formatFeatureInfo } from "./feature-info";

/** Polygon source layers that commonly span tile boundaries.
 *  Highlight outlines are suppressed for these to avoid tile-edge artifacts. */
const TILE_SPANNING_LAYERS = new Set([
  "LNDARE",
  "DEPARE",
  "RESARE",
  "ACHARE",
  "CTNARE",
  "FAIRWY",
  "TSSLPT",
  "TSEZNE",
  "TWRTPT",
  "SEAARE",
  "CBLARE",
  "PIPARE",
  "DMPGRD",
  "PRCARE",
  "LAKARE",
  "RIVERS",
  "UNSARE",
  "DRGARE",
]);

/**
 * Interactive layer suffixes in query priority order.
 * Used to match multi-region prefixed layers (e.g. s57-northern-new-england-boylat).
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
  "-pilbop-outline",
  "-pilbop-label",
  "-pilbop-point",
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
  source: string;
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
  /** Track highlight layer IDs we've added so we can update/remove filters. */
  private highlightLayerIds: string[] = [];

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

    // Set up highlight layers after each style load
    this.map.on("style.load", () => this.setupHighlightLayers());
  }

  private getVisibleInteractiveLayers(): string[] {
    const style = this.map.getStyle();
    if (!style?.layers) return [];
    return style.layers
      .map((l) => l.id)
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

  /**
   * Reset highlight layers on style reload.
   */
  private setupHighlightLayers(): void {
    this.highlightLayerIds = [];
  }

  /**
   * Highlight a feature using filter-based layers that match by FIDN.
   * This highlights the full feature across all loaded tiles, not just
   * the clicked tile fragment.
   */
  private highlightFeature(feature: QueriedFeature): void {
    this.clearHighlight();

    const fidn = feature.properties.FIDN;
    if (fidn == null) return;

    const source = feature.source;
    const sourceLayer = feature.sourceLayer;

    // Soundings share a single FIDN per sounding group, so filter-based
    // highlighting would select every sounding in the area. Use a
    // temporary GeoJSON source with the exact clicked point instead.
    if (sourceLayer === "SOUNDG" && feature.geometry.type === "Point") {
      this.highlightPointGeometry(feature.geometry as GeoJSON.Point);
      return;
    }

    const fidnFilter = [
      "==",
      "FIDN",
      fidn,
    ] as unknown as maplibregl.FilterSpecification;

    const geomType = feature.geometry.type;
    const layerId = `_hl-${source}-${sourceLayer}`;

    // Only create the highlight layer type matching the feature's geometry
    if (geomType === "Polygon" || geomType === "MultiPolygon") {
      this.addHighlightLayer(layerId + "-fill", fidnFilter, {
        id: layerId + "-fill",
        type: "fill",
        source,
        "source-layer": sourceLayer,
        filter: fidnFilter,
        paint: {
          "fill-color": "#ff6600",
          "fill-opacity": 0.25,
        },
      });
      // Large-area layers span tile boundaries, so a line outline would
      // trace tile-clipped edges as visible straight lines. Only add the
      // outline for smaller polygon features (forts, buildings, etc.).
      if (!TILE_SPANNING_LAYERS.has(sourceLayer)) {
        this.addHighlightLayer(layerId + "-line", fidnFilter, {
          id: layerId + "-line",
          type: "line",
          source,
          "source-layer": sourceLayer,
          filter: fidnFilter,
          paint: {
            "line-color": "#ff6600",
            "line-width": 3,
            "line-opacity": 0.9,
          },
        });
      }
    } else if (geomType === "LineString" || geomType === "MultiLineString") {
      this.addHighlightLayer(layerId + "-line", fidnFilter, {
        id: layerId + "-line",
        type: "line",
        source,
        "source-layer": sourceLayer,
        filter: fidnFilter,
        paint: {
          "line-color": "#ff6600",
          "line-width": 3,
          "line-opacity": 0.9,
        },
      });
    } else {
      // Point / MultiPoint
      this.addHighlightLayer(layerId + "-circle", fidnFilter, {
        id: layerId + "-circle",
        type: "circle",
        source,
        "source-layer": sourceLayer,
        filter: fidnFilter,
        paint: {
          "circle-radius": 14,
          "circle-color": "transparent",
          "circle-stroke-color": "#ff6600",
          "circle-stroke-width": 3,
          "circle-stroke-opacity": 0.9,
        },
      });
    }
  }

  private addHighlightLayer(
    id: string,
    filter: maplibregl.FilterSpecification,
    spec: maplibregl.LayerSpecification,
  ): void {
    if (!this.map.getLayer(id)) {
      this.map.addLayer(spec);
    } else {
      this.map.setFilter(id, filter);
    }
    this.highlightLayerIds.push(id);
  }

  private static readonly HL_POINT_SOURCE = "_hl-point-src";
  private static readonly HL_POINT_LAYER = "_hl-point";

  /** Highlight a single point using a temporary GeoJSON source. */
  private highlightPointGeometry(point: GeoJSON.Point): void {
    const srcId = FeatureQueryHandler.HL_POINT_SOURCE;
    const layerId = FeatureQueryHandler.HL_POINT_LAYER;

    const geojson: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: point, properties: {} }],
    };

    if (this.map.getSource(srcId)) {
      (this.map.getSource(srcId) as maplibregl.GeoJSONSource).setData(geojson);
    } else {
      this.map.addSource(srcId, { type: "geojson", data: geojson });
    }

    if (!this.map.getLayer(layerId)) {
      this.map.addLayer({
        id: layerId,
        type: "circle",
        source: srcId,
        paint: {
          "circle-radius": 14,
          "circle-color": "transparent",
          "circle-stroke-color": "#ff6600",
          "circle-stroke-width": 3,
          "circle-stroke-opacity": 0.9,
        },
      });
    }
    this.highlightLayerIds.push(layerId);
  }

  private clearHighlight(): void {
    for (const layerId of this.highlightLayerIds) {
      if (this.map.getLayer(layerId)) {
        this.map.removeLayer(layerId);
      }
    }
    this.highlightLayerIds = [];
    // Clean up temporary point source
    const srcId = FeatureQueryHandler.HL_POINT_SOURCE;
    if (this.map.getSource(srcId)) {
      this.map.removeSource(srcId);
    }
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
  if (layerType === "circle" || layerType === "symbol") return 0; // points
  // Line layers rendering polygon geometry are area outlines, not true lines
  const geomType = f.geometry.type;
  const isAreaGeom = geomType === "Polygon" || geomType === "MultiPolygon";
  if (layerType === "line" && !isAreaGeom) return 1; // true lines
  return 2; // all area features (fills + area outlines)
}

/** Get priority rank for a layer ID based on its suffix. */
function layerPriority(layerId: string): number {
  for (const [suffix, rank] of SUFFIX_PRIORITY) {
    if (layerId.endsWith(suffix)) return rank;
  }
  return 999;
}

/**
 * Approximate feature size via bounding box area of the geometry.
 * Smaller features (islands, berths) sort before larger ones
 * (sea areas, restricted zones). Returns 0 for points.
 */
function bboxArea(f: maplibregl.MapGeoJSONFeature): number {
  const geom = f.geometry;
  if (geom.type === "Point" || geom.type === "MultiPoint") return 0;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const visit = (coords: number[]) => {
    if (coords[0] < minX) minX = coords[0];
    if (coords[1] < minY) minY = coords[1];
    if (coords[0] > maxX) maxX = coords[0];
    if (coords[1] > maxY) maxY = coords[1];
  };

  // Walk all coordinate arrays regardless of nesting depth
  const walk = (arr: unknown): void => {
    if (Array.isArray(arr) && arr.length >= 2 && typeof arr[0] === "number") {
      visit(arr as number[]);
    } else if (Array.isArray(arr)) {
      for (const item of arr) walk(item);
    }
  };
  walk((geom as GeoJSON.Geometry & { coordinates: unknown }).coordinates);

  if (!Number.isFinite(minX)) return 0;
  return (maxX - minX) * (maxY - minY);
}

/**
 * Deduplicate features and sort by pick relevance.
 *
 * Sort order: geometry type (point > line > polygon), then scale
 * (smaller/local features first via SCAMIN), then by layer
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
    // Within the same geometry rank, sort smaller features first
    const sa = bboxArea(a);
    const sb = bboxArea(b);
    if (sa !== sb) return sa - sb;
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
      source: f.source,
      sourceLayer,
      properties: props,
      geometry: f.geometry,
    });
  }

  return result;
}
