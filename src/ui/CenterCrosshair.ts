/**
 * Center crosshair overlay for the map.
 *
 * Two use cases:
 * 1. Flash briefly after go-to / search navigation so the user sees where they landed.
 * 2. Show during touch-drag on mobile, with nav HUD center coords.
 */

import type maplibregl from "maplibre-gl";
import { formatLatLon } from "../utils/coordinates";

const FLASH_DURATION_MS = 3000;
const FADE_DURATION_MS = 600;

export class CenterCrosshair {
  private readonly el: HTMLDivElement;
  private readonly map: maplibregl.Map;
  private readonly coordsEl: HTMLSpanElement | null;
  private fadeTimer: ReturnType<typeof setTimeout> | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private touchDragging = false;

  constructor(map: maplibregl.Map, coordsEl: HTMLSpanElement | null) {
    this.map = map;
    this.coordsEl = coordsEl;

    this.el = document.createElement("div");
    this.el.className = "center-crosshair";
    this.el.style.opacity = "0";
    this.el.style.pointerEvents = "none";

    // Insert into the map container so it stays centered over the map
    map.getContainer().appendChild(this.el);

    // Flash crosshair after programmatic navigation (search, go-to)
    map.on("pelorus:navigate" as never, () => this.flash());

    // Touch-drag crosshair — always set up; the `touching` flag inside
    // ensures it only activates on actual touch gestures.
    this.setupTouchDrag();
  }

  /** Show crosshair briefly (e.g. after flyTo). */
  flash(): void {
    this.clearTimers();
    this.el.style.transition = "none";
    this.el.style.opacity = "1";

    this.fadeTimer = setTimeout(() => {
      this.el.style.transition = `opacity ${FADE_DURATION_MS}ms ease-out`;
      this.el.style.opacity = "0";
    }, FLASH_DURATION_MS);
  }

  private show(): void {
    this.clearTimers();
    this.el.style.transition = "opacity 150ms ease-in";
    this.el.style.opacity = "1";
  }

  private hide(): void {
    this.clearTimers();
    this.el.style.transition = `opacity ${FADE_DURATION_MS}ms ease-out`;
    this.el.style.opacity = "0";
  }

  private clearTimers(): void {
    if (this.fadeTimer) {
      clearTimeout(this.fadeTimer);
      this.fadeTimer = null;
    }
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }

  private setupTouchDrag(): void {
    // MapLibre fires "movestart"/"moveend" for both touch and programmatic moves.
    // Track touch state to distinguish user drags from flyTo animations.
    const canvas = this.map.getCanvasContainer();
    let touching = false;

    canvas.addEventListener("touchstart", () => {
      touching = true;
    }, { passive: true });
    canvas.addEventListener("touchend", () => {
      touching = false;
    }, { passive: true });
    canvas.addEventListener("touchcancel", () => {
      touching = false;
    }, { passive: true });

    this.map.on("movestart", () => {
      if (!touching) return;
      this.touchDragging = true;
      this.show();
      this.coordsEl?.classList.add("dragging");
      this.updateCenterCoords();
    });

    this.map.on("move", () => {
      if (!this.touchDragging) return;
      this.updateCenterCoords();
    });

    // Pinch-to-zoom also shifts the center — show crosshair + coords
    this.map.on("zoomstart", () => {
      if (!touching) return;
      if (!this.touchDragging) {
        this.touchDragging = true;
        this.show();
        this.coordsEl?.classList.add("dragging");
      }
      this.updateCenterCoords();
    });

    this.map.on("zoom", () => {
      if (!this.touchDragging) return;
      this.updateCenterCoords();
    });

    this.map.on("moveend", () => {
      if (!this.touchDragging) return;
      this.touchDragging = false;
      // Keep showing briefly after drag ends, then fade
      this.fadeTimer = setTimeout(() => {
        this.hide();
        this.hideTimer = setTimeout(() => {
          this.coordsEl?.classList.remove("dragging");
          if (this.coordsEl) this.coordsEl.textContent = "";
        }, FADE_DURATION_MS);
      }, 1000);
    });
  }

  private updateCenterCoords(): void {
    if (!this.coordsEl) return;
    const { lng, lat } = this.map.getCenter();
    this.coordsEl.textContent = `${formatLatLon(lat, "lat")} ${formatLatLon(lng, "lon")}  `;
  }
}
