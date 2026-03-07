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
import { parseLatLon } from "./utils/coordinates";

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

// HUD: zoom + cursor position + go-to
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

// --- Context menu (right-click on map) ---
const ctxMenu = document.createElement("div");
ctxMenu.className = "map-context-menu";
document.body.appendChild(ctxMenu);

let ctxLat = 0;
let ctxLng = 0;

const hideContextMenu = () => {
  ctxMenu.style.display = "none";
};

// Build menu items
const ctxCopy = document.createElement("div");
ctxCopy.className = "map-context-item";
const ctxCopyLabel = document.createElement("span");
ctxCopy.appendChild(ctxCopyLabel);

const ctxGoto = document.createElement("div");
ctxGoto.className = "map-context-item";
ctxGoto.textContent = "Go to\u2026";

const ctxGotoInput = document.createElement("input");
ctxGotoInput.type = "text";
ctxGotoInput.placeholder = "lat,lon or 42\u00b018.3'N 70\u00b056.8'W";
ctxGotoInput.className = "map-context-input";
ctxGotoInput.style.display = "none";

ctxMenu.append(ctxCopy, ctxGoto, ctxGotoInput);

// Track right-mouse drag vs click
let rightDownX = 0;
let rightDownY = 0;
chartManager.map.getCanvas().addEventListener("mousedown", (e) => {
  if (e.button === 2) {
    rightDownX = e.clientX;
    rightDownY = e.clientY;
  }
});

// Show context menu on right-click (not drag)
chartManager.map.getCanvas().addEventListener("contextmenu", (e) => {
  e.preventDefault();
  const dx = e.clientX - rightDownX;
  const dy = e.clientY - rightDownY;
  if (dx * dx + dy * dy > 25) return; // dragged — don't show menu

  const canvas = chartManager.map.getCanvas();
  const rect = canvas.getBoundingClientRect();
  const lngLat = chartManager.map.unproject([
    e.clientX - rect.left,
    e.clientY - rect.top,
  ]);
  ctxLat = lngLat.lat;
  ctxLng = lngLat.lng;

  ctxCopyLabel.textContent = `Copy ${formatDDM(ctxLat, "N", "S")} ${formatDDM(ctxLng, "E", "W")}`;
  ctxGotoInput.style.display = "none";

  // Position menu near click, keeping it on screen
  ctxMenu.style.display = "block";
  const menuW = ctxMenu.offsetWidth;
  const menuH = ctxMenu.offsetHeight;
  const left = Math.min(e.clientX, window.innerWidth - menuW - 4);
  const top = Math.min(e.clientY, window.innerHeight - menuH - 4);
  ctxMenu.style.left = `${left}px`;
  ctxMenu.style.top = `${top}px`;
});

// Copy position
ctxCopy.addEventListener("click", () => {
  const text = `${ctxLat.toFixed(6)},${ctxLng.toFixed(6)}`;
  navigator.clipboard.writeText(text);
  hideContextMenu();
});

// Go to: show input
ctxGoto.addEventListener("click", () => {
  ctxGotoInput.style.display = "block";
  ctxGotoInput.value = "";
  ctxGotoInput.focus();
});

const flyToInput = (value: string) => {
  const result = parseLatLon(value);
  if (result) {
    const [lat, lon] = result;
    chartManager.map.flyTo({
      center: [lon, lat],
      zoom: Math.max(chartManager.map.getZoom(), 10),
    });
    hideContextMenu();
  } else {
    ctxGotoInput.classList.add("error");
    setTimeout(() => ctxGotoInput.classList.remove("error"), 1000);
  }
};

ctxGotoInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") flyToInput(ctxGotoInput.value);
  if (e.key === "Escape") hideContextMenu();
  e.stopPropagation(); // don't let MapLibre handle these keys
});

// Dismiss on click elsewhere or map interaction
document.addEventListener("click", (e) => {
  if (!ctxMenu.contains(e.target as Node)) hideContextMenu();
});
chartManager.map.on("movestart", hideContextMenu);
