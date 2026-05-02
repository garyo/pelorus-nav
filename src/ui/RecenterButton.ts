/**
 * MapLibre IControl: "Re-center" button shown when in free mode with GPS active.
 */

import type maplibregl from "maplibre-gl";
import { iconCrosshair, setIcon } from "./icons";

export interface RecenterButtonOptions {
  onRecenter: () => void;
}

export class RecenterButton implements maplibregl.IControl {
  private container: HTMLDivElement | null = null;
  private button: HTMLButtonElement | null = null;
  private readonly onRecenter: () => void;
  private visible = false;
  private enabled = true;

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
    setIcon(button, iconCrosshair);
    button.addEventListener("click", () => {
      if (this.enabled) this.onRecenter();
    });
    this.button = button;

    this.container.appendChild(button);
    this.setVisible(this.visible);
    this.setEnabled(this.enabled);
    return this.container;
  }

  onRemove(): void {
    this.container?.remove();
    this.container = null;
    this.button = null;
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (this.container) {
      this.container.style.display = visible ? "block" : "none";
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (this.button) {
      this.button.disabled = !enabled;
      this.button.title = enabled
        ? "Re-center on vessel"
        : "Re-center on vessel (no GPS fix)";
    }
  }
}
