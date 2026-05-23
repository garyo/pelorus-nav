import { Capacitor } from "@capacitor/core";
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
import { LightSectorLayer } from "./chart/LightSectorLayer";
import { PelLightLayer } from "./chart/PelLightLayer";
import { SafetyContour } from "./chart/SafetyContour";
import { repairTrackPointCounts } from "./data/db";
import { downloadFile } from "./data/file-io";
import { OPFSSource } from "./data/opfs-source";
import { chartAssetBase } from "./data/remote-url";
import { loadAllSearchIndices, type SearchEntry } from "./data/search-index";
import { getChartFile, listStoredCharts } from "./data/tile-store";
import { BearingLine } from "./map/BearingLine";
import { MeasurementLayer } from "./map/MeasurementLayer";
import { PlottingLayer } from "./map/plotting/PlottingLayer";
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
import { gpsDiagLog } from "./navigation/GPSDiagnosticLog";
import { RegionAutoSwitch } from "./navigation/RegionAutoSwitch";
import { getSettings, onSettingsChange, updateSettings } from "./settings";
import { AboutDialog } from "./ui/AboutDialog";
import { CancelNavButton } from "./ui/CancelNavButton";
import { CenterCrosshair } from "./ui/CenterCrosshair";
import { ChartCachePanel } from "./ui/ChartCachePanel";
import { createContextMenu } from "./ui/ContextMenu";
import { createInstrumentHUD, INSTRUMENTS } from "./ui/InstrumentHUD";
import {
  iconGauge,
  iconGlobe,
  iconInfo,
  iconMaximize,
  iconMinimize,
  iconPin,
  iconPlot,
  iconRecord,
  iconRoute,
  iconSearch,
  iconTrack,
  setIcon,
} from "./ui/icons";
import { NavigationHUD } from "./ui/NavigationHUD";
import { trackInstrumentHUD } from "./ui/PanelStack";
import { RecenterButton } from "./ui/RecenterButton";
import { RouteManagerPanel } from "./ui/RouteManagerPanel";
import { maybeShowScreenTimeoutWarning } from "./ui/ScreenTimeoutDialog";
import { SearchDialog } from "./ui/SearchDialog";
import { createSettingsPanel } from "./ui/SettingsPanel";
import { TrackManagerPanel } from "./ui/TrackManagerPanel";
import { buildTopbarAction } from "./ui/topbarButton";
import { WakeLockController } from "./ui/WakeLock";
import { WaypointManagerPanel } from "./ui/WaypointManagerPanel";
import { applyDeclination, bearingModeLabel } from "./utils/magnetic";
import { createThermalMonitor } from "./utils/thermal";
import { convertSpeed, speedUnitLabel } from "./utils/units";
import { ChartModeController } from "./vessel/ChartMode";
import { CourseLine } from "./vessel/CourseLine";
import { VesselLayer } from "./vessel/VesselLayer";

// On Capacitor, unregister any stale service workers left from previous installs.
// The SW is disabled for Capacitor builds (assets are bundled locally) but devices
// that ran older builds may still have a cached SW serving stale JS.
if (Capacitor.isNativePlatform() && "serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const reg of registrations) {
      reg.unregister();
    }
    if (registrations.length > 0) {
      console.log(
        `Unregistered ${registrations.length} stale service worker(s)`,
      );
    }
  });
}

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
    if (raw)
      return JSON.parse(raw) as { center: [number, number]; zoom: number };
  } catch {
    /* ignore */
  }
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

// Safety contour — bolds the shallowest depth contour >= safetyDepth
new SafetyContour(chartManager.map);

// Persist map position on every move so refresh restores it
chartManager.map.on("moveend", () => {
  const c = chartManager.map.getCenter();
  localStorage.setItem(
    MAP_POS_KEY,
    JSON.stringify({
      center: [c.lng, c.lat],
      zoom: chartManager.map.getZoom(),
    }),
  );
});

// Watches CPU/thermal pressure via the Compute Pressure API; falls back to
// "nominal" on browsers that don't expose `PressureObserver`. Drives both
// the throttle below and the HUD indicator (see NavigationHUD).
const thermalMonitor = createThermalMonitor();

// Repaint throttle. Caps idle/steady-state rendering to save battery on
// long passages — the course smoother is dt-aware, so visible motion
// stays equally smooth at a lower frame rate. Gestures bypass the cap
// (see the e-ink pinch-overshoot fix that originally added this).
//   - E-ink: 250 ms (4 fps) to reduce ghosting.
//   - Thermal serious/critical: 200 ms (5 fps) to let the SoC cool down.
//   - Everything else: 100 ms (10 fps), responsive enough for the start
//     of a turn while saving ~50× of the GPU work between GPS fixes
//     vs. an uncapped 60 fps animation loop.
const FRAME_INTERVAL_EINK = 250;
const FRAME_INTERVAL_HOT = 200;
const FRAME_INTERVAL_STEADY = 100;
{
  const map = chartManager.map;
  const originalTriggerRepaint = map.triggerRepaint.bind(map);
  let lastFrameTime = 0;
  let pendingFrame: ReturnType<typeof setTimeout> | null = null;

  const throttledRepaint = () => {
    // During gestures (pinch/pan/rotate) and the inertia that follows,
    // run at full rate so the user sees what they're doing — otherwise
    // incremental deltas pile up in MapLibre's _changes queue and the
    // accumulated motion lands all at once (overshooting zoom limits, etc).
    if (map.isMoving() || map.isZooming() || map.isRotating()) {
      if (pendingFrame) {
        clearTimeout(pendingFrame);
        pendingFrame = null;
      }
      lastFrameTime = performance.now();
      originalTriggerRepaint();
      return;
    }
    const thermalState = thermalMonitor.getState();
    const isHot = thermalState === "serious" || thermalState === "critical";
    const interval =
      getSettings().displayTheme === "eink"
        ? FRAME_INTERVAL_EINK
        : isHot
          ? FRAME_INTERVAL_HOT
          : FRAME_INTERVAL_STEADY;
    const now = performance.now();
    const elapsed = now - lastFrameTime;
    if (elapsed >= interval) {
      lastFrameTime = now;
      originalTriggerRepaint();
    } else if (!pendingFrame) {
      pendingFrame = setTimeout(() => {
        pendingFrame = null;
        lastFrameTime = performance.now();
        originalTriggerRepaint();
      }, interval - elapsed);
    }
  };
  map.triggerRepaint = throttledRepaint;
}

new FeatureQueryHandler(chartManager);

// Light sector arcs and range circles (client-side generated from LIGHTS data)
new LightSectorLayer(chartManager.map);

// PEL / directional light cluster rendering (fans stacked teardrops,
// filters duplicate labels, shows parent OBJNAM at high zoom).
new PelLightLayer(chartManager.map);

// Settings gear in top bar menu
const topbarMenu = document.getElementById("topbar-menu");
const topbarActions = document.getElementById("topbar-actions");
const settingsHandle = topbarMenu
  ? createSettingsPanel(topbarMenu, {
      chartProviders: {
        list: chartManager.getProviders().map((p) => ({
          id: p.id,
          name: p.name,
        })),
        getActiveId: () => chartManager.getActiveProvider()?.id ?? "",
        setActive: (id) => chartManager.setActiveProvider(id),
      },
    })
  : null;

// Hamburger toggle for mobile
const hamburgerBtn = document.getElementById("hamburger-btn");
const closeHamburger = () => topbarMenu?.classList.remove("open");
if (hamburgerBtn && topbarMenu) {
  hamburgerBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    // If settings is open, just close it (don't open the menu)
    if (settingsHandle?.isOpen()) {
      settingsHandle.hide();
      return;
    }
    topbarMenu.classList.toggle("open");
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
let capacitorGPS: CapacitorGPSProvider | null = null;
if (CapacitorGPSProvider.isAvailable()) {
  capacitorGPS = new CapacitorGPSProvider();
  navManager.registerProvider(capacitorGPS);
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

// Chart-mode toggle in the bottom-left. The icon reflects the current
// mode (free / follow / course-up / north-up) and tapping cycles through.
const recenterBtn = new RecenterButton({
  getMode: () => chartMode.getMode(),
  recenter: () => chartMode.recenter(),
  setMode: (m) => chartMode.setMode(m),
});
chartManager.map.addControl(recenterBtn, "bottom-left");
chartMode.onModeChange(() => recenterBtn.refresh());
recenterBtn.setEnabled(false); // until first GPS fix arrives

// Course line (projected COG line)
const courseLine = new CourseLine(chartManager.map);

// Wire navigation data to vessel layer and feed course smoother
let lastNavData: NavigationData | null = null;
navManager.subscribe((data) => {
  lastNavData = data;
  vesselLayer.update(data); // initial position update; smoothed rotation applied per-frame
  // Also feed chartMode every fix (not just when smoothed is available),
  // so it has a last-known position to centre on when the user is
  // stationary — otherwise tapping the mode-toggle button does nothing
  // until COG/SOG become valid.
  chartMode.update(data);
  courseSmoother.addSample(
    data.cog,
    data.sog,
    data.latitude,
    data.longitude,
    data.timestamp,
  );
  // Diagnostic: log the smoothed values then commit the entry
  const smoothedSnap = courseSmoother.smooth(performance.now());
  if (smoothedSnap) {
    gpsDiagLog.logSmoothed(smoothedSnap.sog, smoothedSnap.cog);
  }
  gpsDiagLog.commit();
  // On e-ink, scale smoothing window with the adaptive interval
  if (getSettings().displayTheme === "eink") {
    courseSmoother.setBufferWindow(
      navManager.getAdaptiveState().intervalMs * 5,
    );
  }
  chartManager.map.triggerRepaint();

  // First fix arrived → recenter button can do its job.
  recenterBtn.setEnabled(true);
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
  vesselLayer.update(lastNavData, smoothed);
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
  navManager.setFilterMode(s.gpsFilterMode);
  applyGpsRateForTheme(s.displayTheme);
  wakeLockCtrl.setMode(s.wakeLock);
  wakeLockCtrl.setGpsActive(s.gpsSource !== "none");
  wakeLockCtrl.setEinkMode(s.displayTheme === "eink");
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

// Search dialog for chart features
const searchDialog = new SearchDialog(chartManager.map);
// Cache the merged search entries so other features (waypoint auto-naming)
// can read them synchronously without re-loading.
let cachedSearchEntries: SearchEntry[] = [];
loadAllSearchIndices().then((entries) => {
  cachedSearchEntries = entries;
  searchDialog.setEntries(entries);
});
const getSearchEntries = (): SearchEntry[] => cachedSearchEntries;

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
navManager.setFilterMode(initGpsSettings.gpsFilterMode);

// Feed the detector's quality score into the course smoother so its tau
// and (non-e-ink) buffer window scale with detected GPS quality.
navManager.onQualityChange((q) => courseSmoother.setQuality(q));

/**
 * Non-e-ink: lock GPS to fast (2s) updates — screen power dwarfs GPS.
 * E-ink: use adaptive rate but widen the smoothing window to hold ~5
 * samples at whatever interval the adaptive controller selects.
 */
function applyGpsRateForTheme(theme: string): void {
  const isEink = theme === "eink";
  navManager.forceFastRate = !isEink;
  if (isEink) {
    const intervalMs = navManager.getAdaptiveState().intervalMs;
    courseSmoother.setBufferWindow(intervalMs * 5);
  } else {
    // Non-e-ink: clear any explicit override so the quality-driven default
    // (5s at q=0 → 25s at q=1) applies.
    courseSmoother.setBufferWindow(0);
  }
}
applyGpsRateForTheme(initGpsSettings.displayTheme);

/**
 * Slow MapLibre's pinch-zoom rate on e-ink. The device's slow visual
 * feedback (~4 fps) makes it easy to over-pinch: the user keeps zooming
 * because they can't see the result yet. Halving the gesture-to-zoom
 * ratio gives them room to react. Default (1) restored for other themes.
 */
function applyTouchZoomForTheme(theme: string): void {
  const rate = theme === "eink" ? 0.5 : undefined;
  chartManager.map.touchZoomRotate.setZoomRate(rate);
}
applyTouchZoomForTheme(initGpsSettings.displayTheme);
onSettingsChange((s) => applyTouchZoomForTheme(s.displayTheme));

// Screen wake lock
const wakeLockCtrl = new WakeLockController();
wakeLockCtrl.setMode(initGpsSettings.wakeLock);
wakeLockCtrl.setGpsActive(initGpsSettings.gpsSource !== "none");
wakeLockCtrl.setEinkMode(initGpsSettings.displayTheme === "eink");

// Activate initial GPS source from settings
navManager.setActiveProvider(initGpsSettings.gpsSource);

// Auto-switch active region based on GPS position
new RegionAutoSwitch(navManager);

// Ctrl+F / Cmd+F: open search dialog
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "f") {
    e.preventDefault();
    searchDialog.toggle();
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

// One-shot repair: re-sync track meta pointCounts with stored points,
// fixing stale/zero counts left by an earlier race condition. Gated by
// localStorage so it only runs once per device. Recording is started
// after repair completes to avoid concurrent writes to the same meta.
const TRACK_REPAIR_FLAG = "pelorus-nav-track-counts-repaired-v1";
(async () => {
  if (!localStorage.getItem(TRACK_REPAIR_FLAG)) {
    try {
      const { scanned, repaired } = await repairTrackPointCounts();
      console.log(`Track meta repair: ${repaired}/${scanned} updated`);
      localStorage.setItem(TRACK_REPAIR_FLAG, "1");
    } catch (e) {
      console.error("Track meta repair failed:", e);
    }
  }
  if (getSettings().trackRecordingEnabled) trackRecorder.start();
})();

// Capacitor power management: a single visibility/recording-driven state
// machine that picks between "active" (fast, every fix to JS) and
// "passive" (slow, bridge-silenced, wake-lock-toggled) GPS modes. Both
// modes request HIGH_ACCURACY with setWaitForAccurateLocation(true) so
// FLP only delivers real GPS fixes, never cell-tower / WiFi fallbacks.
//
// Visible:                  active mode at the chosen rate (1 s normally,
//                           5 s in e-ink theme since the panel can't update
//                           faster anyway).
// Hidden + recording:       grace 60 s at the previous active rate, then
//                           passive at 15 s (extends to 30 s on steady
//                           course via SteadinessTracker). Snap back to
//                           active on visible.
// Hidden + not recording:   stop the native GPS entirely.
if (capacitorGPS) {
  const HIDDEN_GRACE_MS = 60_000;
  const PASSIVE_INTERVAL_MS = 15_000;
  const ACTIVE_INTERVAL_MS = 1_000;
  const EINK_ACTIVE_INTERVAL_MS = 5_000;

  const activeIntervalForCurrentTheme = () =>
    getSettings().displayTheme === "eink"
      ? EINK_ACTIVE_INTERVAL_MS
      : ACTIVE_INTERVAL_MS;

  const applyGpsPowerMode = () => {
    if (!capacitorGPS) return;
    const visible = document.visibilityState === "visible";
    const recording = trackRecorder.isRecording();

    if (visible) {
      // Service may have been stopped (hidden+!recording branch) — startTracking
      // is idempotent when already running, and setPowerMode("active") below
      // cancels any pending native grace timer.
      capacitorGPS.resumeTracking();
      capacitorGPS.setPowerMode("active", activeIntervalForCurrentTheme());
      return;
    }
    if (recording) {
      // Schedule passive on the native side. JS setTimeout is throttled or
      // suspended when the WebView is hidden, so the timer has to live in
      // native land or it will never fire.
      capacitorGPS.setPowerMode(
        "passive",
        PASSIVE_INTERVAL_MS,
        HIDDEN_GRACE_MS,
      );
      return;
    }
    capacitorGPS.pauseTracking();
  };

  document.addEventListener("visibilitychange", applyGpsPowerMode);
  trackRecorder.onRecordingChange(applyGpsPowerMode);
  // Theme changes (e-ink ⇄ normal) re-apply the mode so the active interval updates.
  onSettingsChange((s) => {
    void s;
    if (document.visibilityState === "visible") applyGpsPowerMode();
  });

  // Initial state at boot: visible.
  applyGpsPowerMode();
}

// --- Routes ---
const routeLayer = new RouteLayer(chartManager.map);
const routeEditor = new RouteEditor(chartManager.map, routeLayer);
routeEditor.setSearchEntriesProvider(getSearchEntries);
const routePanel = new RouteManagerPanel(routeLayer, routeEditor);

// --- Waypoints + Active Navigation ---
const activeNav = new ActiveNavigationManager(navManager);
const waypointLayer = new WaypointLayer(chartManager.map);
const navHud = new NavigationHUD(
  chartManager.map,
  navManager,
  waypointLayer,
  thermalMonitor,
);
new CenterCrosshair(chartManager.map, navHud.getCursorCoordsEl());
new BearingLine(chartManager.map, activeNav, navManager);
const waypointPanel = new WaypointManagerPanel(waypointLayer, activeNav);
routePanel.setActiveNav(activeNav);
routePanel.setWaypointLayer(waypointLayer);

// --- Context menu (right-click on map) ---
const plottingLayer = new PlottingLayer(chartManager.map);
const measurementLayer = new MeasurementLayer(chartManager.map);
createContextMenu({
  map: chartManager.map,
  routeEditor,
  waypointLayer,
  plottingLayer,
  measurementLayer,
  activeNav,
  onWaypointAdded: () => waypointPanel.show(),
  getSearchEntries,
});

// Cancel navigation control
const cancelNavBtn = new CancelNavButton(activeNav);
chartManager.map.addControl(cancelNavBtn, "bottom-left");

// Register nav-mode instruments (before restore so HUD is ready)
INSTRUMENTS.set("brg", {
  id: "brg",
  label: "Bearing to wpt",
  shortLabel: "BRG",
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
  shortLabel: "DTW",
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

INSTRUMENTS.set("vmg", {
  id: "vmg",
  label: "Velocity made good",
  shortLabel: "VMG",
  format(_data, settings) {
    const info = activeNav.getInfo();
    const unit = speedUnitLabel(settings.speedUnit);
    if (!info || info.vmgKn == null) return { value: "--", unit };
    const v = info.vmgKn;
    const display =
      v < 0
        ? -convertSpeed(-v, settings.speedUnit)
        : convertSpeed(v, settings.speedUnit);
    return { value: display.toFixed(1), unit };
  },
});

INSTRUMENTS.set("steer", {
  id: "steer",
  label: "Steer",
  shortLabel: "STEER",
  format() {
    const info = activeNav.getInfo();
    if (!info || info.steerDeg == null) return { value: "--", unit: "" };
    const d = info.steerDeg;
    if (Math.abs(d) < 1) return { value: "0\u00b0", unit: "" };
    const mag = Math.round(Math.abs(d));
    return d < 0
      ? { value: `\u2190 ${mag}\u00b0`, unit: "" }
      : { value: `${mag}\u00b0 \u2192`, unit: "" };
  },
});

// Wire HUD to show BRG/DTW cells during active navigation
instrumentHUD.setActiveNav(activeNav);
instrumentHUD.onNavCellClick(() => routePanel.showActiveRoute());

// Restore persisted navigation state (after all subscribers are wired up)
await activeNav.restore();

if (topbarActions) {
  // Record track toggle
  const recordBtn = buildTopbarAction(iconRecord, "REC", "Record track", {
    extraClass: "topbar-record",
  });
  const updateRecordBtn = () => {
    const on = trackRecorder.isRecording();
    recordBtn.classList.toggle("active", on);
    const t = on ? "Stop recording" : "Record track";
    recordBtn.title = t;
    recordBtn.setAttribute("aria-label", t);
  };
  recordBtn.addEventListener("click", () => {
    updateSettings({ trackRecordingEnabled: !trackRecorder.isRecording() });
  });
  trackRecorder.onRecordingChange(updateRecordBtn);
  updateRecordBtn();
  topbarActions.appendChild(recordBtn);

  // Instrument HUD toggle
  const hudBtn = buildTopbarAction(iconGauge, "INST", "Instruments");
  const updateHudBtn = () => {
    hudBtn.classList.toggle("active", getSettings().showInstrumentHUD);
  };
  hudBtn.addEventListener("click", () => {
    updateSettings({ showInstrumentHUD: !getSettings().showInstrumentHUD });
  });
  onSettingsChange(updateHudBtn);
  updateHudBtn();
  topbarActions.appendChild(hudBtn);

  // Tracks panel button
  const trackBtn = buildTopbarAction(iconTrack, "TRK", "Tracks");
  trackBtn.addEventListener("click", () => {
    trackPanel.toggle();
    settingsHandle?.hide();
  });
  topbarActions.appendChild(trackBtn);

  // Routes panel button
  const routeBtn = buildTopbarAction(iconRoute, "RTE", "Routes");
  routeBtn.addEventListener("click", () => {
    routePanel.toggle();
    settingsHandle?.hide();
  });
  topbarActions.appendChild(routeBtn);
}

// Remaining toolbar buttons live in the hamburger menu (collapse on mobile).
if (topbarMenu) {
  const settingsWrapper = topbarMenu.querySelector(".settings-wrapper");

  // Waypoints panel button
  const waypointBtn = buildTopbarAction(iconPin, "WPT", "Waypoints", {
    fullLabel: "Waypoints",
  });
  waypointBtn.addEventListener("click", () => {
    waypointPanel.toggle();
    settingsHandle?.hide();
    closeHamburger();
  });
  topbarMenu.insertBefore(waypointBtn, settingsWrapper);

  // Plot mode button
  const plotBtn = buildTopbarAction(iconPlot, "PLOT", "Plot", {
    fullLabel: "Plot",
  });
  plotBtn.addEventListener("click", () => {
    plottingLayer.enterPlotMode();
    closeHamburger();
  });
  topbarMenu.insertBefore(plotBtn, settingsWrapper);

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
  const cacheBtn = buildTopbarAction(iconGlobe, "RGNS", "Chart Regions", {
    fullLabel: "Chart Regions",
  });
  cacheBtn.addEventListener("click", () => {
    cachePanel.toggle();
    settingsHandle?.hide();
    closeHamburger();
  });
  topbarMenu.insertBefore(cacheBtn, settingsWrapper);

  // Search button
  const searchBtn = buildTopbarAction(iconSearch, "FIND", "Search", {
    fullLabel: "Search",
  });
  searchBtn.addEventListener("click", () => {
    searchDialog.show();
    closeHamburger();
  });
  topbarMenu.insertBefore(searchBtn, settingsWrapper);

  // Close manager panels when settings opens
  settingsHandle?.onOpen(() => {
    trackPanel.hide();
    routePanel.hide();
    waypointPanel.hide();
    cachePanel.hide();
    closeHamburger();
  });

  // Fullscreen toggle
  const fullscreenBtn = buildTopbarAction(iconMaximize, "FULL", "Fullscreen", {
    fullLabel: "Fullscreen",
  });
  const updateFullscreenBtn = () => {
    const isFs = !!document.fullscreenElement;
    fullscreenBtn.classList.toggle("active", isFs);
    setIcon(fullscreenBtn, isFs ? iconMinimize : iconMaximize);
    const t = isFs ? "Exit fullscreen" : "Fullscreen";
    fullscreenBtn.title = t;
    fullscreenBtn.setAttribute("aria-label", t);
    const fullSpan = fullscreenBtn.querySelector(".topbar-menu-label");
    if (fullSpan) fullSpan.textContent = t;
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

  // About button
  const aboutDialog = new AboutDialog();
  const aboutBtn = buildTopbarAction(iconInfo, "INFO", "About", {
    fullLabel: "About",
  });
  aboutBtn.addEventListener("click", () => {
    aboutDialog.toggle();
    closeHamburger();
  });
  topbarMenu.insertBefore(aboutBtn, settingsWrapper);
}

// Warn the user once if the OS screen-off timeout is too short for marine
// use — see ScreenTimeoutDialog for the e-ink BIGME diagnosis that motivated
// this. Fires after the UI is up so the dialog appears on top.
maybeShowScreenTimeoutWarning().catch(console.error);

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
      id === "_bearing-line-target" ||
      id.startsWith("_plot-");

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

// ── GPS diagnostic logging ─────────────────────────────────────────
// Expose on window for console/adb access:
//   gpsDiag.start()          — begin recording
//   gpsDiag.stop()           — stop recording
//   gpsDiag.entryCount       — number of entries
//   gpsDiag.download()       — download CSV via share/file save
//   gpsDiag.csv()            — return CSV string (for console copy)
const gpsDiag = {
  start: () => gpsDiagLog.start(),
  stop: () => gpsDiagLog.stop(),
  get entryCount() {
    return gpsDiagLog.entryCount;
  },
  csv: () => gpsDiagLog.toCSV(),
  download: () => {
    const csv = gpsDiagLog.toCSV();
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    downloadFile(csv, `gps-diag-${ts}.csv`, "text/csv");
  },
  clear: () => gpsDiagLog.clear(),
};
Object.assign(window, { gpsDiag });
// To enable: run gpsDiag.start() in the browser console or Chrome DevTools.
