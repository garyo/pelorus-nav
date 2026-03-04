import type maplibregl from "maplibre-gl";
import type { ChartManager } from "./ChartManager";

/**
 * MapLibre IControl that renders a dropdown to switch chart providers.
 */
export class ChartSwitcherControl implements maplibregl.IControl {
  private container: HTMLElement | null = null;
  private chartManager: ChartManager;

  constructor(chartManager: ChartManager) {
    this.chartManager = chartManager;
  }

  onAdd(): HTMLElement {
    this.container = document.createElement("div");
    this.container.className =
      "maplibregl-ctrl maplibregl-ctrl-group chart-switcher";

    const select = document.createElement("select");
    select.className = "chart-switcher-select";
    select.setAttribute("aria-label", "Chart source");

    const providers = this.chartManager.getProviders();
    const active = this.chartManager.getActiveProvider();

    for (const provider of providers) {
      const option = document.createElement("option");
      option.value = provider.id;
      option.textContent = provider.name;
      if (active && provider.id === active.id) {
        option.selected = true;
      }
      select.appendChild(option);
    }

    select.addEventListener("change", () => {
      this.chartManager.setActiveProvider(select.value);
    });

    this.container.appendChild(select);
    return this.container;
  }

  onRemove(): void {
    this.container?.remove();
    this.container = null;
  }
}
