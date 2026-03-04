import type { LayerSpecification, SourceSpecification } from "maplibre-gl";
import type { ChartProvider } from "./ChartProvider";

// NOAA Chart Display Service (NCDS) via WMS.
// Uses the NOAAChartDisplay Maritime Chart Service which renders ENC data
// with traditional paper-chart symbology.
// Docs: https://nauticalcharts.noaa.gov/data/gis-data-and-services.html
const NOAA_WMS_BASE =
  "https://gis.charttools.noaa.gov/arcgis/rest/services/MCS/NOAAChartDisplay/MapServer/exts/MaritimeChartService/WMSServer";

// All available S-57 display layers
const WMS_LAYERS = "0,1,2,3,4,5,6,7,8,9,10,11,12";

// MapLibre substitutes {bbox-epsg-3857} with the tile's bounding box
const NOAA_WMS_TILE_URL =
  `${NOAA_WMS_BASE}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap` +
  `&FORMAT=image/png&TRANSPARENT=true` +
  `&LAYERS=${WMS_LAYERS}` +
  `&CRS=EPSG:3857&STYLES=` +
  `&WIDTH=256&HEIGHT=256` +
  `&BBOX={bbox-epsg-3857}`;

const SOURCE_ID = "noaa-ncds";

export class NOAAChartProvider implements ChartProvider {
  readonly id = "noaa-ncds";
  readonly name = "NOAA Nautical Charts";
  readonly type = "raster" as const;
  readonly minZoom = 3;
  readonly maxZoom = 18;

  getSource(): SourceSpecification {
    return {
      type: "raster",
      tiles: [NOAA_WMS_TILE_URL],
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
    return '&copy; <a href="https://nauticalcharts.noaa.gov">NOAA</a>';
  }
}
