/**
 * MapLibre IControl: "Re-center" button shown when in free mode with GPS active.
 */

import type maplibregl from "maplibre-gl";

export interface RecenterButtonOptions {
  onRecenter: () => void;
}

export class RecenterButton implements maplibregl.IControl {
  private container: HTMLDivElement | null = null;
  private readonly onRecenter: () => void;
  private visible = false;

  constructor(options: RecenterButtonOptions) {
    this.onRecenter = options.onRecenter;
  }

  onAdd(): HTMLElement {
    this.container = document.createElement("div");
    this.container.className = "maplibregl-ctrl maplibregl-ctrl-group";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "recenter-btn";
    button.setAttribute("aria-label", "Re-center on vessel");
    button.title = "Re-center on vessel";
    button.innerHTML = "&#8982;"; // crosshair ⌖
    button.addEventListener("click", () => this.onRecenter());

    this.container.appendChild(button);
    this.setVisible(this.visible);
    return this.container;
  }

  onRemove(): void {
    this.container?.remove();
    this.container = null;
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (this.container) {
      this.container.style.display = visible ? "block" : "none";
    }
  }
}
