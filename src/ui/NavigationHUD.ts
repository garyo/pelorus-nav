/**
 * Navigation HUD: displays COG, SOG, position, and GPS source.
 * Replaces the ad-hoc cursor HUD in main.ts with a unified display.
 */

import type maplibregl from "maplibre-gl";
import type { NavigationDataManager } from "../navigation/NavigationDataManager";
import type { SpeedUnit } from "../settings";
import { getSettings } from "../settings";
import { formatLatLon } from "../utils/coordinates";

function formatSpeed(knots: number | null, unit: SpeedUnit): string {
  if (knots === null) return "--";
  let value: number;
  let label: string;
  switch (unit) {
    case "mph":
      value = knots * 1.15078;
      label = "mph";
      break;
    case "kph":
      value = knots * 1.852;
      label = "km/h";
      break;
    default:
      value = knots;
      label = "kn";
  }
  return `${value.toFixed(1)} ${label}`;
}

function formatCOG(cog: number | null): string {
  if (cog === null) return "--";
  return `${cog.toFixed(0).padStart(3, "0")}\u00b0T`;
}

export class NavigationHUD {
  private readonly container: HTMLDivElement;
  private readonly zoomLine: HTMLDivElement;
  private readonly cursorLine: HTMLDivElement;
  private readonly gpsLine: HTMLDivElement;
  private readonly cogSogLine: HTMLDivElement;

  constructor(map: maplibregl.Map, navManager: NavigationDataManager) {
    this.container = document.createElement("div");
    this.container.className = "nav-hud";

    this.zoomLine = document.createElement("div");
    this.cursorLine = document.createElement("div");
    this.gpsLine = document.createElement("div");
    this.cogSogLine = document.createElement("div");

    this.container.append(
      this.zoomLine,
      this.cursorLine,
      this.cogSogLine,
      this.gpsLine,
    );
    document.body.appendChild(this.container);

    // Zoom display
    const updateZoom = () => {
      this.zoomLine.textContent = `z${map.getZoom().toFixed(1)}`;
    };
    map.on("zoom", updateZoom);
    map.on("load", updateZoom);

    // Cursor position
    map.on("mousemove", (e: maplibregl.MapMouseEvent) => {
      const { lng, lat } = e.lngLat;
      this.cursorLine.textContent = `${formatLatLon(lat, "lat")} ${formatLatLon(lng, "lon")}`;
    });

    // GPS data
    navManager.subscribe((data) => {
      const settings = getSettings();
      this.cogSogLine.textContent = `COG ${formatCOG(data.cog)}  SOG ${formatSpeed(data.sog, settings.speedUnit)}`;
      this.gpsLine.textContent = `GPS: ${formatLatLon(data.latitude, "lat")} ${formatLatLon(data.longitude, "lon")} [${data.source}]`;
    });
  }

  getElement(): HTMLDivElement {
    return this.container;
  }
}
