/**
 * MapLibre IControl: the top-right zoom in / zoom out / reset-north group.
 *
 * Replaces MapLibre's NavigationControl, which passes the button click to
 * the camera as `originalEvent` — the signal ChartModeController reads as
 * "the user is panning, release follow mode". A zoom button (or the
 * compass) is not a look-away, so these buttons move the camera without
 * eventData, the way the volume keys do, and follow/course-up/north-up
 * survive. Camera moves are instant: an eased zoom would be cut short by
 * the next per-frame recenter, and e-ink smears animation anyway.
 *
 * Uses MapLibre's own class names so its stylesheet draws the icons and
 * the app's mobile/e-ink button sizing applies unchanged.
 */

import type * as maplibregl from "maplibre-gl";
import { getSettings, onSettingsChange } from "../settings";

const ZOOM_STEP = 1;

export class ZoomControl implements maplibregl.IControl {
  private map: maplibregl.Map | null = null;
  private container: HTMLDivElement | null = null;
  private zoomIn: HTMLButtonElement | null = null;
  private zoomOut: HTMLButtonElement | null = null;
  private compassIcon: HTMLSpanElement | null = null;

  onAdd(map: maplibregl.Map): HTMLElement {
    this.map = map;
    const container = document.createElement("div");
    container.className = "maplibregl-ctrl maplibregl-ctrl-group";
    container.addEventListener("contextmenu", (e) => e.preventDefault());
    this.container = container;

    this.zoomIn = this.addButton("maplibregl-ctrl-zoom-in", "Zoom in", () =>
      map.setZoom(map.getZoom() + ZOOM_STEP),
    );
    this.zoomOut = this.addButton("maplibregl-ctrl-zoom-out", "Zoom out", () =>
      map.setZoom(map.getZoom() - ZOOM_STEP),
    );
    const compass = this.addButton(
      "maplibregl-ctrl-compass",
      "Reset bearing to north",
      () => map.setBearing(0),
    );
    this.compassIcon = compass.querySelector("span");

    map.on("zoom", this.updateZoomButtons);
    map.on("rotate", this.rotateCompass);
    this.updateZoomButtons();
    this.rotateCompass();

    this.applyVisibility(getSettings().showZoomButtons);
    onSettingsChange((s) => this.applyVisibility(s.showZoomButtons));
    return container;
  }

  onRemove(): void {
    this.map?.off("zoom", this.updateZoomButtons);
    this.map?.off("rotate", this.rotateCompass);
    this.container?.remove();
    this.container = null;
    this.map = null;
  }

  private addButton(
    className: string,
    title: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.title = title;
    button.setAttribute("aria-label", title);
    const icon = document.createElement("span");
    icon.className = "maplibregl-ctrl-icon";
    icon.setAttribute("aria-hidden", "true");
    button.appendChild(icon);
    button.addEventListener("click", onClick);
    this.container?.appendChild(button);
    return button;
  }

  private applyVisibility(visible: boolean): void {
    if (this.container) this.container.style.display = visible ? "" : "none";
  }

  private readonly updateZoomButtons = (): void => {
    if (!this.map || !this.zoomIn || !this.zoomOut) return;
    const zoom = this.map.getZoom();
    const isMax = zoom >= this.map.getMaxZoom();
    const isMin = zoom <= this.map.getMinZoom();
    this.zoomIn.disabled = isMax;
    this.zoomOut.disabled = isMin;
    this.zoomIn.setAttribute("aria-disabled", String(isMax));
    this.zoomOut.setAttribute("aria-disabled", String(isMin));
  };

  private readonly rotateCompass = (): void => {
    if (!this.map || !this.compassIcon) return;
    this.compassIcon.style.transform = `rotate(${-this.map.getBearing()}deg)`;
  };
}
