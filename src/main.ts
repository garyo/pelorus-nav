import { addProtocol } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { PMTiles, Protocol } from "pmtiles";
import "./style.css";
import {
  ChartManager,
  FeatureQueryHandler,
  NOAAChartProvider,
  NOAAECDISProvider,
  OSMChartProvider,
  VectorChartProvider,
} from "./chart";
import { OPFSSource } from "./data/opfs-source";
import { chartAssetBase } from "./data/remote-url";
import { getChartFile, listStoredCharts } from "./data/tile-store";
import { BearingLine } from "./map/BearingLine";
import { MeasurementLayer } from "./map/MeasurementLayer";
import { RouteEditor } from "./map/RouteEditor";
import { RouteLayer } from "./map/RouteLayer";
import { TrackLayer } from "./map/TrackLayer";
import { TrackRecorder } from "./map/TrackRecorder";
import { WaypointLayer } from "./map/WaypointLayer";
import {
  BrowserGeolocationProvider,
  CapacitorGPSProvider,
  type NavigationData,
  NavigationDataManager,
  SignalKProvider,
  SimulatorProvider,
  WebSerialNMEAProvider,
} from "./navigation";
import { ActiveNavigationManager } from "./navigation/ActiveNavigation";
import { CourseSmoothing } from "./navigation/CourseSmoothing";
import { RegionAutoSwitch } from "./navigation/RegionAutoSwitch";
import { getSettings, onSettingsChange, updateSettings } from "./settings";
import { CancelNavButton } from "./ui/CancelNavButton";
import { ChartCachePanel } from "./ui/ChartCachePanel";
import { createInstrumentHUD, INSTRUMENTS } from "./ui/InstrumentHUD";
import {
  iconGauge,
  iconGlobe,
  iconMaximize,
  iconMinimize,
  iconPin,
  iconRecord,
  iconRoute,
  iconTrack,
  setIcon,
} from "./ui/icons";
import { NavigationHUD } from "./ui/NavigationHUD";
import { trackInstrumentHUD } from "./ui/PanelStack";
import { RecenterButton } from "./ui/RecenterButton";
import { RouteManagerPanel } from "./ui/RouteManagerPanel";
import { createSettingsPanel } from "./ui/SettingsPanel";
import { TrackManagerPanel } from "./ui/TrackManagerPanel";
import { WakeLockController } from "./ui/WakeLock";
import { WaypointManagerPanel } from "./ui/WaypointManagerPanel";
import { formatLatLon, parseLatLon } from "./utils/coordinates";
import { applyDeclination, bearingModeLabel } from "./utils/magnetic";
import { generateUUID } from "./utils/uuid";
import { ChartModeController } from "./vessel/ChartMode";
import { CourseLine } from "./vessel/CourseLine";
import { VesselLayer } from "./vessel/VesselLayer";

// Register PMTiles protocol for vector tile sources
const protocol = new Protocol({ metadata: true });
addProtocol("pmtiles", protocol.tilev4);

// Load any offline PMTiles from OPFS before creating the map
try {
  const storedCharts = await listStoredCharts();
  for (const chart of storedCharts) {
    const file = await getChartFile(chart.filename);
    if (file) {
      const key = `${chartAssetBase()}/${chart.filename}`;
      const source = new OPFSSource(file, key);
      protocol.add(new PMTiles(source));
    }
  }
} catch {
  // OPFS not available or no stored charts — fall back to remote
}

// Apply display theme to body element
const applyDisplayTheme = (theme: string) => {
  if (theme === "day") {
    delete document.body.dataset.theme;
  } else {
    document.body.dataset.theme = theme;
  }
};
applyDisplayTheme(getSettings().displayTheme);
onSettingsChange((s) => applyDisplayTheme(s.displayTheme));

// Create vector chart provider — loads ALL regions simultaneously
const initialRegion = getSettings().activeRegion;
const vectorProvider = new VectorChartProvider(initialRegion);
await vectorProvider.loadAllOfflineCoverage();
const activeRegionInfo = vectorProvider.getRegion();
let prevActiveRegion = activeRegionInfo.id;

// Restore saved map position, falling back to the active region's default
const MAP_POS_KEY = "pelorus-nav-map-position";
const savedPos = (() => {
  try {
    const raw = localStorage.getItem(MAP_POS_KEY);
    if (raw) return JSON.parse(raw) as { center: [number, number]; zoom: number };
  } catch { /* ignore */ }
  return null;
})();

const chartManager = new ChartManager({
  container: "map",
  center: savedPos?.center ?? activeRegionInfo.center,
  zoom: savedPos?.zoom ?? activeRegionInfo.defaultZoom,
  providers: [
    new NOAAChartProvider(),
    new NOAAECDISProvider(),
    new OSMChartProvider(),
    vectorProvider,
  ],
  initialProviderId: "s57-vector",
});

// Persist map position on every move so refresh restores it
chartManager.map.on("moveend", () => {
  const c = chartManager.map.getCenter();
  localStorage.setItem(
    MAP_POS_KEY,
    JSON.stringify({ center: [c.lng, c.lat], zoom: chartManager.map.getZoom() }),
  );
});

// E-ink frame rate throttle: limit repaints to ~4 fps to reduce ghosting
const EINK_FRAME_INTERVAL = 250; // ms between frames
{
  const map = chartManager.map;
  const originalTriggerRepaint = map.triggerRepaint.bind(map);
  let lastFrameTime = 0;
  let pendingFrame: ReturnType<typeof setTimeout> | null = null;

  const throttledRepaint = () => {
    if (getSettings().displayTheme !== "eink") {
      originalTriggerRepaint();
      return;
    }
    const now = performance.now();
    const elapsed = now - lastFrameTime;
    if (elapsed >= EINK_FRAME_INTERVAL) {
      lastFrameTime = now;
      originalTriggerRepaint();
    } else if (!pendingFrame) {
      pendingFrame = setTimeout(() => {
        pendingFrame = null;
        lastFrameTime = performance.now();
        originalTriggerRepaint();
      }, EINK_FRAME_INTERVAL - elapsed);
    }
  };
  map.triggerRepaint = throttledRepaint;
}

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

// Light sector arcs and range circles (client-side generated from LIGHTS data)
import { LightSectorLayer } from "./chart/LightSectorLayer";

new LightSectorLayer(chartManager.map);

// Settings gear in top bar menu
const topbarMenu = document.getElementById("topbar-menu");
const settingsHandle = topbarMenu ? createSettingsPanel(topbarMenu) : null;

// Hamburger toggle for mobile
const hamburgerBtn = document.getElementById("hamburger-btn");
const closeHamburger = () => topbarMenu?.classList.remove("open");
if (hamburgerBtn && topbarMenu) {
  hamburgerBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    topbarMenu.classList.toggle("open");
    settingsHandle?.hide();
  });
  document.addEventListener("click", (e) => {
    if (!topbarMenu.contains(e.target as Node) && e.target !== hamburgerBtn) {
      closeHamburger();
    }
  });
}

// --- Navigation system ---
const navManager = new NavigationDataManager();

// Register available GPS providers
const simulator = new SimulatorProvider();
simulator.setSpeedMultiplier(getSettings().simulatorSpeed);
navManager.registerProvider(simulator);
if (CapacitorGPSProvider.isAvailable()) {
  navManager.registerProvider(new CapacitorGPSProvider());
}
// Browser geolocation works in both WebView and browser
navManager.registerProvider(new BrowserGeolocationProvider());
if (WebSerialNMEAProvider.isAvailable()) {
  navManager.registerProvider(new WebSerialNMEAProvider());
}
navManager.registerProvider(new SignalKProvider());

// Vessel display layer
const vesselLayer = new VesselLayer(chartManager.map);

// Shared course smoother for damped COG/SOG
const courseSmoother = new CourseSmoothing();

// Chart mode controller (follow, course-up, north-up, free)
const chartMode = new ChartModeController(chartManager.map);

// Re-center button
const recenterBtn = new RecenterButton({
  onRecenter: () => chartMode.recenter(),
});
chartManager.map.addControl(recenterBtn, "bottom-left");

// Course line (projected COG line)
const courseLine = new CourseLine(chartManager.map);

// Wire navigation data to vessel layer and feed course smoother
let lastNavData: NavigationData | null = null;
navManager.subscribe((data) => {
  lastNavData = data;
  vesselLayer.update(data);
  courseSmoother.addSample(
    data.cog,
    data.sog,
    data.latitude,
    data.longitude,
    data.timestamp,
  );
  chartManager.map.triggerRepaint();

  // Show/hide re-center button
  recenterBtn.setVisible(chartMode.getMode() === "free");
});

// Per-frame smoothing for fluid course line and map rotation
let prevCog = -1;
let prevLat = -999;
let prevLon = -999;
chartManager.map.on("render", () => {
  if (!lastNavData) return;
  const isEink = getSettings().displayTheme === "eink";
  // E-ink: snap to target in one frame (no multi-frame animation)
  if (isEink) {
    courseSmoother.snapToTarget();
  }
  const smoothed = courseSmoother.smooth(performance.now());
  if (!smoothed) return;
  // Always update position/bearing (needed for recentering on straight courses)
  chartMode.update(lastNavData, smoothed);
  courseLine.update(lastNavData, smoothed);
  // Keep animating while values are still converging (not on e-ink)
  const cogDelta = Math.abs(smoothed.cog - prevCog);
  const posDelta =
    Math.abs(smoothed.lat - prevLat) + Math.abs(smoothed.lon - prevLon);
  prevCog = smoothed.cog;
  prevLat = smoothed.lat;
  prevLon = smoothed.lon;
  if (!isEink && (cogDelta >= 0.01 || posDelta >= 1e-7)) {
    chartManager.map.triggerRepaint();
  }
});

// React to chart mode changes from settings
onSettingsChange((s) => {
  if (s.chartMode !== chartMode.getMode()) {
    chartMode.setMode(s.chartMode);
  }
  if (s.gpsSource !== navManager.getActiveProvider()?.id) {
    navManager.setActiveProvider(s.gpsSource);
  }
  simulator.setSpeedMultiplier(s.simulatorSpeed);
  navManager.setRateMode(s.gpsRateMode, s.manualUpdateIntervalMs);
  wakeLockCtrl.setMode(s.wakeLock);
  wakeLockCtrl.setGpsActive(s.gpsSource !== "none");
  // Switch active region (UI only — all regions are always rendered).
  // Always flyTo the region center on manual region switch.
  vectorProvider.setActiveRegion(s.activeRegion);
  const region = vectorProvider.getRegion();
  if (region.id !== prevActiveRegion) {
    prevActiveRegion = region.id;
    chartManager.map.flyTo({
      center: region.center,
      zoom: region.defaultZoom,
    });
  }
});

// Navigation HUD (replaces ad-hoc zoom/cursor display)
new NavigationHUD(chartManager.map, navManager);

// Instrument HUD (large data display) — insert before map so it pushes map down
const mapEl = document.getElementById("map");
const instrumentHUD = createInstrumentHUD(navManager);
if (mapEl) {
  mapEl.insertAdjacentElement("beforebegin", instrumentHUD.element);
} else {
  document.body.appendChild(instrumentHUD.element);
}

// Keep panel stack below instrument HUD
trackInstrumentHUD(instrumentHUD.element);

// Configure adaptive GPS rate from settings
const initGpsSettings = getSettings();
navManager.setRateMode(
  initGpsSettings.gpsRateMode,
  initGpsSettings.manualUpdateIntervalMs,
);

// Screen wake lock
const wakeLockCtrl = new WakeLockController();
wakeLockCtrl.setMode(initGpsSettings.wakeLock);
wakeLockCtrl.setGpsActive(initGpsSettings.gpsSource !== "none");

// Activate initial GPS source from settings
navManager.setActiveProvider(initGpsSettings.gpsSource);

// Auto-switch active region based on GPS position
new RegionAutoSwitch(navManager);

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

const ctxWaypoint = document.createElement("div");
ctxWaypoint.className = "map-context-item";
ctxWaypoint.textContent = "Mark waypoint here";

ctxMenu.append(
  ctxCopy,
  ctxWaypoint,
  ctxMeasure,
  ctxRoute,
  ctxGoto,
  ctxGotoInput,
);

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

ctxWaypoint.addEventListener("click", () => {
  hideContextMenu();
  const wp: import("./data/Waypoint").StandaloneWaypoint = {
    id: generateUUID(),
    lat: ctxLat,
    lon: ctxLng,
    name: `WP ${formatLatLon(ctxLat, "lat")}`,
    notes: "",
    icon: "default",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  waypointLayer
    .addWaypoint(wp)
    .then(() => {
      waypointPanel.show();
    })
    .catch(console.error);
});

// ESC key: cancel active navigation or clear measurement
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (activeNav.getState().type !== "idle") {
      activeNav.stop();
    } else {
      measurementLayer.clear();
    }
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

// --- Waypoints + Active Navigation ---
const activeNav = new ActiveNavigationManager(navManager);
const waypointLayer = new WaypointLayer(chartManager.map);
new BearingLine(chartManager.map, activeNav, navManager);
const waypointPanel = new WaypointManagerPanel(waypointLayer, activeNav);
routePanel.setActiveNav(activeNav);

// Cancel navigation control
const cancelNavBtn = new CancelNavButton(activeNav);
chartManager.map.addControl(cancelNavBtn, "bottom-left");

// Register BRG/DTW instruments (before restore so HUD is ready)
INSTRUMENTS.set("brg", {
  id: "brg",
  label: "Bearing to wpt",
  format(data, settings) {
    const info = activeNav.getInfo();
    const mode = settings.bearingMode;
    const label = bearingModeLabel(mode);
    if (!info) return { value: "--", unit: label };
    const lat = data?.latitude ?? 0;
    const lon = data?.longitude ?? 0;
    const display = applyDeclination(info.bearingDeg, mode, lat, lon);
    return {
      value: `${Math.round(display).toString().padStart(3, "0")}\u00b0`,
      unit: label,
    };
  },
});

INSTRUMENTS.set("dtw", {
  id: "dtw",
  label: "Dist to wpt",
  format() {
    const info = activeNav.getInfo();
    if (!info) return { value: "--", unit: "NM" };
    return {
      value:
        info.distanceNM < 10
          ? info.distanceNM.toFixed(2)
          : info.distanceNM.toFixed(1),
      unit: "NM",
    };
  },
});

// Wire HUD to show BRG/DTW cells during active navigation
instrumentHUD.setActiveNav(activeNav);
instrumentHUD.onNavCellClick(() => routePanel.showActiveRoute());

// Restore persisted navigation state (after all subscribers are wired up)
await activeNav.restore();

// Helper: add a text label span for mobile menu display
const addMenuLabel = (btn: HTMLElement, label: string) => {
  const span = document.createElement("span");
  span.className = "topbar-menu-label";
  span.textContent = label;
  btn.appendChild(span);
};

// Add toolbar buttons to top bar menu
if (topbarMenu) {
  const settingsWrapper = topbarMenu.querySelector(".settings-wrapper");

  // Record track toggle
  const recordBtn = document.createElement("button");
  recordBtn.className = "topbar-toggle topbar-record";
  recordBtn.title = "Record track";
  setIcon(recordBtn, iconRecord);
  addMenuLabel(recordBtn, "Record");
  const updateRecordBtn = () => {
    const on = trackRecorder.isRecording();
    recordBtn.classList.toggle("active", on);
    recordBtn.title = on ? "Stop recording" : "Record track";
  };
  recordBtn.addEventListener("click", () => {
    updateSettings({ trackRecordingEnabled: !trackRecorder.isRecording() });
    closeHamburger();
  });
  trackRecorder.onRecordingChange(updateRecordBtn);
  updateRecordBtn();
  topbarMenu.insertBefore(recordBtn, settingsWrapper);

  // Instrument HUD toggle
  const hudBtn = document.createElement("button");
  hudBtn.className = "topbar-toggle";
  hudBtn.title = "Instrument HUD";
  setIcon(hudBtn, iconGauge);
  addMenuLabel(hudBtn, "Instruments");
  const updateHudBtn = () => {
    hudBtn.classList.toggle("active", getSettings().showInstrumentHUD);
  };
  hudBtn.addEventListener("click", () => {
    updateSettings({ showInstrumentHUD: !getSettings().showInstrumentHUD });
    closeHamburger();
  });
  onSettingsChange(updateHudBtn);
  updateHudBtn();
  topbarMenu.insertBefore(hudBtn, settingsWrapper);

  // Tracks panel button
  const trackBtn = document.createElement("button");
  trackBtn.className = "settings-btn";
  trackBtn.title = "Tracks";
  setIcon(trackBtn, iconTrack);
  addMenuLabel(trackBtn, "Tracks");
  trackBtn.addEventListener("click", () => {
    trackPanel.toggle();
    settingsHandle?.hide();
    closeHamburger();
  });
  topbarMenu.insertBefore(trackBtn, settingsWrapper);

  // Routes panel button
  const routeBtn = document.createElement("button");
  routeBtn.className = "settings-btn";
  routeBtn.title = "Routes";
  setIcon(routeBtn, iconRoute);
  addMenuLabel(routeBtn, "Routes");
  routeBtn.addEventListener("click", () => {
    routePanel.toggle();
    settingsHandle?.hide();
    closeHamburger();
  });
  topbarMenu.insertBefore(routeBtn, settingsWrapper);

  // Waypoints panel button
  const waypointBtn = document.createElement("button");
  waypointBtn.className = "settings-btn";
  waypointBtn.title = "Waypoints";
  setIcon(waypointBtn, iconPin);
  addMenuLabel(waypointBtn, "Waypoints");
  waypointBtn.addEventListener("click", () => {
    waypointPanel.toggle();
    settingsHandle?.hide();
    closeHamburger();
  });
  topbarMenu.insertBefore(waypointBtn, settingsWrapper);

  // Chart cache panel button
  const cachePanel = new ChartCachePanel();
  cachePanel.setOnChartsChanged(() => {
    // Reload OPFS charts into PMTiles protocol + refresh offline coverage
    (async () => {
      try {
        const charts = await listStoredCharts();
        for (const chart of charts) {
          const file = await getChartFile(chart.filename);
          if (file) {
            const key = `${chartAssetBase()}/${chart.filename}`;
            const source = new OPFSSource(file, key);
            protocol.add(new PMTiles(source));
          }
        }
        await vectorProvider.loadAllOfflineCoverage();
        chartManager.refreshStyle();
      } catch {
        // ignore
      }
    })();
  });
  const cacheBtn = document.createElement("button");
  cacheBtn.className = "settings-btn";
  cacheBtn.title = "Chart Regions";
  setIcon(cacheBtn, iconGlobe);
  addMenuLabel(cacheBtn, "Charts");
  cacheBtn.addEventListener("click", () => {
    cachePanel.toggle();
    settingsHandle?.hide();
    closeHamburger();
  });
  topbarMenu.insertBefore(cacheBtn, settingsWrapper);

  // Close manager panels when settings opens
  settingsHandle?.onOpen(() => {
    trackPanel.hide();
    routePanel.hide();
    waypointPanel.hide();
    cachePanel.hide();
    closeHamburger();
  });

  // Fullscreen toggle
  const fullscreenBtn = document.createElement("button");
  fullscreenBtn.className = "topbar-toggle";
  fullscreenBtn.title = "Fullscreen";
  setIcon(fullscreenBtn, iconMaximize);
  addMenuLabel(fullscreenBtn, "Fullscreen");
  const updateFullscreenBtn = () => {
    const isFs = !!document.fullscreenElement;
    fullscreenBtn.classList.toggle("active", isFs);
    setIcon(fullscreenBtn, isFs ? iconMinimize : iconMaximize);
    fullscreenBtn.title = isFs ? "Exit fullscreen" : "Fullscreen";
  };
  fullscreenBtn.addEventListener("click", () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen();
    }
    closeHamburger();
  });
  document.addEventListener("fullscreenchange", updateFullscreenBtn);
  topbarMenu.insertBefore(fullscreenBtn, settingsWrapper);

  // Offline indicator
  const offlineIndicator = document.createElement("div");
  offlineIndicator.className = "offline-indicator";
  offlineIndicator.innerHTML =
    '<div class="offline-dot"></div><span>Offline</span>';
  offlineIndicator.style.display = "none";
  topbarMenu.insertBefore(offlineIndicator, settingsWrapper);

  const updateOnlineStatus = () => {
    offlineIndicator.style.display = navigator.onLine ? "none" : "flex";
  };
  window.addEventListener("online", updateOnlineStatus);
  window.addEventListener("offline", updateOnlineStatus);
  updateOnlineStatus();
}

// Dismiss on click elsewhere or map interaction
document.addEventListener("click", (e) => {
  if (!ctxMenu.contains(e.target as Node)) hideContextMenu();
});
chartManager.map.on("movestart", hideContextMenu);

// Dim overlay layers (routes, waypoints, bearing line) in night/dusk themes
const NIGHT_OPACITY = 0.45;
const DUSK_OPACITY = 0.7;

function applyOverlayDimming(theme: string): void {
  const map = chartManager.map;
  if (!map.isStyleLoaded()) return;

  const opacity =
    theme === "night" ? NIGHT_OPACITY : theme === "dusk" ? DUSK_OPACITY : 1;

  for (const layer of map.getStyle().layers) {
    const id = layer.id;
    const isOverlay =
      id.startsWith("_route-line-") ||
      id.startsWith("_route-labels-") ||
      id === "_bearing-line-layer" ||
      id === "_bearing-line-target";

    if (!isOverlay) continue;

    if (layer.type === "line") {
      map.setPaintProperty(id, "line-opacity", opacity * 0.9);
    } else if (layer.type === "circle") {
      map.setPaintProperty(id, "circle-opacity", opacity);
      map.setPaintProperty(id, "circle-stroke-opacity", opacity);
    } else if (layer.type === "symbol") {
      map.setPaintProperty(id, "text-opacity", opacity);
    }
  }

  // Symbol layers (route points, waypoint points) use icon-opacity
  for (const id of ["_waypoints-points", "_waypoints-labels"]) {
    if (map.getLayer(id)) {
      map.setPaintProperty(id, "icon-opacity", opacity);
      map.setPaintProperty(id, "text-opacity", opacity);
    }
  }
  for (const layer of map.getStyle().layers) {
    if (layer.id.startsWith("_route-points-") && layer.type === "symbol") {
      map.setPaintProperty(layer.id, "icon-opacity", opacity);
    }
  }
}

// Apply on theme change and after style reloads (when layers are re-added)
onSettingsChange((s) => applyOverlayDimming(s.displayTheme));
chartManager.map.on("style.load", () => {
  // Defer until layers are re-added after style load
  chartManager.map.once("idle", () =>
    applyOverlayDimming(getSettings().displayTheme),
  );
});
