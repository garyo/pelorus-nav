import type { LayerSpecification, SourceSpecification } from "maplibre-gl";
import { CHART_REGIONS, type ChartRegion } from "../data/chart-catalog";
import { getAuxFileURL } from "../data/tile-store";
import { getSettings } from "../settings";
import type { ChartProvider } from "./ChartProvider";
import { getNauticalLayers } from "./styles";

const SOURCE_ID = "s57-vector";
const COVERAGE_SOURCE_ID = "s57-coverage";

/**
 * Chart provider for S-57 ENC vector tiles in PMTiles format.
 * Tiles are generated offline by the tools/s57-pipeline/ tool.
 *
 * Supports switching between regions via setRegion(). Each region
 * has its own PMTiles file and coverage GeoJSON, served from R2
 * or loaded from OPFS for offline use.
 */
export class VectorChartProvider implements ChartProvider {
  readonly id = "s57-vector";
  readonly name = "NOAA Vector Charts";
  readonly type = "vector" as const;
  readonly minZoom = 0;
  readonly maxZoom = 14;

  private region: ChartRegion;
  /** Blob URL for coverage GeoJSON loaded from OPFS, or null if streaming. */
  private coverageBlobURL: string | null = null;

  constructor(regionId?: string) {
    this.region =
      CHART_REGIONS.find((r) => r.id === regionId) ?? CHART_REGIONS[0];
  }

  /** Get the active region. */
  getRegion(): ChartRegion {
    return this.region;
  }

  /** Switch to a different region. Returns true if the region changed. */
  setRegion(regionId: string): boolean {
    const newRegion = CHART_REGIONS.find((r) => r.id === regionId);
    if (!newRegion || newRegion.id === this.region.id) return false;
    this.revokeCoverageBlobURL();
    this.region = newRegion;
    return true;
  }

  /**
   * Try to load coverage GeoJSON from OPFS for offline use.
   * Call this before building the style (e.g. at startup or after region switch).
   * If the file isn't in OPFS, falls back to the remote URL.
   */
  async loadOfflineCoverage(): Promise<void> {
    this.revokeCoverageBlobURL();
    this.coverageBlobURL = await getAuxFileURL(this.region.coverageFilename);
  }

  getSource(): SourceSpecification {
    return {
      type: "vector",
      tiles: [`pmtiles:///${this.region.filename}/{z}/{x}/{y}`],
      minzoom: this.minZoom,
      maxzoom: this.maxZoom,
      attribution: this.getAttribution(),
    };
  }

  getExtraSources(): Record<string, SourceSpecification> {
    return {
      [COVERAGE_SOURCE_ID]: {
        type: "geojson",
        data: this.coverageBlobURL ?? `/${this.region.coverageFilename}`,
      },
    };
  }

  getLayers(): LayerSpecification[] {
    const {
      depthUnit,
      detailLevel,
      layerGroups,
      displayTheme,
      symbologyScheme,
      shallowDepth,
      deepDepth,
    } = getSettings();
    return getNauticalLayers(
      SOURCE_ID,
      depthUnit,
      detailLevel,
      layerGroups,
      COVERAGE_SOURCE_ID,
      displayTheme,
      symbologyScheme,
      shallowDepth,
      deepDepth,
    );
  }

  getAttribution(): string {
    return '&copy; <a href="https://nauticalcharts.noaa.gov">NOAA</a> ENC';
  }

  private revokeCoverageBlobURL(): void {
    if (this.coverageBlobURL) {
      URL.revokeObjectURL(this.coverageBlobURL);
      this.coverageBlobURL = null;
    }
  }
}
