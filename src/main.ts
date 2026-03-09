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
import { MeasurementLayer } from "./map/MeasurementLayer";
import { RouteEditor } from "./map/RouteEditor";
import { RouteLayer } from "./map/RouteLayer";
import { TrackLayer } from "./map/TrackLayer";
import { TrackRecorder } from "./map/TrackRecorder";
import {
  BrowserGeolocationProvider,
  NavigationDataManager,
  SignalKProvider,
  SimulatorProvider,
  WebSerialNMEAProvider,
} from "./navigation";
import { getSettings, onSettingsChange, updateSettings } from "./settings";
import { createInstrumentHUD } from "./ui/InstrumentHUD";
import { NavigationHUD } from "./ui/NavigationHUD";
import { RecenterButton } from "./ui/RecenterButton";
import { RouteManagerPanel } from "./ui/RouteManagerPanel";
import { createSettingsPanel } from "./ui/SettingsPanel";
import { TrackManagerPanel } from "./ui/TrackManagerPanel";
import { formatLatLon, parseLatLon } from "./utils/coordinates";
import { ChartModeController } from "./vessel/ChartMode";
import { VesselLayer } from "./vessel/VesselLayer";

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

// --- Navigation system ---
const navManager = new NavigationDataManager();

// Register available GPS providers
const simulator = new SimulatorProvider();
navManager.registerProvider(simulator);
navManager.registerProvider(new BrowserGeolocationProvider());
if (WebSerialNMEAProvider.isAvailable()) {
  navManager.registerProvider(new WebSerialNMEAProvider());
}
navManager.registerProvider(new SignalKProvider());

// Vessel display layer
const vesselLayer = new VesselLayer(chartManager.map);

// Chart mode controller (follow, course-up, north-up, free)
const chartMode = new ChartModeController(chartManager.map);

// Re-center button
const recenterBtn = new RecenterButton({
  onRecenter: () => chartMode.setMode("follow"),
});
chartManager.map.addControl(recenterBtn, "bottom-left");

// Wire navigation data to vessel layer and chart mode
navManager.subscribe((data) => {
  vesselLayer.update(data);
  chartMode.update(data);

  // Show/hide re-center button
  recenterBtn.setVisible(chartMode.getMode() === "free");
});

// React to chart mode changes from settings
onSettingsChange((s) => {
  if (s.chartMode !== chartMode.getMode()) {
    chartMode.setMode(s.chartMode);
  }
  if (s.gpsSource !== navManager.getActiveProvider()?.id) {
    navManager.setActiveProvider(s.gpsSource);
  }
});

// Navigation HUD (replaces ad-hoc zoom/cursor display)
new NavigationHUD(chartManager.map, navManager);

// Instrument HUD (large data display) — insert before map so it pushes map down
const mapEl = document.getElementById("map");
const instrumentHUD = createInstrumentHUD(navManager);
if (mapEl) {
  mapEl.insertAdjacentElement("beforebegin", instrumentHUD);
} else {
  document.body.appendChild(instrumentHUD);
}

// Activate initial GPS source from settings
navManager.setActiveProvider(getSettings().gpsSource);

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

const ctxMeasure = document.createElement("div");
ctxMeasure.className = "map-context-item";
ctxMeasure.textContent = "Measure from here";

const ctxRoute = document.createElement("div");
ctxRoute.className = "map-context-item";
ctxRoute.textContent = "Route from here";

ctxMenu.append(ctxCopy, ctxMeasure, ctxRoute, ctxGoto, ctxGotoInput);

// Track right-mouse drag vs click
let rightDownX = 0;
let rightDownY = 0;
chartManager.map.getCanvas().addEventListener("mousedown", (e) => {
  if (e.button === 2) {
    rightDownX = e.clientX;
    rightDownY = e.clientY;
  }
});

/** Show the context menu at the given map lat/lng and screen position. */
const showContextMenu = (
  lat: number,
  lng: number,
  clientX: number,
  clientY: number,
) => {
  ctxLat = lat;
  ctxLng = lng;
  ctxCopyLabel.textContent = `Copy ${formatLatLon(ctxLat, "lat")} ${formatLatLon(ctxLng, "lon")}`;
  ctxGotoInput.style.display = "none";

  ctxMenu.style.display = "block";
  const menuW = ctxMenu.offsetWidth;
  const menuH = ctxMenu.offsetHeight;
  const left = Math.min(clientX, window.innerWidth - menuW - 4);
  const top = Math.min(clientY, window.innerHeight - menuH - 4);
  ctxMenu.style.left = `${left}px`;
  ctxMenu.style.top = `${top}px`;
};

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
  showContextMenu(lngLat.lat, lngLat.lng, e.clientX, e.clientY);
});

// Long-press on mobile → show context menu (touch equivalent of right-click)
{
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  let touchStartX = 0;
  let touchStartY = 0;
  const LONG_PRESS_MS = 500;
  const MOVE_THRESHOLD = 10;

  const canvas = chartManager.map.getCanvas();

  canvas.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length !== 1) {
        if (longPressTimer) clearTimeout(longPressTimer);
        longPressTimer = null;
        return;
      }
      const touch = e.touches[0];
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;

      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        const rect = canvas.getBoundingClientRect();
        const lngLat = chartManager.map.unproject([
          touchStartX - rect.left,
          touchStartY - rect.top,
        ]);
        showContextMenu(lngLat.lat, lngLat.lng, touchStartX, touchStartY);
      }, LONG_PRESS_MS);
    },
    { passive: true },
  );

  canvas.addEventListener(
    "touchmove",
    (e) => {
      if (!longPressTimer) return;
      const touch = e.touches[0];
      const dx = touch.clientX - touchStartX;
      const dy = touch.clientY - touchStartY;
      if (dx * dx + dy * dy > MOVE_THRESHOLD * MOVE_THRESHOLD) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    },
    { passive: true },
  );

  canvas.addEventListener("touchend", () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  });

  canvas.addEventListener("touchcancel", () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  });
}

// Copy position
ctxCopy.addEventListener("click", () => {
  const text = `${ctxLat.toFixed(6)},${ctxLng.toFixed(6)}`;
  navigator.clipboard.writeText(text).catch(() => {});
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

// --- Measurement tool ---
const measurementLayer = new MeasurementLayer(chartManager.map);
ctxMeasure.addEventListener("click", () => {
  hideContextMenu();
  measurementLayer.startFrom(ctxLng, ctxLat);
});

ctxRoute.addEventListener("click", () => {
  hideContextMenu();
  routeEditor.startFromPoint(ctxLat, ctxLng);
});

// ESC key: clear measurement (or future tools)
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    measurementLayer.clear();
  }
});

// --- Track recording ---
const trackRecorder = new TrackRecorder(navManager);
const trackLayer = new TrackLayer(chartManager.map, navManager, trackRecorder);
const trackPanel = new TrackManagerPanel(trackLayer, trackRecorder);

// React to track recording setting
onSettingsChange((s) => {
  if (s.trackRecordingEnabled && !trackRecorder.isRecording()) {
    trackRecorder.start();
  } else if (!s.trackRecordingEnabled && trackRecorder.isRecording()) {
    trackRecorder.stop();
  }
});
if (getSettings().trackRecordingEnabled) trackRecorder.start();

// --- Routes ---
const routeLayer = new RouteLayer(chartManager.map);
const routeEditor = new RouteEditor(chartManager.map, routeLayer);
const routePanel = new RouteManagerPanel(routeLayer, routeEditor);

// Add toolbar buttons to top bar
if (topBar) {
  const settingsWrapper = topBar.querySelector(".settings-wrapper");

  // Record track toggle
  const recordBtn = document.createElement("button");
  recordBtn.className = "topbar-toggle";
  recordBtn.title = "Record track";
  recordBtn.textContent = "\u23FA"; // record symbol ⏺
  const updateRecordBtn = () => {
    const on = trackRecorder.isRecording();
    recordBtn.classList.toggle("active", on);
    recordBtn.title = on ? "Stop recording" : "Record track";
  };
  recordBtn.addEventListener("click", () => {
    updateSettings({ trackRecordingEnabled: !trackRecorder.isRecording() });
  });
  trackRecorder.onRecordingChange(updateRecordBtn);
  updateRecordBtn();
  topBar.insertBefore(recordBtn, settingsWrapper);

  // Instrument HUD toggle
  const hudBtn = document.createElement("button");
  hudBtn.className = "topbar-toggle";
  hudBtn.title = "Instrument HUD";
  hudBtn.textContent = "\u{1F4CA}"; // bar chart 📊
  const updateHudBtn = () => {
    hudBtn.classList.toggle("active", getSettings().showInstrumentHUD);
  };
  hudBtn.addEventListener("click", () => {
    updateSettings({ showInstrumentHUD: !getSettings().showInstrumentHUD });
  });
  onSettingsChange(updateHudBtn);
  updateHudBtn();
  topBar.insertBefore(hudBtn, settingsWrapper);

  // Tracks panel button
  const trackBtn = document.createElement("button");
  trackBtn.className = "settings-btn";
  trackBtn.title = "Tracks";
  trackBtn.textContent = "\u{1F9ED}";
  trackBtn.addEventListener("click", () => trackPanel.toggle());
  topBar.insertBefore(trackBtn, settingsWrapper);

  // Routes panel button
  const routeBtn = document.createElement("button");
  routeBtn.className = "settings-btn";
  routeBtn.title = "Routes";
  routeBtn.textContent = "\u{1F4CD}";
  routeBtn.addEventListener("click", () => routePanel.toggle());
  topBar.insertBefore(routeBtn, settingsWrapper);
}

// Dismiss on click elsewhere or map interaction
document.addEventListener("click", (e) => {
  if (!ctxMenu.contains(e.target as Node)) hideContextMenu();
});
chartManager.map.on("movestart", hideContextMenu);
