import type { LayerSpecification, SourceSpecification } from "maplibre-gl";
import { CHART_REGIONS, type ChartRegion } from "../data/chart-catalog";
import { chartAssetBase } from "../data/remote-url";
import { getAuxFileURL } from "../data/tile-store";
import { getSettings } from "../settings";
import type { ChartProvider } from "./ChartProvider";
import { s52Colour } from "./s52-colours";
import { getNauticalLayers } from "./styles";

const UNIFIED_COVERAGE_SOURCE = "s57-coverage-unified";
export const UNIFIED_COVERAGE_FILENAME = "nautical-unified.coverage.geojson";

/**
 * Placeholder source id the shared layer template is generated against.
 * Every non-background layer's `source` is patched to a real region source
 * when the template is instantiated, so this id never reaches the style.
 */
const TEMPLATE_SOURCE = "s57-template";

/**
 * Zoom headroom kept below a layer's minzoom before it is pruned from the
 * style: a layer stays in the style from one zoom level before it first
 * renders, so a one-level zoom-in never waits on a style rebuild to show
 * newly-eligible layers.
 */
const PRUNE_ZOOM_MARGIN = 1;

/**
 * Highest zoom band at which pruning still removes anything. The largest
 * minzoom in the S-52 styles is 14, and a layer is pruned only while
 * band + PRUNE_ZOOM_MARGIN < minzoom, so every band from 13 up keeps the
 * full layer set. Clamping the band key here collapses those zooms into
 * one band — no rebuilds while zooming around at harbor scale.
 */
export const MAX_PRUNE_BAND = 13;

/**
 * Zoom band for layer pruning: floor(zoom) clamped to [0, MAX_PRUNE_BAND].
 * All minzooms in the styles are integers, so the pruned layer set is
 * constant within a band — ChartManager rebuilds the style only when the
 * band key changes (see recomputeRegionsInView).
 */
export function zoomBandKey(zoom: number): number {
  return Math.min(Math.max(Math.floor(zoom), 0), MAX_PRUNE_BAND);
}

/**
 * True when `layer` renders nothing anywhere in `zoom`'s band nor within
 * the margin above it: its effective minzoom (after getNauticalLayers'
 * detail-level raises) is beyond band + PRUNE_ZOOM_MARGIN. Layers without
 * a minzoom (background, area fills, coverage) are never pruned. Evaluated
 * against the band key, not the raw zoom, so the pruned set is identical
 * for every zoom within a band.
 */
export function isLayerPrunedAtZoom(
  layer: LayerSpecification,
  zoom: number,
): boolean {
  const minzoom = layer.minzoom;
  if (minzoom === undefined) return false;
  return minzoom > zoomBandKey(zoom) + PRUNE_ZOOM_MARGIN;
}

/**
 * Chart provider for S-57 ENC vector tiles in PMTiles format.
 * Renders ALL regions simultaneously — each region gets its own
 * vector source and prefixed layers. Regions are non-overlapping
 * geographically so layer interleave order doesn't matter.
 *
 * `activeRegionId` tracks which region the user is in (for UI purposes
 * like map center on manual region select), but does NOT affect rendering.
 */
export class VectorChartProvider implements ChartProvider {
  readonly id = "s57-vector";
  readonly name = "NOAA Vector Charts";
  readonly type = "vector" as const;
  readonly minZoom = 0;
  readonly maxZoom = 14;

  /** Region considered "active" for UI purposes (map center, settings). */
  private activeRegionId: string;
  /** Blob URL for unified coverage GeoJSON loaded from OPFS. */
  private unifiedCoverageBlobURL: string | null = null;
  /**
   * filename → remote version for regions that stream (not in OPFS).
   * Pins the tiles URL (?v=) so the HTTP cache never serves stale ranges.
   * Downloaded regions must NOT appear here — their plain URL has to keep
   * matching the OPFS-backed PMTiles protocol entry.
   */
  private streamingVersions: Record<string, string> = {};

  constructor(regionId?: string) {
    this.activeRegionId =
      CHART_REGIONS.find((r) => r.id === regionId)?.id ?? CHART_REGIONS[0].id;
  }

  /** Get the active region (for UI purposes like map center). */
  getRegion(): ChartRegion {
    return (
      CHART_REGIONS.find((r) => r.id === this.activeRegionId) ??
      CHART_REGIONS[0]
    );
  }

  /** Set the active region (for UI purposes). Returns true if changed. */
  setActiveRegion(regionId: string): boolean {
    if (regionId === this.activeRegionId) return false;
    if (!CHART_REGIONS.find((r) => r.id === regionId)) return false;
    this.activeRegionId = regionId;
    return true;
  }

  /** Set streaming-region versions. Call refreshStyle afterwards to apply. */
  setStreamingVersions(versions: Record<string, string>): void {
    this.streamingVersions = versions;
  }

  /**
   * Load unified coverage GeoJSON from OPFS.
   * Call at startup and after chart downloads change.
   */
  async loadAllOfflineCoverage(): Promise<void> {
    if (this.unifiedCoverageBlobURL) {
      URL.revokeObjectURL(this.unifiedCoverageBlobURL);
      this.unifiedCoverageBlobURL = null;
    }
    const url = await getAuxFileURL(UNIFIED_COVERAGE_FILENAME);
    if (url) {
      this.unifiedCoverageBlobURL = url;
    }
  }

  getSources(): Record<string, SourceSpecification> {
    const sources: Record<string, SourceSpecification> = {};

    for (const region of CHART_REGIONS) {
      sources[this.sourceIdFor(region.id)] = this.makeVectorSource(region);
    }

    sources[UNIFIED_COVERAGE_SOURCE] = {
      type: "geojson",
      data:
        this.unifiedCoverageBlobURL ??
        `${chartAssetBase()}/${UNIFIED_COVERAGE_FILENAME}`,
    };

    return sources;
  }

  getLayers(visibleRegionIds?: string[], zoom?: number): LayerSpecification[] {
    const {
      depthUnit,
      detailLevel,
      layerGroups,
      displayTheme,
      symbologyScheme,
      shallowDepth,
      safetyDepth,
      deepDepth,
      textScale,
      iconScale,
    } = getSettings();

    const allLayers: LayerSpecification[] = [];

    // Only emit layers for the regions actually in view (active + viewport
    // overlaps) — a smaller style is cheaper for MapLibre to diff and place.
    const regions = visibleRegionIds
      ? CHART_REGIONS.filter((r) => visibleRegionIds.includes(r.id))
      : CHART_REGIONS;

    // Generating a full S-52 layer set (style context, icon expressions,
    // per-layer expression trees) is the expensive part, and its output is
    // identical for every region except each layer's `source`. Build the
    // set ONCE against a placeholder source, then stamp out a cheap
    // shallow clone per region patching `source` and `id`. The clones
    // share nested layout/paint/filter objects — safe because
    // getNauticalLayers applies all its mutations (detail-level minzoom
    // overrides, group visibility) before returning, and downstream
    // consumers (underlay merging, MapLibre) never mutate layers in place.
    if (regions.length > 0) {
      // No per-region coverage source — we use a single unified one
      let template = getNauticalLayers({
        sourceId: TEMPLATE_SOURCE,
        depthUnit,
        detailOffset: detailLevel,
        layerGroups,
        theme: displayTheme,
        symbology: symbologyScheme,
        shallowDepth,
        safetyDepth,
        deepDepth,
        textScale,
        iconScale,
      });

      // Prune layers that can't render anywhere near this zoom, ONCE on the
      // template (whose minzooms already carry the detail-level raises),
      // before the per-region cloning multiplies them 16×. At whole-US zoom
      // this drops the large majority of layer definitions MapLibre would
      // otherwise diff and book-keep every frame for nothing.
      if (zoom !== undefined) {
        template = template.filter((l) => !isLayerPrunedAtZoom(l, zoom));
      }

      for (let i = 0; i < regions.length; i++) {
        const region = regions[i];
        const sourceId = this.sourceIdFor(region.id);

        // Prefix layer IDs: s57-xxx → s57-{regionId}-xxx
        // Strip background layer from all but the first region
        for (const layer of template) {
          if (layer.type === "background" && i > 0) continue;
          allLayers.push(layerForRegion(layer, region.id, sourceId));
        }
      }
    }

    // Draw order across regions: every region's fills/lines, then the
    // unified coverage mask, then every region's symbol layers. Regions own
    // disjoint tiles (tile-center ownership at z8+), so a label anchored
    // near a region boundary overflows into the neighbouring region's
    // tiles — its opaque fills must not paint later and chop the label
    // mid-glyph at the seam.
    const base = allLayers.filter((l) => l.type !== "symbol");
    const symbols = allLayers.filter((l) => l.type === "symbol");

    base.push({
      id: "s57-no-coverage",
      type: "fill" as const,
      source: UNIFIED_COVERAGE_SOURCE,
      paint: {
        "fill-color": s52Colour("NODTA"),
        "fill-opacity": 0.4,
      },
    });

    return [...base, ...symbols];
  }

  getAttribution(): string {
    return '&copy; <a href="https://nauticalcharts.noaa.gov">NOAA</a> ENC';
  }

  private sourceIdFor(regionId: string): string {
    return `s57-vector-${regionId}`;
  }

  private makeVectorSource(region: ChartRegion): SourceSpecification {
    const version = this.streamingVersions[region.filename];
    const query = version ? `?v=${encodeURIComponent(version)}` : "";
    const url = `${chartAssetBase()}/${region.filename}${query}`;
    return {
      type: "vector",
      tiles: [`pmtiles://${url}/{z}/{x}/{y}`],
      minzoom: this.minZoom,
      maxzoom: this.maxZoom,
      // Without bounds MapLibre requests this region's tiles across the
      // whole viewport — wasted fetches (and phantom failures when the
      // network is down) for every other in-style region.
      bounds: region.bbox,
      attribution: this.getAttribution(),
    };
  }
}

/**
 * Instantiate a template layer for a region: shallow-clone it with the ID
 * prefixed from `s57-xxx` to `s57-{regionId}-xxx` and `source` pointed at
 * the region's vector source. Background layers pass through unchanged
 * (they have no source; only one is emitted).
 */
function layerForRegion(
  layer: LayerSpecification,
  regionId: string,
  sourceId: string,
): LayerSpecification {
  if (layer.type === "background") return layer;
  return {
    ...layer,
    id: layer.id.replace(/^s57-/, `s57-${regionId}-`),
    source: sourceId,
  };
}
