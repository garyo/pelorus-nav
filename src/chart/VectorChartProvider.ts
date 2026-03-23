import type { LayerSpecification, SourceSpecification } from "maplibre-gl";
import { CHART_REGIONS, type ChartRegion } from "../data/chart-catalog";
import { chartAssetBase } from "../data/remote-url";
import { getAuxFileURL } from "../data/tile-store";
import { getSettings } from "../settings";
import type { ChartProvider } from "./ChartProvider";
import { s52Colour } from "./s52-colours";
import { getNauticalLayers } from "./styles";

const UNIFIED_COVERAGE_SOURCE = "s57-coverage-unified";
const UNIFIED_COVERAGE_FILENAME = "nautical-unified.coverage.geojson";

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

  /** Source for the first region, mapped to provider.id for ChartProvider compat. */
  getSource(): SourceSpecification {
    const region = CHART_REGIONS[0];
    return this.makeVectorSource(region);
  }

  /** All other region sources + unified coverage source. */
  getExtraSources(): Record<string, SourceSpecification> {
    const extra: Record<string, SourceSpecification> = {};

    // Additional region vector sources (skip first — it's the main source)
    for (let i = 1; i < CHART_REGIONS.length; i++) {
      const region = CHART_REGIONS[i];
      extra[this.sourceIdFor(region.id)] = this.makeVectorSource(region);
    }

    // Single unified coverage source (used by the one coverage mask layer)
    extra[UNIFIED_COVERAGE_SOURCE] = {
      type: "geojson",
      data:
        this.unifiedCoverageBlobURL ??
        `${chartAssetBase()}/${UNIFIED_COVERAGE_FILENAME}`,
    };

    return extra;
  }

  getLayers(): LayerSpecification[] {
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

    for (let i = 0; i < CHART_REGIONS.length; i++) {
      const region = CHART_REGIONS[i];
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

  /** Get the vector source ID for a given region. */
  private sourceIdFor(regionId: string): string {
    // First region uses provider.id for ChartProvider compat
    return regionId === CHART_REGIONS[0].id
      ? this.id
      : `s57-vector-${regionId}`;
  }

  private makeVectorSource(region: ChartRegion): SourceSpecification {
    return {
      type: "vector",
      tiles: [`pmtiles://${chartAssetBase()}/${region.filename}/{z}/{x}/{y}`],
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
