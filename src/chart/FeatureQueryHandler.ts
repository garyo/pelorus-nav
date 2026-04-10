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
  "-bcnspp",
  "-lndmrk",
  "-lights",
  "-fogsig",
  "-wrecks",
  "-wrecks-isodgr",
  "-obstrn",
  "-obstrn-isodgr",
  "-obstrn-area",
  "-obstrn-line",
  "-uwtroc",
  "-uwtroc-isodgr",
  "-resare",
  "-achare",
  "-ctnare",
  "-ctnare-symbol",
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
  "-wattur-outline",
  "-gatcon",
  "-damcon",
  "-tunnel",
  "-fshfac",
  "-fshfac-line",
  "-dykcon",
  "-slotop",
  "-pylons",
  "-cranes",
  "-forstc",
  "-forstc-outline",
  "-cgusta",
  "-marcul",
  "-marcul-symbol",
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
  "-wedklp",
  "-wedklp-outline",
  "-mipare",
  "-ospare",
  "-tesare",
  "-exezne",
  "-istzne",
  "-istzne-outline",
  "-tssron",
  "-tssron-outline",
  "-feryrt",
  "-swpare",
  "-ovfall",
  "-sndwav",
  "-spring",
  "-curent",
  "-litflt",
  "-litves",
  "-rdocal",
  "-rscsta",
  "-sistat",
];

/** Map suffix → priority rank for deduplication ordering. */
const SUFFIX_PRIORITY = new Map(INTERACTIVE_SUFFIXES.map((s, i) => [s, i]));

/**
 * S-52 display category priority for sort ordering.
 * DISPLAYBASE (0) = safety-critical, STANDARD (1) = normal, OTHER (2) = detail.
 * Derived from S-52 Presentation Library display categories.
 */
const DISPLAY_CATEGORY_PRIORITY: Record<string, number> = {
  // DISPLAYBASE — safety-critical, always shown
  COALNE: 0,
  DEPARE: 0,
  DEPCNT: 0,
  LNDARE: 0,
  UNSARE: 0,
  SOUNDG: 0,
  UWTROC: 0,
  WRECKS: 0,
  OBSTRN: 0,
  ROCKAL: 0,
  // STANDARD — normal detail
  BOYLAT: 0, // Promote: buoys/beacons are nav-critical aids
  BOYCAR: 0,
  BOYSAW: 0,
  BOYSPP: 0,
  BOYISD: 0,
  BCNLAT: 0,
  BCNCAR: 0,
  BCNSPP: 0,
  LIGHTS: 1,
  FOGSIG: 1,
  LNDMRK: 0, // Promote: lighthouses/towers are nav-critical
  RESARE: 1,
  ACHARE: 1,
  TSSLPT: 1,
  FAIRWY: 1,
  CTNARE: 1,
  SEAARE: 1,
  DRGARE: 1,
  LAKARE: 1,
  RIVERS: 1,
  SLCONS: 1,
  BRIDGE: 1,
  CBLOHD: 1,
  CBLSUB: 1,
  NAVLNE: 1,
  RECTRC: 1,
  DWRTCL: 1,
  TSSBND: 1,
  TSEZNE: 1,
  TWRTPT: 1,
  ACHBRT: 1,
  LNDRGN: 1,
  LNDELV: 1,
  BUAARE: 1,
  PRCARE: 1,
  PILBOP: 1,
  WATTUR: 1,
  GATCON: 1,
  DAMCON: 1,
  TUNNEL: 1,
  FSHFAC: 1,
  MARCUL: 1,
  WEDKLP: 1,
  MIPARE: 1,
  OSPARE: 1,
  TESARE: 2,
  EXEZNE: 2,
  ISTZNE: 1,
  TSSRON: 1,
  FERYRT: 1,
  SWPARE: 1,
  OVFALL: 1,
  SNDWAV: 1,
  SPRING: 2,
  CURENT: 1,
  LITFLT: 0,
  LITVES: 0,
  RDOCAL: 2,
  RSCSTA: 2,
  SISTAT: 2,
  DYKCON: 1,
  SLOTOP: 1,
  PYLONS: 1,
  HULKES: 1,
  // OTHER — full detail
  SMCFAC: 2,
  BUISGL: 2,
  BERTHS: 2,
  PILPNT: 2,
  MORFAC: 2,
  PONTON: 2,
  DAYMAR: 2,
  TOPMAR: 2,
  SBDARE: 2,
  HRBFAC: 2,
  CBLARE: 2,
  PIPARE: 2,
  PIPSOL: 2,
  DMPGRD: 2,
  OFSPLF: 2,
  MAGVAR: 2,
  CRANES: 2,
  FORSTC: 2,
  CGUSTA: 2,
  DRYDOC: 2,
  RUNWAY: 2,
  AIRARE: 2,
};

interface QueriedFeature {
  source: string;
  sourceLayer: string;
  properties: Record<string, unknown>;
  geometry: GeoJSON.Geometry;
  lngLat?: { lng: number; lat: number };
  /** Slave features grouped under this master by LNAM relationships. */
  children?: QueriedFeature[];
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

    // Set up highlight layers after each style load and invalidate layer cache
    this.map.on("style.load", () => {
      this.cachedInteractiveLayers = null;
      this.setupHighlightLayers();
    });
  }

  private cachedInteractiveLayers: string[] | null = null;

  private getVisibleInteractiveLayers(): string[] {
    if (this.cachedInteractiveLayers) return this.cachedInteractiveLayers;
    const style = this.map.getStyle();
    if (!style?.layers) return [];
    this.cachedInteractiveLayers = style.layers
      .map((l) => l.id)
      .filter(
        (id) =>
          id.startsWith("s57-") &&
          INTERACTIVE_SUFFIXES.some((s) => id.endsWith(s)),
      );
    return this.cachedInteractiveLayers;
  }

  private handleClick(e: maplibregl.MapMouseEvent): void {
    if (getMode() !== "query") return;

    const layers = this.getVisibleInteractiveLayers();
    if (layers.length === 0) {
      this.dismiss();
      return;
    }

    // Query with a bbox to catch small icons, thin lines, and labels
    // that are hard to tap precisely.
    const bbox: [maplibregl.PointLike, maplibregl.PointLike] = [
      [e.point.x - 10, e.point.y - 10],
      [e.point.x + 10, e.point.y + 10],
    ];
    const raw = this.map.queryRenderedFeatures(bbox, { layers });

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

    // Group slave features (lights, fog signals, topmarks) under their masters
    const grouped = groupSlaveFeatures(features);

    this.currentFeatures = grouped;
    this.currentIndex = 0;
    this.showCurrent();
  }

  // No mousemove handler — the CSS crosshair cursor (!important) overrides
  // any cursor changes, so querying features on every mouse move was wasted work.

  private showCurrent(): void {
    const feature = this.currentFeatures[this.currentIndex];
    if (!feature) return;
    const info = formatFeatureInfo(
      feature.sourceLayer,
      feature.properties,
      feature.lngLat,
      feature.geometry.type,
    );
    // Attach formatted children from grouped slave features, deduped by display text
    const children = feature.children;
    if (children && children.length > 0) {
      const seen = new Set<string>();
      info.children = [];
      for (const child of children) {
        const childInfo = formatFeatureInfo(
          child.sourceLayer,
          child.properties,
          child.lngLat,
          child.geometry.type,
        );
        const key = `${childInfo.type}:${childInfo.name ?? ""}:${childInfo.details.map((d) => `${d.label}=${d.value}`).join(",")}`;
        if (seen.has(key)) continue;
        seen.add(key);
        info.children.push(childInfo);
      }
      // Suppress child Position rows that are identical to the parent's
      const parentPos = info.details.find((d) => d.label === "Position");
      if (parentPos) {
        for (const child of info.children) {
          child.details = child.details.filter(
            (d) => d.label !== "Position" || d.value !== parentPos.value,
          );
        }
      }
    }
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

/** Source layers that are typically slaves (equipment on an aid to navigation). */
const SLAVE_LAYERS = new Set(["LIGHTS", "FOGSIG", "TOPMAR", "DAYMAR"]);

/** Source layers that can act as masters (physical aids to navigation). */
const MASTER_LAYERS = new Set([
  "BOYLAT",
  "BOYCAR",
  "BOYSAW",
  "BOYSPP",
  "BOYISD",
  "BCNLAT",
  "BCNCAR",
  "BCNSPP",
  "LNDMRK",
  "OFSPLF",
  "PILPNT",
  "MORFAC",
]);

/**
 * Get the centroid coordinates of a feature for spatial co-location matching.
 * Returns [lng, lat] for Point geometries, undefined otherwise.
 */
function pointCoords(f: QueriedFeature): [number, number] | undefined {
  if (f.geometry.type === "Point") {
    const coords = (f.geometry as GeoJSON.Point).coordinates;
    return [coords[0], coords[1]];
  }
  return undefined;
}

/**
 * Group slave features under their master using LNAM relationships.
 *
 * 1. Build a map of LNAM → feature index for all picked features.
 * 2. For each feature with LNAM_REFS, find referenced features in the picked set.
 *    If FFPT_RIND indicates slave (2), attach them as children.
 * 3. Spatial fallback: if LNAM_REFS is absent, group LIGHTS/FOGSIG/TOPMAR/DAYMAR
 *    that share exact coordinates with a buoy/beacon/landmark.
 * 4. Remove grouped slaves from the top-level list.
 */
function groupSlaveFeatures(features: QueriedFeature[]): QueriedFeature[] {
  // Build LNAM index: LNAM value → index in features array
  const lnamIndex = new Map<string, number>();
  for (let i = 0; i < features.length; i++) {
    const lnam = features[i].properties.LNAM;
    if (typeof lnam === "string" && lnam.length > 0) {
      lnamIndex.set(lnam, i);
    }
  }

  // Track which feature indices have been claimed as children
  const claimed = new Set<number>();

  // Phase 1: LNAM_REFS-based grouping
  for (let i = 0; i < features.length; i++) {
    const master = features[i];
    const lnamRefs = master.properties.LNAM_REFS;
    if (typeof lnamRefs !== "string" || lnamRefs.length === 0) continue;

    const ffptRind = master.properties.FFPT_RIND;
    const rindValues = typeof ffptRind === "string" ? ffptRind.split(",") : [];

    const refs = lnamRefs.split(",");
    for (let r = 0; r < refs.length; r++) {
      const refLnam = refs[r].trim();
      if (!refLnam) continue;

      // Only group if relationship is slave (FFPT_RIND=2) or if RIND is absent
      const rind = rindValues[r]?.trim();
      if (rind && rind !== "2") continue;

      const slaveIdx = lnamIndex.get(refLnam);
      if (slaveIdx == null || slaveIdx === i || claimed.has(slaveIdx)) continue;

      // Only group slave-type layers under master-type layers
      const slave = features[slaveIdx];
      if (!SLAVE_LAYERS.has(slave.sourceLayer)) continue;

      if (!master.children) master.children = [];
      master.children.push(slave);
      claimed.add(slaveIdx);
    }
  }

  // Phase 2: Spatial co-location fallback for ungrouped slave-type features
  for (let i = 0; i < features.length; i++) {
    if (claimed.has(i)) continue;
    const f = features[i];
    if (!SLAVE_LAYERS.has(f.sourceLayer)) continue;

    const slaveCoords = pointCoords(f);
    if (!slaveCoords) continue;

    // Find a co-located master
    for (let j = 0; j < features.length; j++) {
      if (j === i || claimed.has(j)) continue;
      const candidate = features[j];
      if (!MASTER_LAYERS.has(candidate.sourceLayer)) continue;

      const masterCoords = pointCoords(candidate);
      if (!masterCoords) continue;
      if (
        masterCoords[0] === slaveCoords[0] &&
        masterCoords[1] === slaveCoords[1]
      ) {
        if (!candidate.children) candidate.children = [];
        candidate.children.push(f);
        claimed.add(i);
        break;
      }
    }
  }

  // Deduplicate children (overlapping scale-4/5 cells produce duplicates)
  for (const f of features) {
    if (f.children && f.children.length > 1) {
      const seen = new Set<string>();
      f.children = f.children.filter((child) => {
        const key = childDedupKey(child);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
  }

  // Sort children: lights first, then fog signals last
  for (const f of features) {
    if (f.children && f.children.length > 1) {
      f.children.sort((a, b) => childSortRank(a) - childSortRank(b));
    }
  }

  // Remove claimed slaves from top-level list
  return features.filter((_, i) => !claimed.has(i));
}

/** Dedup key for child features — ignores cell-specific fields. */
function childDedupKey(f: QueriedFeature): string {
  const p = f.properties;
  if (f.sourceLayer === "LIGHTS") {
    return `LIGHTS:${p.LITCHR ?? ""}:${p.COLOUR ?? ""}:${p.SIGPER ?? ""}:${p.SIGGRP ?? ""}:${p.SECTR1 ?? ""}:${p.SECTR2 ?? ""}`;
  }
  if (f.sourceLayer === "FOGSIG") {
    return `FOGSIG:${p.CATFOG ?? ""}:${p.SIGGRP ?? ""}:${p.SIGPER ?? ""}`;
  }
  // Generic: use source layer + OBJNAM or formatted key properties
  return `${f.sourceLayer}:${p.OBJNAM ?? ""}:${p.FIDN ?? Math.random()}`;
}

/** Sort rank for child features: lights by sector, then fog signals last. */
function childSortRank(f: QueriedFeature): number {
  if (f.sourceLayer === "LIGHTS") {
    // Unsectored lights first (no SECTR1), then sectored by sector start
    const sectr1 = f.properties.SECTR1;
    if (sectr1 == null) return 0;
    return 1 + Number(sectr1);
  }
  if (f.sourceLayer === "TOPMAR" || f.sourceLayer === "DAYMAR") return 500;
  if (f.sourceLayer === "FOGSIG") return 1000;
  return 100;
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

  // Remove featureless LNDARE polygons (just "Land Area" with no useful details).
  // Keep LNDARE points — they represent islets and rocks that are navigational features.
  for (let i = features.length - 1; i >= 0; i--) {
    if (
      features[i].sourceLayer === "LNDARE" &&
      features[i].geometry.type !== "Point" &&
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
  // Pipeline-added internal fields
  "_cell_id",
  "_scale_band",
  "_disp_cat",
  "_disp_pri",
  "_enclosing_depth",
  "LABEL",
]);

/**
 * Build dedup keys from both FIDN and visible properties.
 * Returns multiple keys — a feature is duplicate if ANY key was already seen.
 * This catches both same-FIDN duplicates (same cell, different render layers)
 * and cross-cell duplicates (different FIDNs for the same real-world feature).
 */
function dedupKeys(
  sourceLayer: string,
  props: Record<string, unknown>,
): string[] {
  const keys: string[] = [];
  if (props.FIDN != null) {
    keys.push(`${sourceLayer}:FIDN=${props.FIDN}`);
  }
  // Content-based key from user-visible properties (catches cross-cell dups)
  const visible: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if (!DEDUP_IGNORE.has(k) && v != null && v !== "") {
      visible[k] = v;
    }
  }
  keys.push(`${sourceLayer}:${JSON.stringify(visible)}`);
  return keys;
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

/** Get display category priority (0=DISPLAYBASE, 1=STANDARD, 2=OTHER) for a source layer. */
function displayCategoryRank(sourceLayer: string): number {
  return DISPLAY_CATEGORY_PRIORITY[sourceLayer] ?? 2;
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
 * Sort order: display category (DISPLAYBASE > STANDARD > OTHER),
 * then geometry type (point > line > polygon), then bbox area
 * (smaller first), then by layer priority index as a tiebreaker.
 * This ensures safety-critical features appear first, specific
 * features (buoys, bridges) appear before large area features,
 * and co-located same-type features retain their intended order.
 */
function deduplicateFeatures(
  raw: maplibregl.MapGeoJSONFeature[],
): QueriedFeature[] {
  const seen = new Set<string>();
  const result: QueriedFeature[] = [];

  const sorted = [...raw].sort((a, b) => {
    // Display category: DISPLAYBASE (0) before STANDARD (1) before OTHER (2)
    const da = displayCategoryRank(a.sourceLayer ?? a.layer.id);
    const db = displayCategoryRank(b.sourceLayer ?? b.layer.id);
    if (da !== db) return da - db;
    // Geometry type: points before lines before areas
    const ra = pickRank(a);
    const rb = pickRank(b);
    if (ra !== rb) return ra - rb;
    // Named features (OBJNAM) before anonymous ones
    const na = a.properties.OBJNAM ? 0 : 1;
    const nb = b.properties.OBJNAM ? 0 : 1;
    if (na !== nb) return na - nb;
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
    const keys = dedupKeys(sourceLayer, props);
    if (keys.some((k) => seen.has(k))) continue;
    for (const k of keys) seen.add(k);

    result.push({
      source: f.source,
      sourceLayer,
      properties: props,
      geometry: f.geometry,
    });
  }

  return result;
}
