import { addProtocol } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Protocol } from "pmtiles";
import "./style.css";
import {
  ChartManager,
  ChartSwitcherControl,
  NOAAChartProvider,
  NOAAECDISProvider,
  OSMChartProvider,
  VectorChartProvider,
} from "./chart";

// Register PMTiles protocol for vector tile sources
const protocol = new Protocol({ metadata: true });
addProtocol("pmtiles", protocol.tilev4);

const chartManager = new ChartManager({
  container: "map",
  center: [-71.06, 42.36], // Boston Harbor
  zoom: 12,
  providers: [
    new NOAAChartProvider(),
    new NOAAECDISProvider(),
    new OSMChartProvider(),
    new VectorChartProvider(),
  ],
  initialProviderId: "noaa-ncds",
});

chartManager.map.addControl(new ChartSwitcherControl(chartManager), "top-left");

// Temporary zoom level display for debugging
const zoomDiv = document.createElement("div");
zoomDiv.style.cssText =
  "position:fixed;bottom:40px;right:10px;background:rgba(0,0,0,0.7);color:#fff;padding:4px 8px;font:12px monospace;z-index:9999;border-radius:4px";
document.body.appendChild(zoomDiv);
const updateZoom = () => {
  zoomDiv.textContent = `z${chartManager.map.getZoom().toFixed(1)}`;
};
chartManager.map.on("zoom", updateZoom);
chartManager.map.on("load", updateZoom);
