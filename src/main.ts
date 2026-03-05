import { addProtocol } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Protocol } from "pmtiles";
import "./style.css";
import {
  ChartManager,
  FeatureQueryHandler,
  NOAAChartProvider,
  NOAAECDISProvider,
  OSMChartProvider,
  VectorChartProvider,
} from "./chart";
import { createSettingsPanel } from "./ui/SettingsPanel";

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
  initialProviderId: "s57-vector",
});

// Populate chart selector in top bar
const chartSelect = document.getElementById(
  "chart-select",
) as HTMLSelectElement;
for (const provider of chartManager.getProviders()) {
  const option = document.createElement("option");
  option.value = provider.id;
  option.textContent = provider.name;
  if (provider.id === chartManager.getActiveProvider()?.id) {
    option.selected = true;
  }
  chartSelect.appendChild(option);
}
chartSelect.addEventListener("change", () => {
  chartManager.setActiveProvider(chartSelect.value);
});

new FeatureQueryHandler(chartManager);

// Settings gear in top bar
const topBar = document.getElementById("top-bar");
if (topBar) createSettingsPanel(topBar);

// HUD: zoom + cursor position
const hudDiv = document.createElement("div");
hudDiv.style.cssText =
  "position:fixed;bottom:40px;right:10px;background:rgba(0,0,0,0.7);color:#fff;padding:4px 8px;font:12px monospace;z-index:9999;border-radius:4px;line-height:1.6";
document.body.appendChild(hudDiv);

const zoomSpan = document.createElement("div");
const posSpan = document.createElement("div");
hudDiv.append(zoomSpan, posSpan);

const updateZoom = () => {
  zoomSpan.textContent = `z${chartManager.map.getZoom().toFixed(1)}`;
};
chartManager.map.on("zoom", updateZoom);
chartManager.map.on("load", updateZoom);

const formatDDM = (deg: number, pos: string, neg: string): string => {
  const dir = deg >= 0 ? pos : neg;
  const abs = Math.abs(deg);
  const d = Math.floor(abs);
  const m = ((abs - d) * 60).toFixed(3);
  return `${d}\u00b0${String(m).padStart(6, "0")}'${dir}`;
};

chartManager.map.on("mousemove", (e) => {
  const { lng, lat } = e.lngLat;
  posSpan.textContent = `${formatDDM(lat, "N", "S")} ${formatDDM(lng, "E", "W")}`;
});
posSpan.textContent = "";
