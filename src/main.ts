// FIRST import: installs global JS error capture before any other module
// evaluates, so even module-init crashes land in the persistent error log.
import "./diagnostics/errorCaptureBoot";
import { Capacitor } from "@capacitor/core";
import { type AddProtocolAction, addProtocol, setWorkerUrl } from "maplibre-gl";
// maplibre-gl v6 loads its worker by URL at runtime; route it through Vite's
// worker pipeline (`?worker&url` emits a self-contained bundle — the raw dist
// file imports a sibling module that wouldn't be emitted alongside it).
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { BackgroundGPS } from "./plugins/BackgroundGPS";
import "maplibre-gl/dist/maplibre-gl.css";
import { Protocol } from "pmtiles";
import "./style.css";
import { installFileOpenCapture } from "./app/fileOpenQueue";
import { type IdleCloseable, runIdleAutoReturn } from "./app/idleAutoReturn";
import { installOverlayDimming } from "./app/overlayDimming";
import { installRepaintThrottle } from "./app/repaintThrottle";
import {
  ChartManager,
  captureMapScreenshot,
  FeatureQueryHandler,
  NOAAChartProvider,
  NOAAECDISProvider,
  OSMChartProvider,
  VectorChartProvider,
} from "./chart";
import { loadBasemapCoverage } from "./chart/basemap-underlay";
import { reportChartFetch } from "./chart/ChartLoadMonitor";
import { LightSectorLayer } from "./chart/LightSectorLayer";
import { createOfflineChartRegistry } from "./chart/offline-protocol";
import { registerOSMTileProtocol } from "./chart/osm-tile-cache";
import {
  makeOverzoomHandler,
  OVERZOOM_SCHEME,
} from "./chart/overzoom-protocol";
import { PelLightLayer } from "./chart/PelLightLayer";
import { SafetyContour } from "./chart/SafetyContour";
import { CobAlarm } from "./cob/CobAlarm";
import { CobButton } from "./cob/CobButton";
import { CobManager } from "./cob/CobManager";
import { confirmEndCobNavigation } from "./cob/CobNavGuard";
import { CobPanel } from "./cob/CobPanel";
import { startCobChartAutoFit } from "./cob/chart-auto-fit";
import { initBugReportOutbox } from "./data/bug-report-outbox";
import {
  getStreamingVersions,
  refreshStreamingVersions,
} from "./data/chart-update-checker";
import { getAllWaypoints, repairTrackPointCounts } from "./data/db";
import { loadAllSearchIndices, type SearchEntry } from "./data/search-index";
import { installConsoleHooks } from "./diagnostics/console-hooks";
import { BearingLine } from "./map/BearingLine";
import { getMode } from "./map/InteractionMode";
import { MeasurementLayer } from "./map/MeasurementLayer";
import { installPinchZoomGuard } from "./map/pinch-zoom-guard";
import { PlottingLayer } from "./map/plotting/PlottingLayer";
import {
  installMapPositionPersistence,
  loadSavedMapPosition,
} from "./map/position-persistence";
import { RouteEditor } from "./map/RouteEditor";
import { RouteLayer } from "./map/RouteLayer";
import { registerRouteWaypointPick } from "./map/route-waypoint-pick";
import { TrackLayer } from "./map/TrackLayer";
import { TrackRecorder } from "./map/TrackRecorder";
import { TrackViewerLayer } from "./map/TrackViewerLayer";
import { WaypointLayer } from "./map/WaypointLayer";
import {
  hasSatelliteDiagnostics,
  type NavigationData,
  NavigationDataManager,
} from "./navigation";
import { ActiveNavigationManager } from "./navigation/ActiveNavigation";
import {
  CourseSmoothing,
  einkBufferWindowMs,
} from "./navigation/CourseSmoothing";
import { gpsDiagLog } from "./navigation/GPSDiagnosticLog";
import { GpsPowerManager } from "./navigation/GpsPowerManager";
import { setupGpsProviders } from "./navigation/provider-setup";
import { RegionAutoSwitch } from "./navigation/RegionAutoSwitch";
import { createStationaryTracker } from "./navigation/stationary";
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
import { confirmStopNavigation } from "./ui/ConfirmStopNavDialog";
import { ConnectionLogPanel } from "./ui/ConnectionLogPanel";
import { createContextMenu } from "./ui/ContextMenu";
import { maybeShowDisclaimer } from "./ui/DisclaimerDialog";
import { setImportLayers } from "./ui/gpx-import";
import { installGpxFileOpen } from "./ui/gpx-open";
import { installHardwareKeys } from "./ui/HardwareKeysController";
import { createIdleDetector } from "./ui/IdleDetector";
import { createInstrumentHUD } from "./ui/InstrumentHUD";
import {
  iconClock,
  iconGauge,
  iconGlobe,
  iconInfo,
  iconLock,
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
import { registerNavInstruments } from "./ui/nav-instruments";
import { trackInstrumentHUD } from "./ui/PanelStack";
import { RecenterButton } from "./ui/RecenterButton";
import { RouteManagerPanel } from "./ui/RouteManagerPanel";
import { SatelliteStatusPanel } from "./ui/SatelliteStatusPanel";
import { maybeShowScreenTimeoutWarning } from "./ui/ScreenTimeoutDialog";
import { SearchDialog } from "./ui/SearchDialog";
import { createSettingsPanel } from "./ui/SettingsPanel";
import { showSppDevicePicker } from "./ui/SppDevicePickerDialog";
import { hideStatusBanner, showStatusBanner } from "./ui/StatusBanner";
import { registerSurface } from "./ui/SurfaceManager";
import { TimeBar } from "./ui/TimeBar";
import { TrackManagerPanel } from "./ui/TrackManagerPanel";
import { TrackViewerPanel } from "./ui/TrackViewerPanel";
import { initTopbarOverflow } from "./ui/topbar-overflow";
import { buildTopbarAction } from "./ui/topbarButton";
import { WakeLockController } from "./ui/WakeLock";
import { WaypointManagerPanel } from "./ui/WaypointManagerPanel";
import { maybeShowWhatsNew } from "./ui/WhatsNewDialog";
import { diag } from "./utils/diag";
import { createThermalMonitor } from "./utils/thermal";
import { ChartModeController } from "./vessel/ChartMode";
import { CourseLine } from "./vessel/CourseLine";
import { type CourseSnapshot, courseChanged } from "./vessel/course-gate";
import { VesselLayer } from "./vessel/VesselLayer";

// The app lives at /app in production ("/" is the marketing landing page).
// Old PWA installs (start_url "/") can still boot the app at "/" through
// their pre-split service worker's navigation fallback — rewrite the URL so
// every later reload (e.g. the app-update banner) lands back in the app
// instead of on the landing page. Dev serves the app at "/" with no worker,
// so this is production-only.
if (
  import.meta.env.PROD &&
  !Capacitor.isNativePlatform() &&
  window.location.pathname === "/"
) {
  window.history.replaceState(null, "", "/app");
}

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

// Ask the browser to protect this origin's storage from eviction — routes,
// tracks, and multi-hundred-MB charts (IndexedDB + OPFS) otherwise live in a
// best-effort bucket the browser may silently wipe under storage pressure.
// Granted without a prompt for installed PWAs on Chromium; a denial is fine
// (Capacitor bundles its own storage and never evicts).
if (!Capacitor.isNativePlatform() && navigator.storage?.persist) {
  navigator.storage.persist().then((granted) => {
    if (!granted) console.log("Persistent storage not granted (best-effort)");
  });
}

// On the web PWA, register the service worker and offer a reload when a
// new build is available (no-op stub in Capacitor builds). The reload is
// deferred while under way — the busy check is late-bound (below, once
// activeNav/trackRecorder exist) so an update arriving during startup's
// top-level awaits can't hit their TDZ.
let appUpdateBusy = () => false;
startAppUpdateNotifier(() => appUpdateBusy());

// Start capturing "open with" file events before the disclaimer parks this
// module — a cold start via a file association delivers one immediately, and
// the read has to happen while Android's URI grant is still fresh. The
// consumer is registered much further down, once the layers exist.
installFileOpenCapture();

// Block here until the user accepts the navigation disclaimer — nothing
// chart/GPS-related is set up below until this resolves.
await maybeShowDisclaimer();

setWorkerUrl(maplibreWorkerUrl);

// Register PMTiles protocol for vector tile sources. Every fetch outcome is
// reported to the chart-load monitor from here — MapLibre fires no map
// "error" event when a source's TileJSON/header fetch fails (the region
// just silently never renders), so the protocol layer is the only reliable
// place to see those. A "json" request is the source's TileJSON/header:
// failing it kills the whole source, not one tile.
const protocol = new Protocol({ metadata: true });
const monitored =
  (handler: AddProtocolAction): AddProtocolAction =>
  async (params, abortController) => {
    // Reporting is observability — a bug there must never break tile
    // loading itself, so both report calls are isolated.
    try {
      const result = await handler(params, abortController);
      try {
        reportChartFetch(params.url, true);
      } catch {}
      return result;
    } catch (err) {
      try {
        reportChartFetch(
          params.url,
          false,
          err instanceof Error ? err.message : String(err),
          params.type === "json",
        );
      } catch {}
      throw err;
    }
  };
addProtocol("pmtiles", monitored(protocol.tilev4));
// Overzoom variant for imported raster charts (fills mid-pyramid gaps in
// multi-chart packed archives from ancestor tiles). Shares `protocol`'s
// PMTiles instances, so OPFS-backed offline archives are reused.
addProtocol(OVERZOOM_SCHEME, monitored(makeOverzoomHandler(protocol)));

// Glyph loader for the bundled font ranges (see CLAUDE.md "Fonts / glyphs").
// A request for an unbundled range must FAIL so MapLibre falls back to
// rendering those codepoints with a local system font. A plain URL can't
// guarantee that: SPA hosting (and the Vite dev server) answers missing
// .pbf paths with index.html + HTTP 200, which MapLibre then parses as
// protobuf and floods the console with "Unimplemented type" errors.
addProtocol("local-glyphs", async (params) => {
  const path = params.url.replace("local-glyphs://", "");
  const resp = await fetch(`/fonts/${path}.pbf`);
  if (!resp.ok || resp.headers.get("content-type")?.includes("text/html")) {
    throw new Error(`glyph range not bundled: ${path}`);
  }
  return { data: await resp.arrayBuffer() };
});

// OPFS-backed offline charts in the PMTiles protocol (registration, retry
// eviction, and the shared reload sequence) — see src/chart/offline-protocol.ts.
const offlineCharts = createOfflineChartRegistry(protocol);

// Register the cached OSM tile protocol (offline-capable raster underlay)
registerOSMTileProtocol();

// Load any offline PMTiles from OPFS before creating the map — before the map
// exists, so the initial style gets the right OSM cap. Failures (OPFS missing
// or unreadable) are logged inside; charts fall back to streaming.
await offlineCharts.reloadOfflineCharts();

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

// Reflect the instrument layout on <body> for CSS — but only while the HUD is
// actually shown, so layout-conditional map chrome (e.g. sliding the
// bottom-left controls clear of the side column) doesn't fire when there's no
// HUD on screen.
const applyInstrumentLayout = (layout: string, visible: boolean) => {
  if (visible) {
    document.body.dataset.instrumentLayout = layout;
  } else {
    delete document.body.dataset.instrumentLayout;
  }
};
applyInstrumentLayout(
  getSettings().instrumentLayout,
  getSettings().showInstrumentHUD,
);
onSettingsChange((s) =>
  applyInstrumentLayout(s.instrumentLayout, s.showInstrumentHUD),
);

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
const savedPos = loadSavedMapPosition();

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
  hasOfflineCharts: offlineCharts.hasOfflineCharts,
  onChartRetry: offlineCharts.evictStreamingCharts,
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
new ChartInUseReadout(chartManager.map, chartManager.loadStatus);

// Expose the map for probes: browser-harness in dev, chrome://inspect
// (or adb-forwarded CDP) diagnostics on device builds.
(window as unknown as { __map: unknown }).__map = chartManager.map;

// Dev-only render harness (?testChart=1): overlays the synthetic S-57 test
// chart through the real nautical styles for headless render specs. Loaded
// dynamically so production bundles drop it entirely.
if (import.meta.env.DEV) {
  void import("./app/testChartHarness").then(({ installTestChartHarness }) =>
    installTestChartHarness(chartManager.map),
  );
}

// Persist map position across reloads (throttled; flushed on hide/pagehide)
// — see src/map/position-persistence.ts.
installMapPositionPersistence(chartManager.map);

// Watches CPU/thermal pressure via the Compute Pressure API; falls back to
// "nominal" on browsers that don't expose `PressureObserver`. Drives both
// the throttle below and the HUD indicator (see NavigationHUD).
const thermalMonitor = createThermalMonitor();

// Repaint throttle: caps idle/steady-state rendering to save battery on
// long passages (e-ink 4 fps, thermally hot 5 fps, otherwise 10 fps;
// stationary vessel ~1 fps — per-fix, so anchor swing still draws;
// gestures bypass the cap). See src/app/repaintThrottle.ts.
const stationaryTracker = createStationaryTracker();
installRepaintThrottle(
  chartManager.map,
  thermalMonitor,
  stationaryTracker.isStationary,
);

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
// Feed the stationary detector (repaint throttle) from raw fixes.
navManager.subscribe((data) => stationaryTracker.onFix(data.sog));

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
// The callbacks below reference `gps` (the provider setup, created in the
// Navigation section further down) — safe despite the const being declared
// later, since they only run on user interaction, well after setup.
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
          if (getSettings().gpsSource === "bt-spp") {
            void gps.sppProvider?.pickNewDevice();
          } else {
            void gps.bleProvider?.pickNewDevice();
          }
        },
      },
      restartSimulator: () => {
        // In custom mode, re-read the SIMULATOR route so "edit course →
        // Restart" picks up the changes; setWaypoints rewinds implicitly.
        if (getSettings().simulatorMode === "custom") {
          void gps.applySimulatorMode("custom");
        } else {
          gps.simulator.restart();
        }
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
const idleCloseables: IdleCloseable[] = [];
if (settingsHandle) idleCloseables.push(settingsHandle);
idleCloseables.push(satellitePanel);
// The feature-info popup (chart + merged plugin candidates) counts as a
// dialog for auto-return.
idleCloseables.push(featureQueryHandler);

// Hamburger toggle for mobile
const hamburgerBtn = document.getElementById("hamburger-btn");
const closeHamburger = () => topbarMenu?.classList.remove("open");
if (hamburgerBtn && topbarMenu) {
  // Registering the dropdown gives it slot semantics: opening it closes
  // panels in the corner (they used to render on top of it) and vice
  // versa, and outside taps close it.
  const menuSurface = registerSurface({
    id: "topbar-menu",
    slot: "top-right",
    el: () => topbarMenu,
    isOpen: () => topbarMenu.classList.contains("open"),
    close: closeHamburger,
  });
  hamburgerBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    // If settings is open, just close it (don't open the menu)
    if (settingsHandle?.isOpen()) {
      settingsHandle.hide();
      return;
    }
    const opening = !topbarMenu.classList.contains("open");
    topbarMenu.classList.toggle("open");
    if (opening) menuSurface.opened();
  });

  // While Settings fills a phone screen the hamburger is functionally its
  // close button (the click handler above) — show it as one.
  settingsHandle?.onOpenChange((open) => {
    hamburgerBtn.textContent = open ? "✕" : "☰";
    hamburgerBtn.setAttribute("aria-label", open ? "Close settings" : "Menu");
  });
}

// Clicking the map to dismiss an open click-outside panel (Settings, or the
// mobile topbar menu) shouldn't also register a chart pick — almost never the
// intent. Manager panels persist through outside clicks, so they're unaffected.
if (settingsHandle) {
  featureQueryHandler.addPickSuppressor(() => settingsHandle.isOpen());
}
if (topbarMenu) {
  featureQueryHandler.addPickSuppressor(() =>
    topbarMenu.classList.contains("open"),
  );
}

// --- Navigation system ---

// Register available GPS providers (simulator with its ?simStart/?simCog URL
// overrides, device/browser GPS, USB serial, BLE, Bluetooth Classic SPP,
// Signal K) and their connection-notice banners. See
// src/navigation/provider-setup.ts.
const gps = setupGpsProviders({
  navManager,
  getSettings,
  showStatusBanner,
  hideStatusBanner,
  showSppDevicePicker,
});

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
  // Hidden: skip all map/smoothing work — nothing is visible and the setData
  // calls only burn CPU. The track recorder subscribes separately and keeps
  // recording; the visibility handler below redraws on return. The smoother
  // resumes via its dt>=1s snap path.
  if (document.visibilityState === "hidden") return;
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
    // become valid). `smoothed` is passed even when null: a course-less fix
    // clears the smoother, and chartMode must drop its stale smoothed
    // position with it — else recenter targets wherever the vessel last had
    // a valid course (e.g. a bygone simulator run) instead of the live fix.
    vesselLayer.update(data);
    chartMode.update(data, smoothed);
    // A course-less fix (COG drops out at rest) clears the smoother, and the
    // render loop below never runs without a smoothed course — so clear the
    // projection line here or it stays frozen at the last moving snapshot.
    // Invalidating the change gate guarantees the first smoothed course
    // after recovery is applied, even one within epsilon of the pre-clear
    // snapshot.
    if (!smoothed) {
      courseLine.update(data, null);
      appliedCourse = null;
    }
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
// A stale fix blanks the HUD's COG/SOG — the projection line shows the same
// quantities, so drop it too (the vessel icon stays, frozen at its last
// position). Polled like the HUD's badge: staleness has no push event.
// Resetting the change gate guarantees the line's redraw on recovery.
window.setInterval(() => {
  if (navManager.isFixStale()) {
    courseLine.clear();
    appliedCourse = null;
  }
}, 1000);

// Screen wake lock. Created BEFORE the settings listener below that calls
// into it — a const referenced by an earlier-registered listener is a TDZ
// ReferenceError if any updateSettings() lands in the window between the
// two, aborting the notify loop mid-listeners.
const wakeLockCtrl = new WakeLockController();
{
  const s = getSettings();
  wakeLockCtrl.setMode(s.wakeLock);
  wakeLockCtrl.setGpsActive(s.gpsSource !== "none");
  wakeLockCtrl.setEinkMode(s.displayTheme === "eink");
}

// React to chart mode changes from settings
let prevGpsSource = getSettings().gpsSource;
let prevSimulatorMode = getSettings().simulatorMode;
onSettingsChange((s) => {
  if (s.chartMode !== chartMode.getMode()) {
    chartMode.setMode(s.chartMode);
  }
  // Prev-tracked, not compared against the live provider id: with source
  // "none" (or an id unavailable on this platform) getActiveProvider() is
  // undefined, and a live comparison would re-activate the provider — and
  // reset its Kalman/quality state — on every settings commit.
  if (s.gpsSource !== prevGpsSource) {
    prevGpsSource = s.gpsSource;
    navManager.setActiveProvider(s.gpsSource);
    // Stale provider banners must not linger after switching sources.
    gps.hideShownNoticeBanners();
  }
  gps.simulator.setSpeedMultiplier(s.simulatorSpeed);
  // Prev-tracked (not just idempotent setMode) so a ?simStart= route-mode
  // override survives unrelated settings changes until the user explicitly
  // switches the simulator mode.
  if (s.simulatorMode !== prevSimulatorMode) {
    prevSimulatorMode = s.simulatorMode;
    void gps.applySimulatorMode(s.simulatorMode);
  }
  gps.signalK.setUrl(s.signalkUrl);
  navManager.setRateMode(s.gpsRateMode, s.manualUpdateIntervalMs);
  navManager.setFilterMode(s.gpsFilterMode);
  applyGpsRateForTheme(s.displayTheme);
  wakeLockCtrl.setMode(s.wakeLock);
  wakeLockCtrl.setGpsActive(s.gpsSource !== "none");
  wakeLockCtrl.setEinkMode(s.displayTheme === "eink");
  // Switch active region (UI only — all regions are always rendered).
  // No camera move here: RegionAutoSwitch commits this setting under way,
  // and yanking the map mid-passage would discard the navigator's view. A
  // manual pick in the Chart Regions panel requests its own flyTo (see
  // setOnRegionSelected below).
  vectorProvider.setActiveRegion(s.activeRegion);
  const region = vectorProvider.getRegion();
  if (region.id !== prevActiveRegion) {
    prevActiveRegion = region.id;
    // New active region → its basemap's coverage drives the OSM cap
    loadBasemapCoverage(region.id)
      .then(() => chartManager.refreshStyle())
      .catch(() => {});
  }
});

// Search dialog for chart features. The indexes total ~15-20 MB across all
// regions — the single largest avoidable startup download on cellular — so
// they load lazily on first use (opening search, or the first synchronous
// auto-naming lookup kicks the fetch for subsequent calls) instead of at
// boot. The merged entries are cached so auto-naming can read them
// synchronously once loaded.
const searchDialog = new SearchDialog(chartManager.map);
idleCloseables.push(searchDialog);
let cachedSearchEntries: SearchEntry[] = [];
let searchIndicesRequested = false;
function ensureSearchIndicesLoaded(): void {
  if (searchIndicesRequested) return;
  searchIndicesRequested = true;
  loadAllSearchIndices().then((entries) => {
    cachedSearchEntries = entries;
    searchDialog.setEntries(entries);
  });
}
const getSearchEntries = (): SearchEntry[] => {
  ensureSearchIndicesLoaded();
  return cachedSearchEntries;
};

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

// Stop pinch-release zoom inertia from running away to minZoom when the main
// thread stalled mid-gesture (iOS) — see pinch-zoom-guard.ts for the mechanism.
installPinchZoomGuard(chartManager.map);

// Volume keys → chart zoom / touchscreen lock (native only, opt-in via setting)
const hardwareKeys = installHardwareKeys(chartManager.map);

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
    ensureSearchIndicesLoaded();
    searchDialog.toggle();
  }
});

// --- Track recording ---
const trackRecorder = new TrackRecorder(navManager);
const trackLayer = new TrackLayer(chartManager.map, navManager, trackRecorder);
const trackPanel = new TrackManagerPanel(trackLayer, trackRecorder);
idleCloseables.push(trackPanel);

// Surface track-save failures (IndexedDB quota, corrupt DB) — without a
// banner the UI keeps showing "Recording" while every point is lost.
let trackSaveBannerShown = false;
trackRecorder.onRecordingChange(() => {
  const failing = trackRecorder.isSaveFailing();
  if (failing === trackSaveBannerShown) return;
  trackSaveBannerShown = failing;
  if (failing) {
    showStatusBanner({
      id: "track-save-failed",
      message:
        "Track recording is failing to save — points are being lost. Check device storage space.",
    });
  } else {
    hideStatusBanner("track-save-failed");
  }
});

// --- Track viewer ---
const trackViewerLayer = new TrackViewerLayer(chartManager.map);
const trackViewer = new TrackViewerPanel(trackViewerLayer, {
  // Stop follow-mode from yanking the map back to the vessel mid-scrub
  onOpen: () => chartMode.setMode("free"),
});
idleCloseables.push(trackViewer);
trackPanel.setOnViewTrack((meta) => {
  // Keep the list open: viewer is a bottom bar, so users can click
  // through tracks the way they click through routes.
  trackViewer.open(meta).catch(console.error);
});

// One-shot repair: re-sync track meta pointCounts with stored points,
// fixing stale/zero counts left by an earlier race condition. Gated by
// localStorage so it only runs once per device. Every recorder start —
// boot and the settings listener below alike — waits on this promise, so
// nothing writes track meta concurrently with the repair. The promise
// never rejects (failures are logged and swallowed), so starts proceed
// even when the repair throws.
const TRACK_REPAIR_FLAG = "pelorus-nav-track-counts-repaired-v1";
const trackRepairDone: Promise<void> = (async () => {
  if (localStorage.getItem(TRACK_REPAIR_FLAG)) return;
  try {
    const { scanned, repaired } = await repairTrackPointCounts();
    console.log(`Track meta repair: ${repaired}/${scanned} updated`);
    localStorage.setItem(TRACK_REPAIR_FLAG, "1");
  } catch (e) {
    console.error("Track meta repair failed:", e);
  }
})();
const startRecorderAfterRepair = () =>
  trackRepairDone.then(() => {
    // Re-check once the repair settles: the setting may have flipped back,
    // or an earlier queued start may have already begun recording.
    if (getSettings().trackRecordingEnabled && !trackRecorder.isRecording()) {
      trackRecorder.start();
    }
  });

// React to track recording setting
onSettingsChange((s) => {
  if (s.trackRecordingEnabled && !trackRecorder.isRecording()) {
    void startRecorderAfterRepair();
  } else if (!s.trackRecordingEnabled && trackRecorder.isRecording()) {
    trackRecorder.stop();
  }
});

// Start recording at boot if the setting is on.
void startRecorderAfterRepair();

// Native GPS power management (visibility / recording / idle / theme driven).
if (gps.capacitorGPS) {
  gpsPowerManager = new GpsPowerManager(gps.capacitorGPS, trackRecorder);
  gpsPowerManager.start();
}

// --- Visibility/power boundary (8b-3) ---
// Hidden: the screen's force-fast lock yields to the adaptive tier (the
// controller still keeps fast during maneuvers for track fidelity), and BLE
// reconnect pacing relaxes ×10 — unless a recording is running, which keeps
// full reconnect aggressiveness (the overnight-track case). The map
// subscriber's hidden gate above stops the per-fix map work.
const applyReconnectPacing = () => {
  const relaxed =
    document.visibilityState === "hidden" && !trackRecorder.isRecording();
  gps.bleProvider?.setReconnectPacing(relaxed);
  gps.sppProvider?.setReconnectPacing(relaxed);
};
document.addEventListener("visibilitychange", () => {
  const visible = document.visibilityState === "visible";
  navManager.setVisible(visible);
  applyReconnectPacing();
  if (visible && lastNavData) {
    // Redraw the state that accumulated while the map work was gated off,
    // without waiting for the next fix.
    appliedCourse = null;
    vesselLayer.update(lastNavData);
    chartMode.update(lastNavData);
    chartManager.map.triggerRepaint();
  }
});
// Recording toggles flip pacing eligibility (setPacing dedups no-ops).
onSettingsChange(() => applyReconnectPacing());

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
    // A route edit in progress is work, not idleness — closing panels or
    // recentering would yank the chart out from under the edit.
    if (getMode() === "route-edit") return;
    // Busy closeables (a chart download, a track replay) report themselves
    // via isBusy() and are left open; skip recentering too so we don't yank
    // the view away from whatever they're mid-task on.
    const { anyBusy } = runIdleAutoReturn(idleCloseables);
    if (anyBusy) return;
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
// Editing drops the chart to free mode; restore follow/course-up after.
routeEditor.setChartModeControl(chartMode);
const routePanel = new RouteManagerPanel(routeLayer, routeEditor);
idleCloseables.push(routePanel);
routePanel.setOnPreviewRoute((route) => {
  // The preview is a bottom bar and doesn't contest the route panels'
  // space — leave them open, matching track viewing.
  trackViewer.openRoute(route);
});

// --- Waypoints + Active Navigation ---
const activeNav = new ActiveNavigationManager(navManager);
const waypointLayer = new WaypointLayer(chartManager.map);
routeEditor.setSnapWaypointsProvider(() => waypointLayer.getWaypoints());
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

// GPX imports (panel buttons and OS "open with") draw into these.
setImportLayers({ routeLayer, trackLayer, waypointLayer });

// Tap-to-identify for routes and standalone waypoints: contributes cards to
// the unified feature-info list, sharing the Routes panel's selection.
registerRouteWaypointPick(pickRegistry, routeLayer, waypointLayer, {
  onRouteShown: (route) => routePanel.selectExternal(route),
  openRoute: (route) => {
    routePanel.openWithSelection(route).catch(console.error);
  },
  openWaypoint: (wp) => waypointPanel.openWithSelection(wp.id),
});

// --- Crew Overboard (COB) ---
const cobAlarm = new CobAlarm();
const cobManager = new CobManager({
  navManager,
  activeNav,
  saveWaypoint: (wp) => waypointLayer.addWaypoint(wp),
  updateWaypoint: (wp) => waypointLayer.updateWaypoint(wp),
  getWaypointById: async (id) =>
    (await getAllWaypoints()).find((w) => w.id === id) ?? null,
  alarm: cobAlarm,
  onEnsureRecording: () => {
    if (!trackRecorder.isRecording())
      updateSettings({ trackRecordingEnabled: true });
  },
  onEmergencyChange: (active) => wakeLockCtrl.setEmergencyActive(active),
});
appUpdateBusy = () =>
  activeNav.getState().type !== "idle" ||
  trackRecorder.isRecording() ||
  cobManager.isActive();
waypointPanel.setCobHooks({
  isCobWaypoint: (id) => cobManager.isCobWaypoint(id),
  noteWaypointDeleted: (id) => cobManager.noteWaypointDeleted(id),
});

// Anything canceling navigation via the map button or Escape goes through
// an explicit confirm — the floating button is too easy to hit by accident
// underway, and a crew-overboard return especially must never end on a
// stray tap (COB gets its own stricter dialog).
const guardNavCancel = (): boolean => {
  if (cobManager.isCobNavigation()) {
    confirmEndCobNavigation()
      .then((choice) => {
        if (choice === "stop-nav") activeNav.stop();
        else if (choice === "end-cob") return cobManager.resolve();
      })
      .catch(console.error);
    return true;
  }
  confirmStopNavigation()
    .then((stop) => {
      if (stop) activeNav.stop();
    })
    .catch(console.error);
  return true;
};

// --- Context menu (right-click on map) ---
const plottingLayer = new PlottingLayer(chartManager.map);
const measurementLayer = new MeasurementLayer(chartManager.map);
// A hold on a waypoint that shares its spot with a route point opens the
// targeted menu instead of grabbing (see docs/gesture-model.md).
waypointLayer.setRouteSource(() => routeLayer.getVisibleRoutes());

const contextMenu = createContextMenu({
  map: chartManager.map,
  routeEditor,
  routeLayer,
  waypointLayer,
  plottingLayer,
  measurementLayer,
  activeNav,
  onWaypointAdded: () => waypointPanel.show(),
  getSearchEntries,
  guardNavCancel,
});
idleCloseables.push(contextMenu);

// Cancel navigation control
const cancelNavBtn = new CancelNavButton(activeNav, guardNavCancel);
chartManager.map.addControl(cancelNavBtn, "bottom-left");

// COB button, info panel, and auto-view management.
// The panel lives outside idleCloseables — idle auto-return must never
// close an active emergency display.
const cobPanel = new CobPanel(cobManager, navManager, cobAlarm);
const cobButton = new CobButton({
  onActivate: () => {
    const result = cobManager.activate();
    if (result === "no-fix") {
      showStatusBanner({
        id: "cob-no-fix",
        message: "No GPS fix — cannot mark crew-overboard position",
        onDismiss: () => {},
      });
      setTimeout(() => hideStatusBanner("cob-no-fix"), 8000);
    }
    cobButton.refresh();
  },
  onToggleWhileActive: () => cobPanel.toggle(),
  isActive: () => cobManager.isActive(),
});
cobManager.subscribe(() => cobButton.refresh());
// Bottom-left with the other custom controls — bottom-right belongs to the
// fixed-position NavigationHUD, which would overlap a map control there.
chartManager.map.addControl(cobButton, "bottom-left");
startCobChartAutoFit(chartManager.map, chartMode, cobManager, navManager);

// Register nav-mode instruments (before restore so HUD is ready). The four
// activeNav-dependent instruments (BRG/DTW/VMG/STR) live in
// src/ui/nav-instruments.ts; all base instruments are in InstrumentHUD.ts.
registerNavInstruments(activeNav);

// Wire HUD to show BRG/DTW cells during active navigation
instrumentHUD.setActiveNav(activeNav);
instrumentHUD.onNavCellClick(() => routePanel.showActiveRoute());

// Restore persisted navigation state (after all subscribers are wired up).
// COB restores second: it reconciles with whatever goto activeNav brought
// back and only re-engages navigation if nav restored idle.
await activeNav.restore();
await cobManager.restore();

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
  });
  topbarActions.appendChild(trackBtn);

  // Routes panel button
  const routeBtn = buildTopbarAction(iconRoute, "RTE", "Routes");
  routeBtn.addEventListener("click", () => {
    routePanel.toggle();
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
  cachePanel.setOnChartsChanged(async () => {
    // Reload OPFS charts into the PMTiles protocol (dropping entries for
    // deleted charts so their regions fall back to streaming) + refresh
    // offline coverage. Awaited by the panel so its refresh() sees the
    // re-derived imported-chart list.
    await offlineCharts.reloadOfflineCharts({
      afterReload: async () => {
        await vectorProvider.loadAllOfflineCoverage();
        // The downloaded set changed, so re-derive which regions stream
        vectorProvider.setStreamingVersions(await getStreamingVersions());
        chartManager.refreshStyle();
      },
    });
  });
  cachePanel.setOnShowChart((chart) => {
    // Fit the chart's footprint, but never land below its minZoom — a fit
    // just under it would navigate to the chart yet show none of it.
    const map = chartManager.map;
    const camera = map.cameraForBounds(chart.bbox, { padding: 40 });
    if (!camera) return;
    map.flyTo({
      ...camera,
      zoom: Math.max(camera.zoom ?? chart.minZoom, chart.minZoom),
    });
    // Drops follow mode (ChartMode) and flashes the crosshair.
    map.fire("pelorus:navigate" as never);
  });
  cachePanel.setOnRegionSelected((region) => {
    // Manual region pick → deliberate navigation: drop follow mode and fly
    // to the picked region. (RegionAutoSwitch commits the same setting under
    // way, so the activeRegion settings listener never moves the camera —
    // the flyTo lives only on this panel-driven path.)
    chartManager.map.fire("pelorus:navigate" as never);
    chartManager.map.flyTo({
      center: region.center,
      zoom: region.defaultZoom,
    });
  });
  const cacheBtn = buildTopbarAction(iconGlobe, "RGNS", "Chart Regions", {
    fullLabel: "Chart Regions",
  });
  cacheBtn.addEventListener("click", () => {
    cachePanel.toggle();
    closeHamburger();
  });
  topbarMenu.insertBefore(cacheBtn, settingsWrapper);

  // Periodically offer updates for downloaded regions that are out of date,
  // and re-pin streaming regions to the latest server version.
  startChartUpdateNotifier({
    showChartRegions: () => {
      cachePanel.show();
    },
    applyStreamingVersions,
  });

  // Search button
  const searchBtn = buildTopbarAction(iconSearch, "FIND", "Search", {
    fullLabel: "Search",
  });
  searchBtn.addEventListener("click", () => {
    ensureSearchIndicesLoaded();
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

  // Settings opening evicts other panels via the SurfaceManager; the
  // hamburger dropdown still needs an explicit close (separate wiring).
  settingsHandle?.onOpen(() => {
    closeHamburger();
  });

  // Fullscreen toggle — web only; native apps are always fullscreen.
  let fullscreenBtn: HTMLButtonElement | null = null;
  if (!Capacitor.isNativePlatform()) {
    const btn = buildTopbarAction(iconMaximize, "FULL", "Fullscreen", {
      fullLabel: "Fullscreen",
    });
    fullscreenBtn = btn;
    const updateFullscreenBtn = () => {
      const isFs = !!document.fullscreenElement;
      btn.classList.toggle("active", isFs);
      setIcon(btn, isFs ? iconMinimize : iconMaximize);
      const t = isFs ? "Exit fullscreen" : "Fullscreen";
      btn.title = t;
      btn.setAttribute("aria-label", t);
      const fullSpan = btn.querySelector(".topbar-menu-label");
      if (fullSpan) fullSpan.textContent = t;
    };
    btn.addEventListener("click", () => {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        document.documentElement.requestFullscreen();
      }
      closeHamburger();
    });
    document.addEventListener("fullscreenchange", updateFullscreenBtn);
    topbarMenu.insertBefore(btn, settingsWrapper);

    // iOS Safari can scroll the page when browser chrome, fullscreen, or
    // keyboard transitions resize the viewport, and leave it scrolled —
    // pinning the top bar off-screen (observed live: scrollY=20 after a
    // chrome-height change; also reported on iPadOS 18.x after entering
    // fullscreen). The page is overflow:hidden and never scrolls by
    // design, so any offset is wrong — except while an input is focused,
    // when Safari legitimately scrolls to keep it above the keyboard.
    const reanchorViewport = () => {
      const ae = document.activeElement;
      if (
        ae instanceof HTMLElement &&
        (ae.tagName === "INPUT" ||
          ae.tagName === "TEXTAREA" ||
          ae.isContentEditable)
      ) {
        return;
      }
      if (window.scrollX !== 0 || window.scrollY !== 0) {
        window.scrollTo(0, 0);
      }
    };
    window.addEventListener("scroll", reanchorViewport);
    window.visualViewport?.addEventListener("resize", reanchorViewport);
    document.addEventListener("focusout", () =>
      setTimeout(reanchorViewport, 50),
    );
  }

  // Lock screen (Android only, like the HardwareKeys plugin) — disables the
  // touchscreen so accidental taps are ignored under way; a volume-key press
  // unlocks. Shown only while the volume-key controls setting is on (unlock
  // relies on that interception).
  if (Capacitor.getPlatform() === "android") {
    const lockBtn = buildTopbarAction(iconLock, "LOCK", "Lock screen", {
      fullLabel: "Lock screen",
    });
    lockBtn.addEventListener("click", () => {
      hardwareKeys.lock();
      closeHamburger();
    });
    const updateLockBtnVisibility = (visible: boolean) => {
      lockBtn.style.display = visible ? "" : "none";
    };
    updateLockBtnVisibility(getSettings().volumeKeyControls);
    onSettingsChange((s) => updateLockBtnVisibility(s.volumeKeyControls));
    topbarMenu.insertBefore(lockBtn, settingsWrapper);
  }

  // About button
  const aboutDialog = new AboutDialog({
    nav: {
      diagnosticsSnapshot: () => navManager.diagnosticsSnapshot(),
      requestDeviceDiag: () => navManager.requestDeviceDiag(),
    },
    captureScreenshot: () => captureMapScreenshot(chartManager.map),
  });
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
  // Full/Info group rather than at the front of the menu. On native there's
  // no Full button, so anchor on About instead.
  const pluginAnchor = fullscreenBtn ?? aboutBtn;
  topbarMenu.querySelectorAll(".topbar-plugin-action").forEach((b) => {
    topbarMenu.insertBefore(b, pluginAnchor);
  });

  // On narrow screens, promote as many menu items as fit into the
  // always-visible row instead of hiding them all behind the hamburger.
  const topBarEl = document.getElementById("top-bar");
  if (topBarEl && hamburgerBtn && topbarMenu && topbarActions) {
    initTopbarOverflow({
      topBar: topBarEl,
      actions: topbarActions,
      menu: topbarMenu,
      hamburger: hamburgerBtn,
    });
  }
}

// Warn the user once if the OS screen-off timeout is too short for marine
// use — see ScreenTimeoutDialog for the e-ink BIGME diagnosis that motivated
// this. Fires after the UI is up so the dialog appears on top.
maybeShowScreenTimeoutWarning().catch(console.error);

// After an app update, show this version's changelog highlights once.
maybeShowWhatsNew();

// Upload any bug reports queued while offline (startup + online events).
initBugReportOutbox();

// Dim overlay layers (routes, waypoints, bearing line) in night/dusk themes.
// See src/app/overlayDimming.ts (wires its own settings + style.load hooks).
installOverlayDimming(chartManager.map);

// Import GPX files opened from Files/Mail/Drive. Last, so a first-run
// What's New dialog isn't competing with the import prompt.
installGpxFileOpen({
  showRoutes: () => routePanel.show(),
  showTracks: () => trackPanel.show(),
  showWaypoints: () => waypointPanel.show(),
});

// Console diagnostic hooks: window.gpsDiag (GPS pipeline CSV log) and
// window.bleLog (persistent connection event log) — see
// src/diagnostics/console-hooks.ts.
installConsoleHooks();
