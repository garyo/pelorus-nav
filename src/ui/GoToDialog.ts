/**
 * Go-To dialog: type in a lat/lon to fly the map to that location.
 * Accepts flexible coordinate formats (DMS, DDM, decimal, "deg" keyword, etc.)
 */

import type maplibregl from "maplibre-gl";
import { formatLatLon, parseLatLon } from "../utils/coordinates";

export class GoToDialog {
  private readonly overlay: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private readonly errorSpan: HTMLSpanElement;
  private readonly map: maplibregl.Map;
  private visible = false;

  constructor(map: maplibregl.Map) {
    this.map = map;

    this.overlay = document.createElement("div");
    this.overlay.className = "goto-overlay";

    const card = document.createElement("div");
    card.className = "goto-card";

    const label = document.createElement("div");
    label.className = "goto-label";
    label.textContent = "Go to coordinates";

    this.input = document.createElement("input");
    this.input.type = "text";
    this.input.className = "goto-input";
    this.input.placeholder = "42°18.3'N, 71°03.6'W";
    this.input.spellcheck = false;
    this.input.autocomplete = "off";

    this.errorSpan = document.createElement("span");
    this.errorSpan.className = "goto-error";

    const hint = document.createElement("div");
    hint.className = "goto-hint";
    hint.textContent = "Decimal, deg min, or deg min sec. Use N/S/E/W or -";

    const btnRow = document.createElement("div");
    btnRow.className = "goto-buttons";

    const goBtn = document.createElement("button");
    goBtn.textContent = "Go";
    goBtn.className = "goto-btn goto-btn-go";
    goBtn.addEventListener("click", () => this.submit());

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel";
    cancelBtn.className = "goto-btn";
    cancelBtn.addEventListener("click", () => this.hide());

    btnRow.append(goBtn, cancelBtn);
    card.append(label, this.input, this.errorSpan, hint, btnRow);
    this.overlay.append(card);
    document.body.appendChild(this.overlay);

    // Enter to submit, Escape to dismiss
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.submit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.hide();
      }
    });

    // Clear error on typing
    this.input.addEventListener("input", () => {
      this.errorSpan.textContent = "";
    });

    // Click outside to dismiss
    this.overlay.addEventListener("mousedown", (e) => {
      if (e.target === this.overlay) {
        this.hide();
      }
    });
  }

  show(): void {
    if (this.visible) return;
    this.visible = true;
    this.overlay.style.display = "flex";
    this.errorSpan.textContent = "";

    // Pre-fill with current map center
    const center = this.map.getCenter();
    this.input.value = `${formatLatLon(center.lat, "lat")}, ${formatLatLon(center.lng, "lon")}`;
    this.input.select();
    this.input.focus();
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.overlay.style.display = "none";
  }

  toggle(): void {
    if (this.visible) {
      this.hide();
    } else {
      this.show();
    }
  }

  private submit(): void {
    const result = parseLatLon(this.input.value);
    if (!result) {
      this.errorSpan.textContent = "Could not parse coordinates";
      this.input.focus();
      return;
    }

    const [lat, lon] = result;
    this.map.flyTo({
      center: [lon, lat],
      zoom: Math.max(this.map.getZoom(), 12),
    });
    this.hide();
  }
}
