import type { LayerSpecification, SourceSpecification } from "maplibre-gl";
import { getSettings } from "../settings";
import type { ChartProvider } from "./ChartProvider";
import { getNauticalLayers } from "./nautical-style";

const SOURCE_ID = "s57-vector";
const COVERAGE_SOURCE_ID = "s57-coverage";

/**
 * Chart provider for S-57 ENC vector tiles in PMTiles format.
 * Tiles are generated offline by the tools/s57-pipeline/ tool.
 */
export class VectorChartProvider implements ChartProvider {
  readonly id = "s57-vector";
  readonly name = "NOAA Vector Charts";
  readonly type = "vector" as const;
  readonly minZoom = 0;
  readonly maxZoom = 14;

  private pmtilesUrl: string;
  private coverageUrl: string;

  constructor(
    pmtilesUrl = "pmtiles:///nautical.pmtiles",
    coverageUrl = "/nautical.coverage.geojson",
  ) {
    this.pmtilesUrl = pmtilesUrl;
    this.coverageUrl = coverageUrl;
  }

  getSource(): SourceSpecification {
    return {
      type: "vector",
      tiles: [`${this.pmtilesUrl}/{z}/{x}/{y}`],
      minzoom: this.minZoom,
      maxzoom: this.maxZoom,
      attribution: this.getAttribution(),
    };
  }

  getExtraSources(): Record<string, SourceSpecification> {
    return {
      [COVERAGE_SOURCE_ID]: {
        type: "geojson",
        data: this.coverageUrl,
      },
    };
  }

  getLayers(): LayerSpecification[] {
    const { depthUnit, detailLevel, layerGroups } = getSettings();
    return getNauticalLayers(
      SOURCE_ID,
      depthUnit,
      detailLevel,
      layerGroups,
      COVERAGE_SOURCE_ID,
    );
  }

  getAttribution(): string {
    return '&copy; <a href="https://nauticalcharts.noaa.gov">NOAA</a> ENC';
  }
}
