/**
 * GPS provider registration and connection-notice banners.
 *
 * Builds the simulator (with its `?simStart`/`?simCog` URL overrides) and
 * registers every available navigation provider — device/browser GPS, USB
 * serial, BLE, Bluetooth Classic SPP, Signal K — with the navigation
 * manager, wiring each one's connection notices to persistent status
 * banners. Extracted from main.ts; UI entry points (banner functions, the
 * SPP device picker) arrive via the deps object so this module stays free
 * of direct UI imports.
 */
import { Capacitor } from "@capacitor/core";
import { getAllRoutes } from "../data/db";
import type { Route } from "../data/Route";
import type { Settings, SimulatorMode } from "../settings";
import type { StatusBannerOptions } from "../ui/StatusBanner";
import { diag } from "../utils/diag";
import { BLENMEAProvider } from "./BLENMEAProvider";
import { BrowserGeolocationProvider } from "./BrowserGeolocationProvider";
import { CapacitorBLENMEAProvider } from "./CapacitorBLENMEAProvider";
import { CapacitorGPSProvider } from "./CapacitorGPSProvider";
import {
  CapacitorSPPNMEAProvider,
  type SppDeviceChooser,
} from "./CapacitorSPPNMEAProvider";
import { connectionLog } from "./ConnectionEventLog";
import type { NavigationDataManager } from "./NavigationDataManager";
import type { ProviderNotice } from "./ProviderNotice";
import { REPLAY_TRACK } from "./replay-track";
import { SignalKProvider } from "./SignalKProvider";
import {
  BOSTON_HARBOR_ROUTE,
  type SimulatorOptions,
  SimulatorProvider,
} from "./SimulatorProvider";
import { WebSerialNMEAProvider } from "./WebSerialNMEAProvider";

export interface GpsProviderSetupDeps {
  navManager: NavigationDataManager;
  getSettings: () => Readonly<Settings>;
  showStatusBanner: (options: StatusBannerOptions) => void;
  hideStatusBanner: (id: string) => void;
  showSppDevicePicker: SppDeviceChooser;
}

export interface GpsProviderSetup {
  simulator: SimulatorProvider;
  /** See the doc comment on the implementation inside setupGpsProviders. */
  applySimulatorMode: (mode: SimulatorMode) => Promise<void>;
  /** Non-null only on native builds (drives GpsPowerManager). */
  capacitorGPS: CapacitorGPSProvider | null;
  /**
   * The concrete BLE provider instance — the settings panel's Change…
   * button and the banner actions need its pickNewDevice/
   * promptEnableBluetooth, which NavigationDataProvider omits.
   */
  bleProvider: CapacitorBLENMEAProvider | BLENMEAProvider | null;
  /** Bluetooth Classic SPP receivers (e.g. Garmin GLO) — native builds only. */
  sppProvider: CapacitorSPPNMEAProvider | null;
  signalK: SignalKProvider;
  /**
   * Hide every banner any provider notice has shown — called on provider
   * switch so stale banners never linger on e-ink.
   */
  hideShownNoticeBanners: () => void;
}

export function setupGpsProviders(
  deps: GpsProviderSetupDeps,
): GpsProviderSetup {
  const {
    navManager,
    getSettings,
    showStatusBanner,
    hideStatusBanner,
    showSppDevicePicker,
  } = deps;

  // The concrete BLE provider instance (assigned at registration below) — the
  // settings panel's Change… button and the banner actions need its
  // pickNewDevice/promptEnableBluetooth, which NavigationDataProvider omits.
  let bleProvider: CapacitorBLENMEAProvider | BLENMEAProvider | null = null;
  // Bluetooth Classic SPP receivers (e.g. Garmin GLO) — native builds only.
  let sppProvider: CapacitorSPPNMEAProvider | null = null;
  // Banner ids shown by any provider notice — hidden en masse on provider
  // switch so stale banners never linger on e-ink.
  const shownNoticeBanners = new Set<string>();

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
    // Both motion models are always configured; the "simulatorMode" setting
    // (replay = a real recorded sail whose true turn rates and speed changes
    // exercise the GPS pipeline, route = the synthetic 6 kn harbor loop,
    // custom = the user's own route named SIMULATOR) picks which one runs,
    // switchable live from Settings. "custom" runs the provider in route mode;
    // applySimulatorMode() swaps the waypoints in once IndexedDB has answered.
    const defaults: Partial<SimulatorOptions> = {
      mode: getSettings().simulatorMode === "replay" ? "replay" : "route",
      track: REPLAY_TRACK,
    };
    try {
      const params = new URLSearchParams(window.location.search);
      const raw = params.get("simStart");
      if (!raw) return defaults;
      const m = raw.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
      if (!m) {
        console.warn("simStart: expected lat,lon — got", raw);
        return defaults;
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
        return defaults;
      }
      // Dev-only: ?simMode=linear&simCog=<deg> holds the boat at simStart on a
      // fixed heading (a steady pose for demos/screenshots — off-route with a
      // divergent course so the route, bearing, and course lines read separately).
      if (import.meta.env.DEV && params.get("simMode") === "linear") {
        const cog = Number(params.get("simCog") ?? "0");
        console.log(`sim linear: (${lat}, ${lon}) heading ${cog}°`);
        return {
          mode: "linear",
          position: [lat, lon],
          heading: cog,
          track: REPLAY_TRACK,
        };
      }
      console.log(
        `simStart override: simulator boat begins at (${lat}, ${lon})`,
      );
      // Prepend to the default loop and force route mode; the boat starts at
      // simStart, continues to the loop's first waypoint, then cycles. A later
      // change to the simulator-mode setting takes over from there.
      return {
        mode: "route",
        waypoints: [[lat, lon], ...BOSTON_HARBOR_ROUTE],
        track: REPLAY_TRACK,
      };
    } catch (e) {
      console.warn("simStart parse failed:", e);
      return defaults;
    }
  }

  // Register available GPS providers
  const simulatorOptions = buildSimulatorOptions();
  const simulator = new SimulatorProvider(simulatorOptions);
  simulator.setSpeedMultiplier(getSettings().simulatorSpeed);

  /**
   * Apply a simulator-mode setting to the provider. "custom" follows the
   * user's own route named SIMULATOR (design any course in the route editor,
   * then watch the sim sail it); the loop is closed back to its first waypoint
   * like the built-in harbor route. Falls back to the default loop, with a
   * banner, when no such route exists. Re-invoked by the Restart action in
   * custom mode so course edits are picked up without touching settings.
   */
  let applySimGeneration = 0;
  async function applySimulatorMode(mode: SimulatorMode): Promise<void> {
    const generation = ++applySimGeneration;
    if (mode === "custom") {
      let custom: Route | undefined;
      try {
        const routes = await getAllRoutes();
        custom = routes.find(
          (r) =>
            r.name.trim().toUpperCase() === "SIMULATOR" &&
            r.waypoints.length >= 2,
        );
      } catch (e) {
        console.warn("simulator: route lookup failed:", e);
      }
      // A newer call superseded this one while IndexedDB was answering —
      // don't overwrite its waypoints/mode with this stale resolution.
      if (generation !== applySimGeneration) return;
      if (custom) {
        hideStatusBanner("sim-custom-route");
        const wps = custom.waypoints.map(
          (w) => [w.lat, w.lon] as [number, number],
        );
        wps.push(wps[0]); // close the loop, like the built-in harbor route
        simulator.setWaypoints(wps);
        simulator.setMode("route");
        return;
      }
      showStatusBanner({
        id: "sim-custom-route",
        message:
          "No route named SIMULATOR (with 2+ waypoints) found — the simulator is using the built-in harbor loop.",
      });
    }
    if (mode !== "replay") {
      // route mode, or custom falling back: the default loop (including any
      // ?simStart= prepend from boot).
      simulator.setWaypoints(simulatorOptions.waypoints ?? BOSTON_HARBOR_ROUTE);
    }
    simulator.setMode(mode === "replay" ? "replay" : "route");
  }

  navManager.registerProvider(simulator);
  // A stored "custom" mode needs its route loaded from IndexedDB at boot.
  if (getSettings().simulatorMode === "custom") {
    void applySimulatorMode("custom");
  }
  let capacitorGPS: CapacitorGPSProvider | null = null;
  if (CapacitorGPSProvider.isAvailable()) {
    capacitorGPS = new CapacitorGPSProvider(
      makeProviderNoticeHandler("capacitor-gps", "Device GPS"),
    );
    navManager.registerProvider(capacitorGPS);
  }
  // Browser geolocation works in both WebView and browser
  navManager.registerProvider(
    new BrowserGeolocationProvider(
      makeProviderNoticeHandler("browser-gps", "Browser GPS"),
    ),
  );
  if (WebSerialNMEAProvider.isAvailable()) {
    navManager.registerProvider(
      new WebSerialNMEAProvider(
        undefined,
        makeProviderNoticeHandler("web-serial", "USB GPS"),
      ),
    );
  }
  // BLE NUS GPS pod ("ble-nmea"): native builds use the Capacitor plugin (the
  // Android WebView has no Web Bluetooth); the web/PWA uses Web Bluetooth.
  // Both surface connection conditions (Bluetooth off, picker cancelled,
  // connect failed) through persistent status banners — a silent BLE failure
  // on the water is a navigation hazard.
  connectionLog.setMirror((e) =>
    diag("conn", `${e.src} ${e.type}${e.detail ? ` ${e.detail}` : ""}`),
  );
  function makeProviderNoticeHandler(
    bannerPrefix: string,
    providerLabel: string,
  ): (notice: ProviderNotice) => void {
    const show = (id: string, opts: StatusBannerOptions) => {
      shownNoticeBanners.add(id);
      showStatusBanner(opts);
    };
    return (notice: ProviderNotice): void => {
      switch (notice.kind) {
        case "bt-off":
          show(`${bannerPrefix}-bt`, {
            id: `${bannerPrefix}-bt`,
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
          hideStatusBanner(`${bannerPrefix}-bt`);
          break;
        case "connected":
          hideStatusBanner(`${bannerPrefix}-bt`);
          hideStatusBanner(`${bannerPrefix}-pick`);
          hideStatusBanner(`${bannerPrefix}-conn`);
          break;
        case "picker-cancelled":
          show(`${bannerPrefix}-pick`, {
            id: `${bannerPrefix}-pick`,
            message: `No ${providerLabel} chosen — GPS not connected`,
            actionLabel: "Choose…",
            onAction: () => {
              hideStatusBanner(`${bannerPrefix}-pick`);
              navManager.reconnectActiveProvider();
            },
          });
          break;
        case "connect-failed":
          show(`${bannerPrefix}-conn`, {
            id: `${bannerPrefix}-conn`,
            message: `${providerLabel} not connected — ${notice.detail}`,
            actionLabel: "Retry",
            onAction: () => {
              hideStatusBanner(`${bannerPrefix}-conn`);
              navManager.reconnectActiveProvider();
            },
          });
          break;
      }
    };
  }
  const handleBleNotice = makeProviderNoticeHandler("ble", "Bluetooth GPS");
  if (Capacitor.isNativePlatform()) {
    bleProvider = new CapacitorBLENMEAProvider(handleBleNotice);
    navManager.registerProvider(bleProvider);
  } else if (BLENMEAProvider.isAvailable()) {
    bleProvider = new BLENMEAProvider(handleBleNotice);
    navManager.registerProvider(bleProvider);
  }
  // Bluetooth Classic SPP NMEA ("bt-spp"): native only — the WebView has no
  // Bluetooth Classic API at all. Devices pair in Android settings; the in-app
  // chooser lists the bonded ones.
  if (Capacitor.isNativePlatform()) {
    sppProvider = new CapacitorSPPNMEAProvider(
      showSppDevicePicker,
      makeProviderNoticeHandler("spp", "Bluetooth GPS"),
    );
    navManager.registerProvider(sppProvider);
  }
  const signalK = new SignalKProvider(
    getSettings().signalkUrl,
    makeProviderNoticeHandler("signalk", "Signal K"),
  );
  navManager.registerProvider(signalK);

  return {
    simulator,
    applySimulatorMode,
    capacitorGPS,
    bleProvider,
    sppProvider,
    signalK,
    hideShownNoticeBanners: () => {
      for (const id of shownNoticeBanners) hideStatusBanner(id);
      shownNoticeBanners.clear();
    },
  };
}
