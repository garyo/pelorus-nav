/**
 * Floating "Cancel Nav" button shown when active navigation is running.
 * Follows the RecenterButton pattern (MapLibre IControl).
 */

import type maplibregl from "maplibre-gl";
import type {
  ActiveNavigationInfo,
  ActiveNavigationManager,
  ActiveNavigationState,
} from "../navigation/ActiveNavigation";
import { iconSquare } from "./icons";

export class CancelNavButton implements maplibregl.IControl {
  private container: HTMLDivElement | null = null;
  private readonly activeNav: ActiveNavigationManager;

  constructor(activeNav: ActiveNavigationManager) {
    this.activeNav = activeNav;
    this.activeNav.subscribe(this.onNavChange);
  }

  onAdd(): HTMLElement {
    this.container = document.createElement("div");
    this.container.className = "maplibregl-ctrl maplibregl-ctrl-group";
    this.container.style.display = "none";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "cancel-nav-btn";
    button.setAttribute("aria-label", "Cancel navigation");
    button.title = "Cancel navigation";
    button.innerHTML = iconSquare;
    button.addEventListener("click", () => this.activeNav.stop());

    this.container.appendChild(button);
    return this.container;
  }

  onRemove(): void {
    this.container?.remove();
    this.container = null;
  }

  private readonly onNavChange = (
    _info: ActiveNavigationInfo | null,
    state: ActiveNavigationState,
  ): void => {
    if (!this.container) return;
    this.container.style.display = state.type === "idle" ? "none" : "block";
  };
}
