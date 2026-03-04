import type { LayerSpecification, SourceSpecification } from "maplibre-gl";
import type { ChartProvider } from "./ChartProvider";

const SOURCE_ID = "osm";

export class OSMChartProvider implements ChartProvider {
  readonly id = "osm";
  readonly name = "OpenStreetMap";
  readonly type = "raster" as const;
  readonly minZoom = 0;
  readonly maxZoom = 19;

  getSource(): SourceSpecification {
    return {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: this.getAttribution(),
      minzoom: this.minZoom,
      maxzoom: this.maxZoom,
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
