import type { LayerSpecification, SourceSpecification } from "maplibre-gl";
import type { ChartProvider } from "./ChartProvider";

// NOAA ECDIS Display Service via WMS.
// Uses the ENCOnline Maritime Chart Service which renders ENC data
// with IHO S-52 ECDIS symbology (the style used on ship bridge systems).
// Docs: https://nauticalcharts.noaa.gov/data/gis-data-and-services.html
const ECDIS_WMS_BASE =
  "https://gis.charttools.noaa.gov/arcgis/rest/services/MCS/ENCOnline/MapServer/exts/MaritimeChartService/WMSServer";

const WMS_LAYERS = "0,1,2,3,4,5,6,7,8,9,10,11,12";

const ECDIS_WMS_TILE_URL =
  `${ECDIS_WMS_BASE}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap` +
  `&FORMAT=image/png&TRANSPARENT=true` +
  `&LAYERS=${WMS_LAYERS}` +
  `&CRS=EPSG:3857&STYLES=` +
  `&WIDTH=256&HEIGHT=256` +
  `&BBOX={bbox-epsg-3857}`;

const SOURCE_ID = "noaa-ecdis";

export class NOAAECDISProvider implements ChartProvider {
  readonly id = "noaa-ecdis";
  readonly name = "NOAA ECDIS Charts";
  readonly type = "raster" as const;
  readonly minZoom = 3;
  readonly maxZoom = 18;

  getSource(): SourceSpecification {
    return {
      type: "raster",
      tiles: [ECDIS_WMS_TILE_URL],
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
    return '&copy; <a href="https://nauticalcharts.noaa.gov">NOAA</a> ECDIS';
  }
}
