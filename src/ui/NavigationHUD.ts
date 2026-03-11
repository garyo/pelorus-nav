/**
 * Navigation HUD: displays cursor position, zoom, COG/SOG, and GPS source.
 * Compact overlay at bottom-left of the map.
 */

import type maplibregl from "maplibre-gl";
import type { NavigationDataManager } from "../navigation/NavigationDataManager";
import type { SpeedUnit } from "../settings";
import { getSettings } from "../settings";
import { formatLatLon } from "../utils/coordinates";
import { convertSpeed, speedUnitLabel } from "../utils/units";

function formatSpeed(knots: number | null, unit: SpeedUnit): string {
  if (knots === null) return "--";
  const value = convertSpeed(knots, unit);
  const label = unit === "knots" ? "kn" : speedUnitLabel(unit);
  return `${value.toFixed(1)} ${label}`;
}

function formatCOG(cog: number | null): string {
  if (cog === null) return "--";
  return `${cog.toFixed(0).padStart(3, "0")}\u00b0T`;
}

/** Shorten GPS source name for compact display. */
function shortSource(source: string): string {
  if (source === "simulator") return "sim";
  return source;
}

export class NavigationHUD {
  private readonly container: HTMLDivElement;
  private readonly cursorLine: HTMLDivElement;
  private readonly cogSogLine: HTMLDivElement;
  private readonly gpsLine: HTMLDivElement;

  constructor(map: maplibregl.Map, navManager: NavigationDataManager) {
    this.container = document.createElement("div");
    this.container.className = "nav-hud";

    this.cursorLine = document.createElement("div");
    this.cogSogLine = document.createElement("div");
    this.gpsLine = document.createElement("div");

    this.container.append(this.cursorLine, this.cogSogLine, this.gpsLine);
    document.body.appendChild(this.container);

    // Cursor position + zoom on same line
    let zoomText = `z${map.getZoom().toFixed(1)}`;
    let cursorText = "";

    const updateCursorLine = () => {
      this.cursorLine.textContent = cursorText
        ? `${cursorText}  ${zoomText}`
        : zoomText;
    };

    const updateZoom = () => {
      zoomText = `z${map.getZoom().toFixed(1)}`;
      updateCursorLine();
    };
    map.on("zoom", updateZoom);
    map.on("load", updateZoom);
    updateCursorLine();

    map.on("mousemove", (e: maplibregl.MapMouseEvent) => {
      const { lng, lat } = e.lngLat;
      cursorText = `${formatLatLon(lat, "lat")} ${formatLatLon(lng, "lon")}`;
      updateCursorLine();
    });

    // GPS data
    navManager.subscribe((data) => {
      const settings = getSettings();
      this.cogSogLine.textContent = `COG ${formatCOG(data.cog)}  SOG ${formatSpeed(data.sog, settings.speedUnit)}`;
      this.gpsLine.textContent = `GPS: ${formatLatLon(data.latitude, "lat")} ${formatLatLon(data.longitude, "lon")} [${shortSource(data.source)}]`;
    });
  }

  getElement(): HTMLDivElement {
    return this.container;
  }
}
