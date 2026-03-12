/**
 * Floating panel for listing, editing, and deleting standalone waypoints.
 * Follows the RouteManagerPanel pattern.
 */

import { deleteWaypoint, saveWaypoint } from "../data/db";
import type { StandaloneWaypoint, WaypointIcon } from "../data/Waypoint";
import type { WaypointLayer } from "../map/WaypointLayer";
import type { ActiveNavigationManager } from "../navigation/ActiveNavigation";
import { iconEdit, iconNavigation, iconTrash, iconX, setIcon } from "./icons";
import { getPanelStack } from "./PanelStack";

const ICON_LABELS: Record<WaypointIcon, string> = {
  default: "Default",
  anchorage: "Anchorage",
  hazard: "Hazard",
  fuel: "Fuel",
  poi: "POI",
};

export class WaypointManagerPanel {
  private readonly el: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly waypointLayer: WaypointLayer;
  private readonly activeNav: ActiveNavigationManager;

  constructor(
    waypointLayer: WaypointLayer,
    activeNav: ActiveNavigationManager,
  ) {
    this.waypointLayer = waypointLayer;
    this.activeNav = activeNav;

    this.el = document.createElement("div");
    this.el.className = "manager-panel waypoint-manager-panel";
    this.el.innerHTML =
      '<div class="manager-header">' +
      "<span>Waypoints</span>" +
      '<div style="display:flex;gap:6px;align-items:center">' +
      '<button class="manager-close"></button>' +
      "</div>" +
      "</div>" +
      '<div class="manager-body"></div>';
    getPanelStack().appendChild(this.el);

    this.body = this.el.querySelector(".manager-body") as HTMLDivElement;
    const closeBtn = this.el.querySelector(".manager-close") as HTMLElement;
    if (closeBtn) {
      setIcon(closeBtn, iconX);
      closeBtn.addEventListener("click", () => this.hide());
    }
  }

  toggle(): void {
    if (this.el.classList.contains("open")) {
      this.hide();
    } else {
      this.show();
    }
  }

  show(): void {
    this.el.classList.add("open");
    this.refresh();
  }

  hide(): void {
    this.el.classList.remove("open");
  }

  refresh(): void {
    const waypoints = this.waypointLayer.getWaypoints();

    if (waypoints.length === 0) {
      this.body.innerHTML = '<div class="manager-empty">No waypoints</div>';
      return;
    }

    this.body.innerHTML = "";
    // Sort by creation time, newest first
    const sorted = [...waypoints].sort((a, b) => b.createdAt - a.createdAt);
    for (const wp of sorted) {
      this.body.appendChild(this.createWaypointItem(wp));
    }
  }

  private createWaypointItem(wp: StandaloneWaypoint): HTMLDivElement {
    const item = document.createElement("div");
    item.className = "manager-item";

    const iconDot = document.createElement("div");
    iconDot.className = "manager-item-color";
    iconDot.style.backgroundColor = this.iconColor(wp.icon);
    iconDot.title = ICON_LABELS[wp.icon];

    const info = document.createElement("div");
    info.className = "manager-item-info";

    const name = document.createElement("div");
    name.className = "manager-item-name";
    name.textContent = wp.name;
    name.title = "Double-click to rename";
    name.style.cursor = "pointer";
    name.addEventListener("dblclick", () => this.rename(wp, name));

    const detail = document.createElement("div");
    detail.className = "manager-item-detail";
    detail.textContent = wp.notes || ICON_LABELS[wp.icon];

    info.append(name, detail);

    const actions = document.createElement("div");
    actions.className = "manager-item-actions";

    const navBtn = document.createElement("button");
    navBtn.className = "manager-item-btn";
    setIcon(navBtn, iconNavigation);
    navBtn.title = "Navigate to";
    navBtn.addEventListener("click", () => {
      this.activeNav.startGoto(wp);
    });

    const editBtn = document.createElement("button");
    editBtn.className = "manager-item-btn";
    setIcon(editBtn, iconEdit);
    editBtn.title = "Edit";
    editBtn.addEventListener("click", () => {
      this.showEditDialog(wp);
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "manager-item-btn";
    setIcon(deleteBtn, iconTrash);
    deleteBtn.title = "Delete";
    deleteBtn.addEventListener("click", () => {
      if (!confirm(`Delete waypoint "${wp.name}"?`)) return;
      (async () => {
        // Cancel navigation if this waypoint is the active target
        const state = this.activeNav.getState();
        if (
          state.type === "goto" &&
          "id" in state.waypoint &&
          state.waypoint.id === wp.id
        ) {
          this.activeNav.stop();
        }
        await deleteWaypoint(wp.id);
        await this.waypointLayer.removeWaypoint(wp.id);
        this.refresh();
      })().catch(console.error);
    });

    actions.append(navBtn, editBtn, deleteBtn);
    item.append(iconDot, info, actions);
    return item;
  }

  private iconColor(icon: WaypointIcon): string {
    switch (icon) {
      case "anchorage":
        return "#3366cc";
      case "hazard":
        return "#cc2222";
      case "fuel":
        return "#228833";
      case "poi":
        return "#8833aa";
      default:
        return "#ff8800";
    }
  }

  private async rename(
    wp: StandaloneWaypoint,
    nameEl: HTMLDivElement,
  ): Promise<void> {
    const input = document.createElement("input");
    input.type = "text";
    input.value = wp.name;
    input.className = "map-context-input";
    input.style.margin = "0";
    input.style.width = "100%";
    nameEl.replaceWith(input);
    input.focus();
    input.select();

    const finish = async () => {
      const newName = input.value.trim() || wp.name;
      wp.name = newName;
      wp.updatedAt = Date.now();
      await saveWaypoint(wp);
      await this.waypointLayer.updateWaypoint(wp);
      this.refresh();
    };

    input.addEventListener("blur", finish);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") input.blur();
      if (e.key === "Escape") {
        input.value = wp.name;
        input.blur();
      }
    });
  }

  private showEditDialog(wp: StandaloneWaypoint): void {
    // Simple inline edit: replace the item with an edit form
    const form = document.createElement("div");
    form.className = "waypoint-edit-form";
    form.innerHTML =
      '<label>Name <input type="text" class="wp-edit-name map-context-input" /></label>' +
      '<label>Notes <input type="text" class="wp-edit-notes map-context-input" /></label>' +
      '<label>Icon <select class="wp-edit-icon map-context-input"></select></label>' +
      '<div class="wp-edit-actions">' +
      '<button class="route-editor-btn wp-edit-save">Save</button>' +
      '<button class="route-editor-btn wp-edit-cancel">Cancel</button>' +
      "</div>";

    const nameInput = form.querySelector(".wp-edit-name") as HTMLInputElement;
    nameInput.value = wp.name;

    const notesInput = form.querySelector(".wp-edit-notes") as HTMLInputElement;
    notesInput.value = wp.notes;

    const iconSelect = form.querySelector(".wp-edit-icon") as HTMLSelectElement;
    for (const [value, label] of Object.entries(ICON_LABELS)) {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      if (value === wp.icon) opt.selected = true;
      iconSelect.appendChild(opt);
    }

    const save = async () => {
      wp.name = nameInput.value.trim() || wp.name;
      wp.notes = notesInput.value.trim();
      wp.icon = iconSelect.value as WaypointIcon;
      wp.updatedAt = Date.now();
      await saveWaypoint(wp);
      await this.waypointLayer.updateWaypoint(wp);
      this.refresh();
    };

    form
      .querySelector(".wp-edit-save")
      ?.addEventListener("click", () => save().catch(console.error));
    form
      .querySelector(".wp-edit-cancel")
      ?.addEventListener("click", () => this.refresh());

    this.body.innerHTML = "";
    this.body.appendChild(form);
  }
}
