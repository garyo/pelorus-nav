/**
 * Floating panel for listing, toggling, editing, and deleting routes.
 */

import { deleteRoute, getAllRoutes, saveRoute } from "../data/db";
import type { Route } from "../data/Route";
import type { RouteEditor } from "../map/RouteEditor";
import type { RouteLayer } from "../map/RouteLayer";
import type { ActiveNavigationManager } from "../navigation/ActiveNavigation";
import {
  iconEdit,
  iconEye,
  iconEyeOff,
  iconNavigation,
  iconTrash,
  iconX,
  setIcon,
} from "./icons";
import { getPanelStack } from "./PanelStack";
import { RouteDetailPanel } from "./RouteDetailPanel";

export class RouteManagerPanel {
  private readonly el: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly routeLayer: RouteLayer;
  private readonly editor: RouteEditor;
  private readonly detailPanel: RouteDetailPanel;
  private activeNav: ActiveNavigationManager | null = null;

  constructor(routeLayer: RouteLayer, editor: RouteEditor) {
    this.routeLayer = routeLayer;
    this.editor = editor;
    this.detailPanel = new RouteDetailPanel(routeLayer);

    this.el = document.createElement("div");
    this.el.className = "manager-panel route-manager-panel";
    this.el.innerHTML =
      '<div class="manager-header">' +
      "<span>Routes</span>" +
      '<div style="display:flex;gap:6px;align-items:center">' +
      '<button class="route-editor-btn" id="route-new-btn">New</button>' +
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
    this.el.querySelector("#route-new-btn")?.addEventListener("click", () => {
      this.hide();
      this.editor.startEditing();
    });

    editor.onEditorChange(() => this.refresh());
  }

  setActiveNav(activeNav: ActiveNavigationManager): void {
    this.activeNav = activeNav;
    this.detailPanel.setActiveNav(activeNav);
  }

  /** Show the detail panel for the currently navigated route (if any). */
  showActiveRoute(): void {
    if (!this.activeNav) return;
    const st = this.activeNav.getState();
    if (st.type === "route") {
      this.detailPanel.show(st.route);
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

  private async refresh(): Promise<void> {
    const routes = await getAllRoutes();
    routes.sort((a, b) => b.createdAt - a.createdAt);

    if (routes.length === 0) {
      this.body.innerHTML = '<div class="manager-empty">No routes</div>';
      return;
    }

    this.body.innerHTML = "";
    for (const route of routes) {
      this.body.appendChild(this.createRouteItem(route));
    }
  }

  private createRouteItem(route: Route): HTMLDivElement {
    const item = document.createElement("div");
    item.className = "manager-item";

    const color = document.createElement("div");
    color.className = "manager-item-color";
    color.style.backgroundColor = route.color;
    color.title = "Change color";
    color.addEventListener("click", () => this.pickColor(route, color));

    const info = document.createElement("div");
    info.className = "manager-item-info";

    const name = document.createElement("div");
    name.className = "manager-item-name";
    name.textContent = route.name;
    name.title = "Click for details, double-click to rename";
    name.style.cursor = "pointer";
    let clickTimer: ReturnType<typeof setTimeout> | null = null;
    name.addEventListener("click", () => {
      if (clickTimer) return; // second click of a dblclick — ignore
      clickTimer = setTimeout(() => {
        clickTimer = null;
        this.detailPanel.show(route);
      }, 250);
    });
    name.addEventListener("dblclick", () => {
      if (clickTimer) {
        clearTimeout(clickTimer);
        clickTimer = null;
      }
      this.rename(route, name);
    });

    const detail = document.createElement("div");
    detail.className = "manager-item-detail";
    detail.textContent = `${route.waypoints.length} waypoints`;

    info.append(name, detail);

    const actions = document.createElement("div");
    actions.className = "manager-item-actions";

    const navBtn = document.createElement("button");
    navBtn.className = "manager-item-btn route-nav-btn";
    setIcon(navBtn, iconNavigation);
    // Highlight if already navigating this route
    const navState = this.activeNav?.getState();
    const isNavActive =
      navState?.type === "route" && navState.route.id === route.id;
    navBtn.classList.toggle("active", isNavActive);
    navBtn.title = isNavActive ? "Stop navigation" : "Navigate route";
    navBtn.addEventListener("click", () => {
      if (this.activeNav) {
        const st = this.activeNav.getState();
        if (st.type === "route" && st.route.id === route.id) {
          this.activeNav.stop();
        } else {
          // Show route if hidden before starting navigation
          if (!route.visible) {
            route.visible = true;
            saveRoute(route).catch(console.error);
            this.routeLayer
              .toggleVisibility(route.id, true)
              .catch(console.error);
          }
          this.activeNav.startRoute(route);
        }
        this.refresh().catch(console.error);
      }
    });

    const editBtn = document.createElement("button");
    editBtn.className = "manager-item-btn";
    setIcon(editBtn, iconEdit);
    editBtn.title = "Edit";
    editBtn.addEventListener("click", () => {
      this.hide();
      this.editor.startEditing(route);
    });

    const toggleBtn = document.createElement("button");
    toggleBtn.className = "manager-item-btn";
    setIcon(toggleBtn, route.visible ? iconEye : iconEyeOff);
    toggleBtn.title = route.visible ? "Hide" : "Show";
    toggleBtn.addEventListener("click", () => {
      (async () => {
        route.visible = !route.visible;
        // Stop navigation if hiding the actively navigated route
        if (!route.visible && this.activeNav) {
          const st = this.activeNav.getState();
          if (st.type === "route" && st.route.id === route.id) {
            this.activeNav.stop();
          }
        }
        await saveRoute(route);
        await this.routeLayer.toggleVisibility(route.id, route.visible);
        await this.refresh();
      })().catch(console.error);
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "manager-item-btn";
    setIcon(deleteBtn, iconTrash);
    deleteBtn.title = "Delete";
    deleteBtn.addEventListener("click", () => {
      if (!confirm(`Delete route "${route.name}"?`)) return;
      (async () => {
        await deleteRoute(route.id);
        await this.routeLayer.reloadAll();
        await this.refresh();
      })().catch(console.error);
    });

    actions.append(navBtn, editBtn, toggleBtn, deleteBtn);
    item.append(color, info, actions);
    return item;
  }

  private async rename(route: Route, nameEl: HTMLDivElement): Promise<void> {
    const input = document.createElement("input");
    input.type = "text";
    input.value = route.name;
    input.className = "map-context-input";
    input.style.margin = "0";
    input.style.width = "100%";
    nameEl.replaceWith(input);
    input.focus();
    input.select();

    const finish = async () => {
      const newName = input.value.trim() || route.name;
      route.name = newName;
      await saveRoute(route);
      this.refresh();
    };

    input.addEventListener("blur", finish);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") input.blur();
      if (e.key === "Escape") {
        input.value = route.name;
        input.blur();
      }
    });
  }

  private async pickColor(
    route: Route,
    colorEl: HTMLDivElement,
  ): Promise<void> {
    const input = document.createElement("input");
    input.type = "color";
    input.value = route.color;
    input.style.position = "absolute";
    input.style.opacity = "0";
    colorEl.appendChild(input);
    input.click();

    input.addEventListener("input", () => {
      route.color = input.value;
      colorEl.style.backgroundColor = input.value;
    });

    input.addEventListener("change", async () => {
      route.color = input.value;
      await saveRoute(route);
      await this.routeLayer.reloadAll();
      input.remove();
    });
  }
}
