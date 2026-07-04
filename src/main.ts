// FIRST import: installs global JS error capture before any other module
// evaluates, so even module-init crashes land in the persistent error log.
import "./diagnostics/errorCaptureBoot";
import { Capacitor } from "@capacitor/core";
import { addProtocol } from "maplibre-gl";
import { BackgroundGPS } from "./plugins/BackgroundGPS";
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
import {
  basemapRegionsFromFilenames,
  setStoredBasemaps,
} from "./chart/basemap-underlay";
import { LightSectorLayer } from "./chart/LightSectorLayer";
import { registerOSMTileProtocol } from "./chart/osm-tile-cache";
import { PelLightLayer } from "./chart/PelLightLayer";
import {
  rasterChartsFromFilenames,
  setStoredRasterCharts,
} from "./chart/raster-charts";
import { SafetyContour } from "./chart/SafetyContour";
import { getNauticalLayers } from "./chart/styles";
import {
  getStreamingVersions,
  refreshStreamingVersions,
} from "./data/chart-update-checker";
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
import { TrackViewerLayer } from "./map/TrackViewerLayer";
import { WaypointLayer } from "./map/WaypointLayer";
import {
  BLENMEAProvider,
  BrowserGeolocationProvider,
  CapacitorBLENMEAProvider,
  CapacitorGPSProvider,
  hasSatelliteDiagnostics,
  type NavigationData,
  NavigationDataManager,
  SignalKProvider,
  SimulatorProvider,
  WebSerialNMEAProvider,
} from "./navigation";
import { ActiveNavigationManager } from "./navigation/ActiveNavigation";
import type { BleNotice } from "./navigation/CapacitorBLENMEAProvider";
import { connectionLog } from "./navigation/ConnectionEventLog";
import {
  CourseSmoothing,
  einkBufferWindowMs,
} from "./navigation/CourseSmoothing";
import { gpsDiagLog } from "./navigation/GPSDiagnosticLog";
import { GpsPowerManager } from "./navigation/GpsPowerManager";
import { RegionAutoSwitch } from "./navigation/RegionAutoSwitch";
import { REPLAY_TRACK } from "./navigation/replay-track";
import {
  BOSTON_HARBOR_ROUTE,
  type SimulatorOptions,
} from "./navigation/SimulatorProvider";
import type { TopbarRegistrar } from "./plugins/host";
import { LegendHost } from "./plugins/legend";
import { BUILTIN_PLUGINS } from "./plugins/manifest";
import { PluginManager } from "./plugins/PluginManager";
import { PickRegistry } from "./plugins/picking";
import { getSettings, onSettingsChange, updateSettings } from "./settings";
import { AboutDialog } from "./ui/AboutDialog";
import { startAppUpdateNotifier } from "./ui/AppUpdateNotifier";
import { CancelNavButton } from "./ui/CancelNavButton";
import { CenterCrosshair } from "./ui/CenterCrosshair";
import { ChartCachePanel } from "./ui/ChartCachePanel";
import { ChartInUseReadout } from "./ui/ChartInUseReadout";
import { startChartUpdateNotifier } from "./ui/ChartUpdateNotifier";
import { ConnectionLogPanel } from "./ui/ConnectionLogPanel";
import { createContextMenu } from "./ui/ContextMenu";
import { createIdleDetector } from "./ui/IdleDetector";
import { createInstrumentHUD, INSTRUMENTS } from "./ui/InstrumentHUD";
import {
  iconClock,
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
import { SatelliteStatusPanel } from "./ui/SatelliteStatusPanel";
import { maybeShowScreenTimeoutWarning } from "./ui/ScreenTimeoutDialog";
import { SearchDialog } from "./ui/SearchDialog";
import { createSettingsPanel } from "./ui/SettingsPanel";
import { hideStatusBanner, showStatusBanner } from "./ui/StatusBanner";
import { TimeBar } from "./ui/TimeBar";
import { TrackManagerPanel } from "./ui/TrackManagerPanel";
import { TrackViewerPanel } from "./ui/TrackViewerPanel";
import { buildTopbarAction } from "./ui/topbarButton";
import { WakeLockController } from "./ui/WakeLock";
import { WaypointManagerPanel } from "./ui/WaypointManagerPanel";
import { diag } from "./utils/diag";
import { applyDeclination, bearingModeLabel } from "./utils/magnetic";
import { createThermalMonitor } from "./utils/thermal";
import { convertSpeed, speedUnitLabel } from "./utils/units";
import { ChartModeController } from "./vessel/ChartMode";
import { CourseLine } from "./vessel/CourseLine";
import { type CourseSnapshot, courseChanged } from "./vessel/course-gate";
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

// On the web PWA, register the service worker and offer a reload when a
// new build is available (no-op stub in Capacitor builds).
startAppUpdateNotifier();

// Register PMTiles protocol for vector tile sources
const protocol = new Protocol({ metadata: true });
addProtocol("pmtiles", protocol.tilev4);

// Track which protocol entries are backed by OPFS files. A deleted chart's
// entry must be REMOVED from the protocol — a stale entry serves an
// OPFSSource over a deleted File (whose slice() rejects), so the region
// renders blank until reload. With the key absent, the protocol auto-creates
// a streaming FetchSource from the key URL — the correct fallback.
const offlineProtocolKeys = new Set<string>();
async function registerOfflineChart(filename: string): Promise<void> {
  const file = await getChartFile(filename);
  if (!file) return;
  const key = `${chartAssetBase()}/${filename}`;
  protocol.add(new PMTiles(new OPFSSource(file, key)));
  offlineProtocolKeys.add(key);
}
function pruneOfflineCharts(currentFilenames: string[]): void {
  const current = new Set(
    currentFilenames.map((f) => `${chartAssetBase()}/${f}`),
  );
  for (const key of offlineProtocolKeys) {
    if (!current.has(key)) {
      protocol.tiles.delete(key); // next request streams from the key URL
      offlineProtocolKeys.delete(key);
    }
  }
}

// Register the cached OSM tile protocol (offline-capable raster underlay)
registerOSMTileProtocol();

// Load any offline PMTiles from OPFS before creating the map
try {
  const storedCharts = await listStoredCharts();
  for (const chart of storedCharts) {
    await registerOfflineChart(chart.filename);
  }
  setStoredBasemaps(
    basemapRegionsFromFilenames(storedCharts.map((c) => c.filename)),
  );
  setStoredRasterCharts(
    rasterChartsFromFilenames(storedCharts.map((c) => c.filename)),
  );
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

const applyInstrumentLayout = (layout: string) => {
  document.body.dataset.instrumentLayout = layout;
};
applyInstrumentLayout(getSettings().instrumentLayout);
onSettingsChange((s) => applyInstrumentLayout(s.instrumentLayout));

// Create vector chart provider — loads ALL regions simultaneously
const initialRegion = getSettings().activeRegion;
const vectorProvider = new VectorChartProvider(initialRegion);
await vectorProvider.loadAllOfflineCoverage();
// Pin streaming regions to their last-known versions so the HTTP cache
// can't serve stale tile ranges; refreshed against the server below.
vectorProvider.setStreamingVersions(await getStreamingVersions());
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

// Re-pin streaming regions when the server has newer charts. Runs once at
// startup; the daily sweep in ChartUpdateNotifier repeats it for long sessions.
const applyStreamingVersions = async (): Promise<void> => {
  const fresh = await refreshStreamingVersions();
  if (fresh) {
    vectorProvider.setStreamingVersions(fresh);
    chartManager.refreshStyle();
  }
};
applyStreamingVersions().catch(() => {
  // offline — last-known versions stay pinned
});

// Safety contour — bolds the shallowest depth contour >= safetyDepth
new SafetyContour(chartManager.map);

// "Chart in use" readout + overscale badge for the vector/raster quilt.
new ChartInUseReadout(chartManager.map);

// Dev-only: expose the map for browser-harness probes (no-op in prod build).
if (import.meta.env.DEV) {
  (window as unknown as { __map: unknown }).__map = chartManager.map;
}

// Dev-only render harness: with `?testChart=1`, overlay the synthetic S-57 test
// chart (public/test-chart.pmtiles, one MVT source-layer per S-57 class) and
// render it through the REAL nautical styles, so a headless spec can verify
// every feature class produces decent iconography + text.
//
// The test layers are added ON TOP of the live style, tagged with a `test-`
// id prefix and their own `s57-test` source, so a spec can isolate them via
// queryRenderedFeatures(...).filter(f => f.source === "s57-test"). ChartManager
// rebuilds the style (setStyle) on every region-in-view change and on the
// startup streaming-version refresh — which strips anything not in the
// provider's style — so we re-apply on `styledata` (idempotently). The app
// always uses iho-s52 symbology, so the live sprite already matches the test
// layers. No effect on production (gated behind import.meta.env.DEV + URL param).
if (import.meta.env.DEV) {
  const testParams = new URLSearchParams(window.location.search);
  if (testParams.get("testChart") === "1") {
    const TEST_SOURCE_ID = "s57-test";
    const testWindow = window as unknown as { __missingIcons?: string[] };
    testWindow.__missingIcons ??= [];
    const missingIcons = testWindow.__missingIcons;
    chartManager.map.on("styleimagemissing", (e) => {
      missingIcons.push(e.id);
    });

    const ensureTestChart = (): void => {
      const map = chartManager.map;
      let style: ReturnType<typeof map.getStyle>;
      try {
        style = map.getStyle();
      } catch {
        return; // style not ready yet
      }
      if (!style?.layers) return;

      if (!map.getSource(TEST_SOURCE_ID)) {
        map.addSource(TEST_SOURCE_ID, {
          type: "vector",
          tiles: [
            `pmtiles://${window.location.origin}/test-chart.pmtiles/{z}/{x}/{y}`,
          ],
          minzoom: 0,
          maxzoom: 16,
        });
      }
      const s = getSettings();
      // detailOffset 2 → showStandard + showOther so EVERY class's layers build.
      const layers = getNauticalLayers(
        TEST_SOURCE_ID,
        s.depthUnit,
        2,
        s.layerGroups,
        undefined,
        s.displayTheme,
        "iho-s52",
        s.shallowDepth,
        s.safetyDepth,
        s.deepDepth,
        s.textScale,
        s.iconScale,
      );
      for (const layer of layers) {
        // Skip the shared background (its id collides with the live style's).
        if (layer.type === "background") continue;
        const testLayer = { ...layer, id: `test-${layer.id}` };
        if (!map.getLayer(testLayer.id)) map.addLayer(testLayer);
      }
      (window as unknown as { __testChartReady: boolean }).__testChartReady =
        true;
    };

    // `styledata` fires after the initial load AND after every setStyle rebuild
    // (incl. diff:true updates that drop our layers). Idempotent guards above
    // make the re-entrant pass a no-op, so it converges.
    chartManager.map.on("styledata", ensureTestChart);
    ensureTestChart();
  }
}

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
/**
 * E-ink, while tiles/style are still streaming in after a move or settings
 * change: every rendered frame is a full (~1 s) panel refresh, and MapLibre
 * paints each intermediate loading state — the chart visibly redraws 10+
 * times, gaining a few features per flash. Stretching the frame spacing
 * collapses the storm into 2–3 refreshes; loading still progresses each
 * frame, and the moment everything is loaded the normal interval resumes,
 * so the final complete state renders promptly.
 */
const FRAME_INTERVAL_EINK_SETTLING = 1500;
{
  const map = chartManager.map;
  const originalTriggerRepaint = map.triggerRepaint.bind(map);
  let lastFrameTime = 0;
  let pendingFrame: ReturnType<typeof setTimeout> | null = null;
  let pendingDeadline = 0;

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
    // Note: not isStyleLoaded() — the vessel/course-line setData updates
    // keep the style perpetually "dirty", so that flag never settles here.
    const settling = !map.areTilesLoaded();
    const interval =
      getSettings().displayTheme === "eink"
        ? settling
          ? FRAME_INTERVAL_EINK_SETTLING
          : FRAME_INTERVAL_EINK
        : isHot
          ? FRAME_INTERVAL_HOT
          : FRAME_INTERVAL_STEADY;
    const now = performance.now();
    const deadline = lastFrameTime + interval;
    if (now >= deadline) {
      if (pendingFrame) {
        clearTimeout(pendingFrame);
        pendingFrame = null;
      }
      lastFrameTime = now;
      originalTriggerRepaint();
      return;
    }
    // A shorter deadline supersedes a pending longer one (e.g. the last
    // tile just loaded — render the final state now, not in 1.5 s).
    if (pendingFrame && deadline < pendingDeadline) {
      clearTimeout(pendingFrame);
      pendingFrame = null;
    }
    if (!pendingFrame) {
      pendingDeadline = deadline;
      pendingFrame = setTimeout(
        () => {
          pendingFrame = null;
          lastFrameTime = performance.now();
          originalTriggerRepaint();
        },
        Math.max(0, deadline - now),
      );
    }
  };
  map.triggerRepaint = throttledRepaint;
}

// Feature picking: the chart query handler owns the single click handler and a
// unified, cyclable feature-info list. Plugin overlays (tides, …) contribute
// candidates into the same list via this registry, so co-located picks (a tide
// station and a nearby light/buoy) are all reachable with prev/next.
const pickRegistry = new PickRegistry();
const featureQueryHandler = new FeatureQueryHandler(chartManager, pickRegistry);

// Light sector arcs and range circles (client-side generated from LIGHTS data)
new LightSectorLayer(chartManager.map);

// PEL / directional light cluster rendering (fans stacked teardrops,
// filters duplicate labels, shows parent OBJNAM at high zoom).
new PelLightLayer(chartManager.map);

// Navigation manager — created here (providers registered further below) so a
// plugin may contribute nav providers, and so plugins activate before the
// settings panel is built.
const navManager = new NavigationDataManager();

// Activate build-time plugins (Tides & Currents, Weather, …) through the plugin
// host: they register overlays, layer-group toggles, settings controls, data
// assets, and pickables. Must run BEFORE the settings panel is built so those
// plugin contributions appear in it.
// Lets plugins add a top-bar action button (e.g. the Sun plugin's popup)
// without owning any persistent map real estate. Buttons join the hamburger
// menu group (collapses on mobile) and are repositioned just before the
// trailing Full/Info actions once those exist (see below).
const pluginTopbar: TopbarRegistrar = {
  register(action) {
    const btn = buildTopbarAction(action.icon, action.label, action.title, {
      fullLabel: action.fullLabel,
      extraClass: "topbar-plugin-action",
    });
    btn.addEventListener("click", () => action.onSelect());
    const menu = document.getElementById("topbar-menu");
    menu?.insertBefore(btn, menu.querySelector(".settings-wrapper"));
    return {
      setActive: (active) => btn.classList.toggle("active", active),
      remove: () => btn.remove(),
    };
  },
};

const pluginManager = new PluginManager({
  map: chartManager.map,
  chartManager,
  navManager,
  picks: pickRegistry,
  legends: new LegendHost(chartManager.map.getContainer()),
  topbar: pluginTopbar,
  suppressPick: (fn) => featureQueryHandler.addPickSuppressor(fn),
});
for (const plugin of BUILTIN_PLUGINS) pluginManager.register(plugin);
pluginManager.activateAll();

// Settings gear in top bar menu
const topbarMenu = document.getElementById("topbar-menu");
const topbarActions = document.getElementById("topbar-actions");
const satellitePanel = new SatelliteStatusPanel();
const connectionLogPanel = new ConnectionLogPanel();
// The concrete BLE provider instance (assigned at registration below) — the
// settings panel's Change… button and the banner actions need its
// pickNewDevice/promptEnableBluetooth, which NavigationDataProvider omits.
let bleProvider: CapacitorBLENMEAProvider | BLENMEAProvider | null = null;
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
      gpsLink: {
        isConnected: () =>
          navManager.getActiveProvider()?.isConnected() ?? false,
        isReconnecting: () =>
          navManager.getActiveProvider()?.isReconnecting?.() ?? false,
        reconnect: () => navManager.reconnectActiveProvider(),
        reset: () => navManager.resetActiveProvider(),
        changeDevice: () => {
          void bleProvider?.pickNewDevice();
        },
      },
      openSatelliteDiagnostics: () => {
        const provider = navManager.getActiveProvider();
        if (provider && hasSatelliteDiagnostics(provider)) {
          satellitePanel.show(provider, navManager);
        }
      },
      openConnectionLog: () => connectionLogPanel.show(),
    })
  : null;

// Dialogs/panels that the idle auto-return closes. Each is pushed at its
// creation site below; the idle handler reads the populated list when it fires.
const idleCloseables: Array<{ hide(): void }> = [];
if (settingsHandle) idleCloseables.push(settingsHandle);
idleCloseables.push(satellitePanel);
// The feature-info popup (chart + merged plugin candidates) counts as a
// dialog for auto-return.
idleCloseables.push(featureQueryHandler);

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

// Clicking the map to dismiss an open click-outside panel (Settings, or the
// mobile topbar menu) shouldn't also register a chart pick — almost never the
// intent. (The Regions panel doesn't close on outside click, so it's unaffected.)
if (settingsHandle) {
  featureQueryHandler.addPickSuppressor(() => settingsHandle.isOpen());
}
if (topbarMenu) {
  featureQueryHandler.addPickSuppressor(() =>
    topbarMenu.classList.contains("open"),
  );
}

// --- Navigation system ---

/**
 * Parse a `?simStart=lat,lon` URL query and, if present, prepend that
 * coordinate to the simulator's default route so the sim boat begins
 * its trip there. Useful for verifying nav-resume behaviour from
 * arbitrary positions without editing code. Returns undefined (→
 * default sim options) when the param is missing or malformed.
 *
 * Example:
 *   http://localhost:5173/?simStart=42.334504,-70.968894
 */
function buildSimulatorOptions(): Partial<SimulatorOptions> {
  try {
    const raw = new URLSearchParams(window.location.search).get("simStart");
    // Default: replay a real recorded sail — true turn rates and speed
    // changes exercise the GPS pipeline far better than the synthetic loop.
    if (!raw) return { mode: "replay", track: REPLAY_TRACK };
    const m = raw.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (!m) {
      console.warn("simStart: expected lat,lon — got", raw);
      return { mode: "replay", track: REPLAY_TRACK };
    }
    const lat = Number(m[1]);
    const lon = Number(m[2]);
    if (
      Number.isNaN(lat) ||
      Number.isNaN(lon) ||
      Math.abs(lat) > 90 ||
      Math.abs(lon) > 180
    ) {
      console.warn("simStart: out-of-range lat/lon", lat, lon);
      return { mode: "replay", track: REPLAY_TRACK };
    }
    console.log(`simStart override: simulator boat begins at (${lat}, ${lon})`);
    // Prepend to the default loop. The boat starts at simStart and
    // continues to the harbour loop's first waypoint, then cycles.
    return { waypoints: [[lat, lon], ...BOSTON_HARBOR_ROUTE] };
  } catch (e) {
    console.warn("simStart parse failed:", e);
    return { mode: "replay", track: REPLAY_TRACK };
  }
}

// Register available GPS providers
const simulator = new SimulatorProvider(buildSimulatorOptions());
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
// BLE NUS GPS pod ("ble-nmea"): native builds use the Capacitor plugin (the
// Android WebView has no Web Bluetooth); the web/PWA uses Web Bluetooth.
// Both surface connection conditions (Bluetooth off, picker cancelled,
// connect failed) through persistent status banners — a silent BLE failure
// on the water is a navigation hazard.
connectionLog.setMirror((e) =>
  diag("conn", `${e.src} ${e.type}${e.detail ? ` ${e.detail}` : ""}`),
);
function handleBleNotice(notice: BleNotice): void {
  switch (notice.kind) {
    case "bt-off":
      showStatusBanner({
        id: "ble-bt",
        message: "Bluetooth is OFF — GPS pod unreachable",
        actionLabel: Capacitor.isNativePlatform() ? "Turn On" : undefined,
        onAction: Capacitor.isNativePlatform()
          ? () => {
              void (
                bleProvider as CapacitorBLENMEAProvider
              )?.promptEnableBluetooth();
            }
          : undefined,
      });
      break;
    case "bt-on":
      hideStatusBanner("ble-bt");
      break;
    case "connected":
      hideStatusBanner("ble-bt");
      hideStatusBanner("ble-pick");
      hideStatusBanner("ble-conn");
      break;
    case "picker-cancelled":
      showStatusBanner({
        id: "ble-pick",
        message: "No Bluetooth GPS chosen — GPS not connected",
        actionLabel: "Choose…",
        onAction: () => {
          hideStatusBanner("ble-pick");
          navManager.reconnectActiveProvider();
        },
      });
      break;
    case "connect-failed":
      showStatusBanner({
        id: "ble-conn",
        message: `Bluetooth GPS not connected — ${notice.detail}`,
        actionLabel: "Retry",
        onAction: () => {
          hideStatusBanner("ble-conn");
          navManager.reconnectActiveProvider();
        },
      });
      break;
  }
}
if (Capacitor.isNativePlatform()) {
  bleProvider = new CapacitorBLENMEAProvider(handleBleNotice);
  navManager.registerProvider(bleProvider);
} else if (BLENMEAProvider.isAvailable()) {
  bleProvider = new BLENMEAProvider(handleBleNotice);
  navManager.registerProvider(bleProvider);
}
const signalK = new SignalKProvider(getSettings().signalkUrl);
navManager.registerProvider(signalK);

// Vessel display layer
const vesselLayer = new VesselLayer(chartManager.map);

// Shared course smoother for damped COG/SOG
const courseSmoother = new CourseSmoothing();

// Chart mode controller (follow, course-up, north-up, free)
const chartMode = new ChartModeController(chartManager.map);

// Chart-mode toggle in the bottom-left. The icon reflects the current
// mode (free / follow / course-up / north-up) and tapping cycles through.
// Recovery: if the view is stranded zoomed way out, snap back to a usable nav
// zoom. Runs on any chart-mode button tap (recenter or mode-cycle) so the user
// can always escape, regardless of the current mode. No-op at normal zooms.
const recoverZoomIfStranded = () => {
  if (chartManager.map.getZoom() < 8) {
    chartManager.map.setZoom(12);
  }
};
const recenterBtn = new RecenterButton({
  getMode: () => chartMode.getMode(),
  recenter: () => {
    chartMode.recenter();
    recoverZoomIfStranded();
  },
  setMode: (m) => {
    chartMode.setMode(m);
    recoverZoomIfStranded();
  },
});
chartManager.map.addControl(recenterBtn, "bottom-left");
chartMode.onModeChange(() => recenterBtn.refresh());
recenterBtn.setEnabled(false); // until first GPS fix arrives

// Course line (projected COG line)
const courseLine = new CourseLine(chartManager.map);

// Native GPS power manager — created later (after the recorder exists);
// declared here so the nav subscription below can forward burst windows.
let gpsPowerManager: GpsPowerManager | null = null;

// Wire navigation data to vessel layer and feed course smoother
let lastNavData: NavigationData | null = null;
navManager.subscribe((data) => {
  lastNavData = data;
  courseSmoother.addSample(
    data.cog,
    data.sog,
    data.latitude,
    data.longitude,
    data.timestamp,
  );

  const isEink = getSettings().displayTheme === "eink";
  if (isEink) {
    // E-ink: no per-frame animation — snap the smoother, and scale its window
    // (clamped — see einkBufferWindowMs) and the native maneuver/stop burst to
    // the adaptive interval.
    courseSmoother.snapToTarget();
    const adaptive = navManager.getAdaptiveState();
    courseSmoother.setBufferWindow(einkBufferWindowMs(adaptive.intervalMs));
    gpsPowerManager?.setBurstUntil(adaptive.burstUntilMs);
  }

  // Diagnostic: log the smoothed values then commit the entry.
  const smoothed = courseSmoother.smooth(performance.now());
  if (smoothed) {
    gpsDiagLog.logSmoothed(smoothed.sog, smoothed.cog);
  }
  gpsDiagLog.commit();

  if (isEink && smoothed) {
    // One atomic update per fix so e-ink does a SINGLE panel refresh: the boat
    // moves and rotates together (and the course line redraws), instead of a
    // position refresh followed a refresh later by the rotation. The render
    // handler is a no-op on e-ink (see below).
    vesselLayer.update(data, smoothed);
    chartMode.update(data, smoothed);
    courseLine.update(data, smoothed);
  } else {
    // Smooth displays (and e-ink before a course exists): update position now;
    // the render loop eases the smoothed rotation/centre per frame. chartMode
    // is fed every fix so it has a last-known position to centre on even while
    // stationary (otherwise the mode-toggle button does nothing until COG/SOG
    // become valid).
    vesselLayer.update(data);
    chartMode.update(data);
  }

  chartManager.map.triggerRepaint();

  // First fix arrived → recenter button can do its job.
  recenterBtn.setEnabled(true);
});

// Per-frame smoothing for fluid course line and map rotation.
// Gated on real change: when the smoothed course has converged (or the fix
// is stale), skip the updates entirely so no source goes dirty and
// MapLibre's render loop reaches `idle` and stops — otherwise the per-frame
// setData calls form a self-sustaining loop that repaints at the throttle
// cap forever, even anchored or with GPS off.
let appliedCourse: CourseSnapshot | null = null;
chartManager.map.on("render", () => {
  if (!lastNavData) return;
  // E-ink updates atomically once per fix (in the subscribe handler above), so
  // each GPS tick is a single panel refresh — nothing to animate here.
  if (getSettings().displayTheme === "eink") return;
  // Stale fix: freeze the vessel at its last drawn state (the HUD already
  // blanks). Skipping smooth() leaves lastSmoothTime stale, so resumption
  // takes the existing dt>=1s snap path in CourseSmoothing.
  if (navManager.isFixStale()) return;
  const smoothed = courseSmoother.smooth(performance.now());
  if (!smoothed) return;
  const next: CourseSnapshot = {
    lat: smoothed.lat,
    lon: smoothed.lon,
    cog: smoothed.cog,
    sog: smoothed.sog,
  };
  if (!courseChanged(appliedCourse, next)) return;
  appliedCourse = next;
  vesselLayer.update(lastNavData, smoothed);
  chartMode.update(lastNavData, smoothed);
  courseLine.update(lastNavData, smoothed);
  // Keep animating while values are still converging.
  chartManager.map.triggerRepaint();
});
// Container resize changes look-ahead padding and auto course-line length —
// invalidate the gate so the next frame re-applies (camera-only change).
chartManager.map.on("resize", () => {
  appliedCourse = null;
});

// React to chart mode changes from settings
onSettingsChange((s) => {
  if (s.chartMode !== chartMode.getMode()) {
    chartMode.setMode(s.chartMode);
  }
  if (s.gpsSource !== navManager.getActiveProvider()?.id) {
    navManager.setActiveProvider(s.gpsSource);
  }
  if (s.gpsSource !== "ble-nmea") {
    // Stale BLE banners must not linger after switching providers.
    hideStatusBanner("ble-bt");
    hideStatusBanner("ble-pick");
    hideStatusBanner("ble-conn");
  }
  simulator.setSpeedMultiplier(s.simulatorSpeed);
  signalK.setUrl(s.signalkUrl);
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

// Search dialog for chart features. Cache the merged entries so other
// features (waypoint auto-naming) can read them synchronously.
const searchDialog = new SearchDialog(chartManager.map);
idleCloseables.push(searchDialog);
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
declare const __APP_VERSION__: string;
declare const __BUILD_ID__: string;
// Persistent boot breadcrumb — each app load (incl. WebView reloads) logs its
// recording-enabled state and GPS source, so a recording that silently stops
// after a reload is visible in the diag log.
diag(
  "boot",
  `v=${__APP_VERSION__} ${__BUILD_ID__} recEnabled=${initGpsSettings.trackRecordingEnabled} gpsSource=${initGpsSettings.gpsSource}`,
);
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
    courseSmoother.setBufferWindow(einkBufferWindowMs(intervalMs));
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
  const isEink = theme === "eink";
  chartManager.map.touchZoomRotate.setZoomRate(isEink ? 0.5 : undefined);
  // E-ink: disable the two-finger-tap-to-zoom-out (and double-tap-to-zoom-in)
  // gesture. The slow panel makes users lift pinch fingers quickly with little
  // movement, which MapLibre reads as a two-finger tap and zooms out a level
  // each time — retries then compound into a big zoom-out. Pinch zoom
  // (touchZoomRotate) is unaffected.
  if (isEink) chartManager.map.doubleClickZoom.disable();
  else chartManager.map.doubleClickZoom.enable();
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

// Disconnect the active GPS source before the page is torn down (reload/close).
// On native (Capacitor) the BLE plugin outlives a JS reload, so an open link
// would leak — keeping the pod's single client slot and blocking the reloaded
// app from rediscovering it. Skip bfcache freezes, where the link should resume.
window.addEventListener("pagehide", (event) => {
  if (event.persisted) return;
  navManager.getActiveProvider()?.disconnect();
});

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
idleCloseables.push(trackPanel);

// --- Track viewer ---
const trackViewerLayer = new TrackViewerLayer(chartManager.map);
const trackViewer = new TrackViewerPanel(trackViewerLayer, {
  // Stop follow-mode from yanking the map back to the vessel mid-scrub
  onOpen: () => chartMode.setMode("free"),
});
idleCloseables.push(trackViewer);
trackPanel.setOnViewTrack((meta) => {
  trackPanel.hide();
  trackViewer.open(meta).catch(console.error);
});

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

// Native GPS power management (visibility / recording / idle / theme driven).
if (capacitorGPS) {
  gpsPowerManager = new GpsPowerManager(capacitorGPS, trackRecorder);
  gpsPowerManager.start();
}

// Auto-dim the window when the user has been idle for a while. Per-window
// brightness override — does not touch the system brightness setting.
if (Capacitor.isNativePlatform()) {
  const DIM_LEVEL = 0.3;
  const dimDetector = createIdleDetector(60_000);
  const applyDim = () => {
    const enabled = getSettings().autoDimWhenIdle;
    const shouldDim =
      enabled && dimDetector.isIdle() && document.visibilityState === "visible";
    BackgroundGPS.setScreenBrightness({
      level: shouldDim ? DIM_LEVEL : -1,
    }).catch(console.error);
  };
  dimDetector.onChange(applyDim);
  document.addEventListener("visibilitychange", () => {
    // On wake, the throttled idle timeout flushes immediately and would dim
    // the screen at once. Treat becoming visible as fresh activity.
    if (document.visibilityState === "visible") dimDetector.reset();
    applyDim();
  });
  onSettingsChange((s) => {
    void s;
    applyDim();
  });
  applyDim();
}

// Auto-return: after a stretch of no interaction, close any open dialogs and
// recenter on the vessel so it's back on screen — like a dedicated plotter.
{
  const AUTO_RETURN_IDLE_MS = 60_000;
  const returnDetector = createIdleDetector(AUTO_RETURN_IDLE_MS);
  const autoReturnNow = () => {
    if (!getSettings().autoReturnWhenIdle) return;
    // Watching a track replay is not "idle" — don't yank the user out of it
    if (trackViewer.isPlaying()) return;
    for (const c of idleCloseables) c.hide();
    if (chartMode.getMode() === "free") chartMode.recenter();
  };
  returnDetector.onChange((idle) => {
    if (!idle || document.visibilityState !== "visible") return;
    autoReturnNow();
  });
  // Hidden time counts as idle time: pocketing the phone suspends JS timers
  // (especially on iOS), so the idle timeout never fires while hidden — and
  // treating wake as fresh activity would strand the user in free mode for
  // another full window. If the app was hidden long enough, return on wake;
  // for a short app-switch, grant the usual fresh window.
  let hiddenSinceMs: number | null = null;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      hiddenSinceMs = Date.now();
      return;
    }
    if (
      hiddenSinceMs !== null &&
      Date.now() - hiddenSinceMs >= AUTO_RETURN_IDLE_MS
    ) {
      autoReturnNow();
    }
    hiddenSinceMs = null;
    returnDetector.reset();
  });
}

// --- Routes ---
const routeLayer = new RouteLayer(chartManager.map);
const routeEditor = new RouteEditor(chartManager.map, routeLayer);
routeEditor.setSearchEntriesProvider(getSearchEntries);
const routePanel = new RouteManagerPanel(routeLayer, routeEditor);
idleCloseables.push(routePanel);
routePanel.setOnPreviewRoute((route) => {
  routePanel.hide();
  trackViewer.openRoute(route);
});

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
idleCloseables.push(waypointPanel);
routePanel.setActiveNav(activeNav);
routePanel.setWaypointLayer(waypointLayer);

// --- Context menu (right-click on map) ---
const plottingLayer = new PlottingLayer(chartManager.map);
const measurementLayer = new MeasurementLayer(chartManager.map);
const contextMenu = createContextMenu({
  map: chartManager.map,
  routeEditor,
  waypointLayer,
  plottingLayer,
  measurementLayer,
  activeNav,
  onWaypointAdded: () => waypointPanel.show(),
  getSearchEntries,
});
idleCloseables.push(contextMenu);

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
    // data is null when the fix is stale — info is then computed from a stale
    // position, so blank like the motion instruments rather than freezing.
    if (!info || !data) return { value: "--", unit: label };
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
  format(data) {
    const info = activeNav.getInfo();
    // Blank on a stale fix (data null) — see the BRG formatter.
    if (!info || !data) return { value: "--", unit: "NM" };
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
  format(data, settings) {
    const info = activeNav.getInfo();
    const unit = speedUnitLabel(settings.speedUnit);
    // Blank on a stale fix (data null) — see the BRG formatter.
    if (!info || !data || info.vmgKn == null) return { value: "--", unit };
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
  shortLabel: "STR",
  format(data) {
    const info = activeNav.getInfo();
    // Blank on a stale fix (data null) — see the BRG formatter.
    if (!info || !data || info.steerDeg == null)
      return { value: "--", unit: "" };
    const d = info.steerDeg;
    if (Math.abs(d) < 1) return { value: "0\u00b0", unit: "" };
    const mag = Math.round(Math.abs(d));
    return d < 0
      ? { value: `\u2190${mag}\u00b0`, unit: "" }
      : { value: `${mag}\u00b0\u2192`, unit: "" };
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
  idleCloseables.push(cachePanel);
  cachePanel.setOnChartsChanged(() => {
    // Reload OPFS charts into the PMTiles protocol (dropping entries for
    // deleted charts so their regions fall back to streaming) + refresh
    // offline coverage.
    (async () => {
      try {
        const charts = await listStoredCharts();
        pruneOfflineCharts(charts.map((c) => c.filename));
        for (const chart of charts) {
          await registerOfflineChart(chart.filename);
        }
        setStoredBasemaps(
          basemapRegionsFromFilenames(charts.map((c) => c.filename)),
        );
        setStoredRasterCharts(
          rasterChartsFromFilenames(charts.map((c) => c.filename)),
        );
        await vectorProvider.loadAllOfflineCoverage();
        // The downloaded set changed, so re-derive which regions stream
        vectorProvider.setStreamingVersions(await getStreamingVersions());
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

  // Periodically offer updates for downloaded regions that are out of date,
  // and re-pin streaming regions to the latest server version.
  startChartUpdateNotifier({
    showChartRegions: () => {
      cachePanel.show();
      settingsHandle?.hide();
    },
    applyStreamingVersions,
  });

  // Search button
  const searchBtn = buildTopbarAction(iconSearch, "FIND", "Search", {
    fullLabel: "Search",
  });
  searchBtn.addEventListener("click", () => {
    searchDialog.show();
    closeHamburger();
  });
  topbarMenu.insertBefore(searchBtn, settingsWrapper);

  // Time forecast bar — scrubs the global display-time offset so tide/current/
  // wind overlays show future conditions. Closing it (or idle auto-return)
  // resets to now.
  const timeBar = new TimeBar();
  idleCloseables.push(timeBar);
  const timeBtn = buildTopbarAction(iconClock, "TIME", "Time forecast", {
    fullLabel: "Time forecast",
  });
  timeBtn.addEventListener("click", () => {
    timeBar.toggle();
    closeHamburger();
  });
  timeBar.onVisibilityChange = (open) =>
    timeBtn.classList.toggle("active", open);
  topbarMenu.insertBefore(timeBtn, settingsWrapper);

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
  idleCloseables.push(aboutDialog);
  const aboutBtn = buildTopbarAction(iconInfo, "INFO", "About", {
    fullLabel: "About",
  });
  aboutBtn.addEventListener("click", () => {
    aboutDialog.toggle();
    closeHamburger();
  });
  topbarMenu.insertBefore(aboutBtn, settingsWrapper);

  // Plugin-contributed actions (e.g. Sun) sit just before the trailing
  // Full/Info group rather than at the front of the menu.
  topbarMenu.querySelectorAll(".topbar-plugin-action").forEach((b) => {
    topbarMenu.insertBefore(b, fullscreenBtn);
  });
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
// Persistent connection event log (always on — survives restarts):
//   bleLog.entryCount — number of entries
//   bleLog.text()     — human-readable log
//   bleLog.csv()      — CSV string
//   bleLog.download() — export CSV via share/file save
//   bleLog.clear()    — wipe the log
const bleLog = {
  get entryCount() {
    return connectionLog.entryCount;
  },
  text: () => connectionLog.toText(),
  csv: () => connectionLog.toCSV(),
  download: () => {
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    downloadFile(connectionLog.toCSV(), `connection-log-${ts}.csv`, "text/csv");
  },
  clear: () => connectionLog.clear(),
};
Object.assign(window, { gpsDiag, bleLog });
// To enable: run gpsDiag.start() in the browser console or Chrome DevTools.
