import type { LayerSpecification, SourceSpecification } from "maplibre-gl";
import type { ChartProvider } from "./ChartProvider";
import { OSM_TILE_URL_TEMPLATE } from "./osm-tile-cache";

const SOURCE_ID = "osm";

export class OSMChartProvider implements ChartProvider {
  readonly id = "osm";
  readonly name = "OpenStreetMap";
  readonly type = "raster" as const;
  readonly minZoom = 0;
  readonly maxZoom = 19;

  getSources(): Record<string, SourceSpecification> {
    return {
      [SOURCE_ID]: {
        type: "raster",
        tiles: [OSM_TILE_URL_TEMPLATE],
        tileSize: 256,
        attribution: this.getAttribution(),
        minzoom: this.minZoom,
        maxzoom: this.maxZoom,
      },
    };
  }

  getLayers(): LayerSpecification[] {
    return [
      {
        id: `${SOURCE_ID}-layer`,
        type: "raster",
        source: SOURCE_ID,
        minzoom: this.minZoom,
        maxzoom: this.maxZoom,
      },
    ];
  }

  getAttribution(): string {
    return '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
  }
}
