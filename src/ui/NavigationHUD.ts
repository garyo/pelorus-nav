/**
 * Navigation HUD: displays cursor position, zoom, COG/SOG, and GPS source.
 * Compact overlay at bottom-left of the map.
 */

import type maplibregl from "maplibre-gl";
import type { WaypointLayer } from "../map/WaypointLayer";
import type { AdaptiveTier } from "../navigation/AdaptiveRate";
import type { NavigationData } from "../navigation/NavigationData";
import type { NavigationDataManager } from "../navigation/NavigationDataManager";
import type { SpeedUnit } from "../settings";
import { getSettings } from "../settings";
import { formatLatLon } from "../utils/coordinates";
import { formatBearing, formatDeclination } from "../utils/magnetic";
import type { ThermalMonitor, ThermalState } from "../utils/thermal";
import { convertSpeed, speedUnitLabel } from "../utils/units";
import { GoToDialog } from "./GoToDialog";

function formatSpeed(knots: number | null, unit: SpeedUnit): string {
  if (knots === null) return "--";
  const value = convertSpeed(knots, unit);
  const label = unit === "knots" ? "kn" : speedUnitLabel(unit);
  return `${value.toFixed(1)} ${label}`;
}

function formatCOG(cog: number | null, lat: number, lon: number): string {
  if (cog === null) return "--";
  const { bearingMode } = getSettings();
  return formatBearing(cog, bearingMode, lat, lon);
}

/** Shorten GPS source name for compact display. */
function shortSource(source: string): string {
  switch (source) {
    case "simulator":
      return "\u25B6SIM"; // ▶SIM
    case "browser-gps":
    case "capacitor-gps":
      return "\uD83D\uDCCD"; // 📍
    case "web-serial":
      return "USB";
    case "ble-nmea":
      return "BLE";
    case "signalk":
      return "\u2693SK"; // ⚓SK
    default:
      return source;
  }
}

const TIER_ICONS: Record<AdaptiveTier, string> = {
  fast: "\u25B2", // ▲
  medium: "\u25CF", // ●
  slow: "\u25A0", // ■
};

// Snap a measured interval to a clean display value — finer near the fast end,
// coarser for slow rates — so EMA jitter doesn't show noisy digits (e.g. an
// ~500 ms pod reads "0.5s", not "0.49s").
function snapIntervalForDisplay(ms: number): number {
  if (ms < 1000) return Math.round(ms / 50) * 50;
  if (ms < 3000) return Math.round(ms / 100) * 100;
  return Math.round(ms / 500) * 500;
}

function formatRateIndicator(tier: AdaptiveTier, intervalMs: number): string {
  const s = snapIntervalForDisplay(intervalMs) / 1000;
  // Whole seconds print bare ("2s"); sub-second keeps up to 2 decimals so a
  // 250 ms rate reads "0.25s" instead of rounding to "0s".
  const txt = Number.isInteger(s)
    ? `${s}`
    : `${Number.parseFloat(s.toFixed(2))}`;
  return `${TIER_ICONS[tier]}${txt}s`;
}

const THERMAL_LABEL: Record<ThermalState, string> = {
  nominal: "",
  fair: "",
  serious: "Warm — frame rate reduced to 5 fps",
  critical: "Hot — frame rate reduced to 5 fps",
};

export class NavigationHUD {
  private readonly container: HTMLDivElement;
  private readonly cursorLine: HTMLDivElement;
  private readonly cogSogLine: HTMLDivElement;
  private readonly gpsLine: HTMLDivElement;
  private readonly gpsPosSpan: HTMLSpanElement;
  private readonly gpsSourceSpan: HTMLSpanElement;
  private readonly gpsAgeSpan: HTMLSpanElement;
  private readonly navManager: NavigationDataManager;
  private lastNavData: NavigationData | null = null;
  private readonly thermalBadge: HTMLSpanElement;

  constructor(
    map: maplibregl.Map,
    navManager: NavigationDataManager,
    waypointLayer: WaypointLayer,
    thermalMonitor?: ThermalMonitor,
  ) {
    this.container = document.createElement("div");
    this.container.className = "nav-hud";

    // Collapse toggle for mobile. Default-collapsed \u2014 the panel mostly
    // duplicates info shown in the instrument HUD and the chart itself,
    // so it's only useful when the user wants the extra lat/lon/GPS
    // detail. Persisted across reloads.
    const HUD_COLLAPSED_KEY = "pelorus-nav-hud-collapsed";
    const toggleBtn = document.createElement("button");
    toggleBtn.className = "nav-hud-toggle";
    toggleBtn.setAttribute("aria-label", "Toggle HUD details");
    let hudCollapsed = true;
    try {
      const saved = localStorage.getItem(HUD_COLLAPSED_KEY);
      if (saved === "0") hudCollapsed = false;
    } catch {
      /* ignore */
    }
    const applyCollapsed = () => {
      toggleBtn.textContent = hudCollapsed ? "\u25B2" : "\u25BC";
      cursorSpan.style.display = hudCollapsed ? "none" : "";
      this.cogSogLine.style.display = hudCollapsed ? "none" : "";
      this.gpsLine.style.display = hudCollapsed ? "none" : "";
    };
    toggleBtn.addEventListener("click", () => {
      hudCollapsed = !hudCollapsed;
      try {
        localStorage.setItem(HUD_COLLAPSED_KEY, hudCollapsed ? "1" : "0");
      } catch {
        /* ignore */
      }
      applyCollapsed();
    });

    this.cursorLine = document.createElement("div");
    const zoomSpan = document.createElement("span");
    const cursorSpan = document.createElement("span");
    cursorSpan.className = "nav-hud-cursor-coords";
    // Thermal indicator: hidden while pressure is nominal/fair, shown
    // with a colour when the throttle kicks in to slow rendering down.
    this.thermalBadge = document.createElement("span");
    this.thermalBadge.className = "nav-hud-thermal";
    this.thermalBadge.textContent = "\u{1F321}️"; // thermometer
    this.thermalBadge.style.display = "none";
    this.cursorLine.append(cursorSpan, zoomSpan, this.thermalBadge);

    this.cogSogLine = document.createElement("div");
    this.cogSogLine.textContent = "COG --  SOG --";
    this.navManager = navManager;
    this.gpsLine = document.createElement("div");
    this.gpsPosSpan = document.createElement("span");
    this.gpsPosSpan.textContent = "GPS: --";
    // Connection indicator: green = connected + fresh fix, amber = connected
    // but stale / reconnecting, red = disconnected. Coloured via data-conn.
    this.gpsSourceSpan = document.createElement("span");
    this.gpsSourceSpan.className = "nav-hud-conn";
    this.gpsAgeSpan = document.createElement("span");
    this.gpsLine.append(this.gpsPosSpan, this.gpsSourceSpan, this.gpsAgeSpan);

    this.container.append(
      toggleBtn,
      this.cursorLine,
      this.cogSogLine,
      this.gpsLine,
    );
    document.body.appendChild(this.container);

    // Apply the initial collapsed state now that all elements exist.
    applyCollapsed();

    // Click on HUD (not the toggle button) opens Go-To dialog
    const goToDialog = new GoToDialog(map, waypointLayer);
    this.container.addEventListener("click", (e) => {
      if (e.target === toggleBtn) return;
      goToDialog.toggle();
    });

    // Zoom (always shown)
    const updateZoom = () => {
      zoomSpan.textContent = `z${map.getZoom().toFixed(1)}`;
    };
    map.on("zoom", updateZoom);
    map.on("load", updateZoom);
    updateZoom();

    // Cursor coords — only on devices with a pointer that can hover
    const canHover = window.matchMedia("(hover: hover)").matches;
    if (canHover) {
      map.on("mousemove", (e: maplibregl.MapMouseEvent) => {
        const { lng, lat } = e.lngLat;
        cursorSpan.textContent = `${formatLatLon(lat, "lat")} ${formatLatLon(lng, "lon")}  `;
      });
    }

    // Thermal pressure indicator
    if (thermalMonitor) {
      const applyThermal = (s: ThermalState) => {
        this.thermalBadge.dataset.state = s;
        const label = THERMAL_LABEL[s];
        if (label) {
          this.thermalBadge.style.display = "";
          this.thermalBadge.title = label;
          this.thermalBadge.setAttribute("aria-label", label);
        } else {
          this.thermalBadge.style.display = "none";
        }
      };
      applyThermal(thermalMonitor.getState());
      thermalMonitor.onChange(applyThermal);
    }

    // GPS data
    navManager.subscribe((data) => {
      this.lastNavData = data;
      this.renderCogSog();
      const adaptiveState = navManager.getAdaptiveState();
      const rateText =
        navManager.getRateMode() === "adaptive"
          ? ` ${formatRateIndicator(adaptiveState.tier, navManager.getEffectiveIntervalMs())}`
          : "";
      this.gpsPosSpan.textContent = `GPS: ${formatLatLon(data.latitude, "lat")} ${formatLatLon(data.longitude, "lon")} `;
      this.gpsSourceSpan.textContent = `[${shortSource(data.source)}]`;
      this.gpsAgeSpan.textContent = rateText;
      this.updateConnIndicator();
      this.blinkFix();
    });

    // Keep the connection colour and COG/SOG current even when no fixes arrive
    // (a dropped link goes amber/red and blanks the readout rather than
    // freezing on the last value).
    window.setInterval(() => {
      this.updateConnIndicator();
      this.renderCogSog();
    }, 1000);
  }

  /** Render COG/SOG from the last fix, blanked to "--" when the fix is stale. */
  private renderCogSog(): void {
    const data = this.lastNavData;
    if (!data || this.navManager.isFixStale()) {
      this.cogSogLine.textContent = "COG --  SOG --";
      return;
    }
    const settings = getSettings();
    const varText =
      settings.bearingMode === "magnetic"
        ? `  ${formatDeclination(data.latitude, data.longitude)}`
        : "";
    this.cogSogLine.textContent = `COG ${formatCOG(data.cog, data.latitude, data.longitude)}  SOG ${formatSpeed(data.sog, settings.speedUnit)}${varText}`;
  }

  /** Colour the source tag from link state + fix freshness. */
  private updateConnIndicator(): void {
    const provider = this.navManager.getActiveProvider();
    const connected = provider?.isConnected() ?? false;
    const reconnecting = provider?.isReconnecting?.() ?? false;
    const fresh = !this.navManager.isFixStale();
    this.gpsSourceSpan.dataset.conn = connected
      ? fresh
        ? "ok"
        : "warn"
      : reconnecting
        ? "warn"
        : "bad";
  }

  /** Pulse the rate/age tag once per received fix — a live "data flowing" cue. */
  private blinkFix(): void {
    const el = this.gpsAgeSpan;
    el.classList.remove("nav-hud-fix-blink");
    void el.offsetWidth; // force reflow so the animation restarts each fix
    el.classList.add("nav-hud-fix-blink");
  }

  getElement(): HTMLDivElement {
    return this.container;
  }

  /** The cursor/center coordinate span, for external updates (e.g. touch-drag). */
  getCursorCoordsEl(): HTMLSpanElement {
    return this.container.querySelector(
      ".nav-hud-cursor-coords",
    ) as HTMLSpanElement;
  }
}
