/**
 * Navigation HUD: displays cursor position, zoom, COG/SOG, and GPS source.
 * Compact overlay at bottom-left of the map.
 */

import type maplibregl from "maplibre-gl";
import type { AdaptiveTier } from "../navigation/AdaptiveRate";
import type { NavigationDataManager } from "../navigation/NavigationDataManager";
import type { SpeedUnit } from "../settings";
import { getSettings } from "../settings";
import { formatLatLon } from "../utils/coordinates";
import { formatBearing, formatDeclination } from "../utils/magnetic";
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

function formatRateIndicator(tier: AdaptiveTier, intervalMs: number): string {
  return `${TIER_ICONS[tier]}${(intervalMs / 1000).toFixed(0)}s`;
}

export class NavigationHUD {
  private readonly container: HTMLDivElement;
  private readonly cursorLine: HTMLDivElement;
  private readonly cogSogLine: HTMLDivElement;
  private readonly gpsLine: HTMLDivElement;

  constructor(map: maplibregl.Map, navManager: NavigationDataManager) {
    this.container = document.createElement("div");
    this.container.className = "nav-hud";

    // Collapse toggle for mobile
    const toggleBtn = document.createElement("button");
    toggleBtn.className = "nav-hud-toggle";
    toggleBtn.textContent = "\u25BC";
    toggleBtn.setAttribute("aria-label", "Toggle HUD details");
    let hudCollapsed = false;
    toggleBtn.addEventListener("click", () => {
      hudCollapsed = !hudCollapsed;
      toggleBtn.textContent = hudCollapsed ? "\u25B2" : "\u25BC";
      cursorSpan.style.display = hudCollapsed ? "none" : "";
      this.cogSogLine.style.display = hudCollapsed ? "none" : "";
      this.gpsLine.style.display = hudCollapsed ? "none" : "";
    });

    this.cursorLine = document.createElement("div");
    const zoomSpan = document.createElement("span");
    const cursorSpan = document.createElement("span");
    cursorSpan.className = "nav-hud-cursor-coords";
    this.cursorLine.append(cursorSpan, zoomSpan);

    this.cogSogLine = document.createElement("div");
    this.cogSogLine.textContent = "COG --  SOG --";
    this.gpsLine = document.createElement("div");
    this.gpsLine.textContent = "GPS: --";

    this.container.append(
      toggleBtn,
      this.cursorLine,
      this.cogSogLine,
      this.gpsLine,
    );
    document.body.appendChild(this.container);

    // Click on HUD (not the toggle button) opens Go-To dialog
    const goToDialog = new GoToDialog(map);
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

    // GPS data
    navManager.subscribe((data) => {
      const settings = getSettings();
      this.cogSogLine.textContent = `COG ${formatCOG(data.cog, data.latitude, data.longitude)}  SOG ${formatSpeed(data.sog, settings.speedUnit)}`;
      const varText =
        settings.bearingMode === "magnetic"
          ? `  ${formatDeclination(data.latitude, data.longitude)}`
          : "";
      const adaptiveState = navManager.getAdaptiveState();
      const rateText =
        navManager.getRateMode() === "adaptive"
          ? ` ${formatRateIndicator(adaptiveState.tier, adaptiveState.intervalMs)}`
          : "";
      this.gpsLine.textContent = `GPS: ${formatLatLon(data.latitude, "lat")} ${formatLatLon(data.longitude, "lon")} [${shortSource(data.source)}]${rateText}${varText}`;
    });
  }

  getElement(): HTMLDivElement {
    return this.container;
  }
}
