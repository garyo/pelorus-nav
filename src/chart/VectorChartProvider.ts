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

  getLayers(visibleRegionIds?: string[]): LayerSpecification[] {
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

    // Only build layers for the regions actually in view (active + viewport
    // overlaps). Generating all ~16 regions' full S-52 sets is the dominant
    // cost of every style rebuild; this keeps it to a handful.
    const regions = visibleRegionIds
      ? CHART_REGIONS.filter((r) => visibleRegionIds.includes(r.id))
      : CHART_REGIONS;

    for (let i = 0; i < regions.length; i++) {
      const region = regions[i];
      const sourceId = this.sourceIdFor(region.id);

      // No per-region coverage source — we use a single unified one
      const regionLayers = getNauticalLayers(
        sourceId,
        depthUnit,
        detailLevel,
        layerGroups,
        undefined, // no per-region coverage
        displayTheme,
        symbologyScheme,
        shallowDepth,
        safetyDepth,
        deepDepth,
        textScale,
        iconScale,
      );

      // Prefix layer IDs: s57-xxx → s57-{regionId}-xxx
      // Strip background layer from all but the first region
      for (const layer of regionLayers) {
        if (layer.type === "background" && i > 0) continue;
        allLayers.push(prefixLayerId(layer, region.id));
      }
    }

    // Single unified coverage mask on top of all regions
    allLayers.push({
      id: "s57-no-coverage",
      type: "fill" as const,
      source: UNIFIED_COVERAGE_SOURCE,
      paint: {
        "fill-color": s52Colour("NODTA"),
        "fill-opacity": 0.4,
      },
    });

    return allLayers;
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
      attribution: this.getAttribution(),
    };
  }
}

/**
 * Prefix a layer ID from `s57-xxx` to `s57-{regionId}-xxx`.
 * Background layers keep their original ID (only one is emitted).
 */
function prefixLayerId(
  layer: LayerSpecification,
  regionId: string,
): LayerSpecification {
  if (layer.type === "background") return layer;
  return {
    ...layer,
    id: layer.id.replace(/^s57-/, `s57-${regionId}-`),
  };
}
