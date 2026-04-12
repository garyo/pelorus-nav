/**
 * Floating panel for listing, toggling, editing, and deleting routes.
 */

import { deleteRoute, getAllRoutes, saveRoute, saveWaypoint } from "../data/db";
import {
  downloadFile,
  GPX_MIME,
  pickFile,
  sanitizeFilename,
} from "../data/file-io";
import { exportAllToGpx, parseGpx, routeToGpx } from "../data/gpx";
import type { Route } from "../data/Route";
import type { RouteEditor } from "../map/RouteEditor";
import type { RouteLayer } from "../map/RouteLayer";
import type { WaypointLayer } from "../map/WaypointLayer";
import type { ActiveNavigationManager } from "../navigation/ActiveNavigation";
import { getSettings } from "../settings";
import { haversineDistanceNM } from "../utils/coordinates";
import {
  iconDownload,
  iconEdit,
  iconEye,
  iconEyeOff,
  iconNavigation,
  iconTrash,
  iconUpload,
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
  private waypointLayer: WaypointLayer | null = null;
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
      '<button class="manager-item-btn" id="route-import-btn" title="Import GPX"></button>' +
      '<button class="manager-item-btn" id="route-export-all-btn" title="Export All GPX"></button>' +
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
    const importBtn = this.el.querySelector("#route-import-btn") as HTMLElement;
    setIcon(importBtn, iconUpload);
    importBtn.addEventListener("click", () => this.importGpx());

    const exportAllBtn = this.el.querySelector(
      "#route-export-all-btn",
    ) as HTMLElement;
    setIcon(exportAllBtn, iconDownload);
    exportAllBtn.addEventListener("click", () => this.exportAll());

    this.el.querySelector("#route-new-btn")?.addEventListener("click", () => {
      this.hide();
      this.editor.startEditing();
    });

    editor.onEditorChange(() => {
      this.refresh();
      this.detailPanel.refreshIfOpen();
    });

    editor.onFinish((route) => {
      this.detailPanel.show(route);
    });

    editor.onCancel((existingId) => {
      if (existingId && this.detailPanel.isOpen()) {
        // Reload the original route from DB and re-show it
        getAllRoutes()
          .then((routes) => {
            const original = routes.find((r) => r.id === existingId);
            if (original) {
              this.detailPanel.show(original);
            }
          })
          .catch(console.error);
      }
    });

    this.detailPanel.onEdit = (route) => {
      this.hide();
      this.editor.startEditing(route);
      // Re-show detail panel with editor's live route reference
      const liveRoute = this.editor.getRoute();
      if (liveRoute) this.detailPanel.show(liveRoute);
    };

    this.detailPanel.onRename = () => {
      this.refresh().catch(console.error);
    };

    this.detailPanel.onDelete = (route) => {
      if (!confirm(`Delete route "${route.name}"?`)) return;
      deleteRoute(route.id)
        .then(async () => {
          this.detailPanel.hide();
          await this.routeLayer.reloadAll();
          await this.refresh();
        })
        .catch(console.error);
    };
  }

  setWaypointLayer(waypointLayer: WaypointLayer): void {
    this.waypointLayer = waypointLayer;
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
    const legs = Math.max(0, route.waypoints.length - 1);
    let totalNM = 0;
    for (let i = 1; i < route.waypoints.length; i++) {
      const a = route.waypoints[i - 1];
      const b = route.waypoints[i];
      totalNM += haversineDistanceNM(a.lat, a.lon, b.lat, b.lon);
    }
    detail.textContent = `${legs} leg${legs !== 1 ? "s" : ""}, ${formatRouteDistance(totalNM)}`;

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

    const exportBtn = document.createElement("button");
    exportBtn.className = "manager-item-btn";
    setIcon(exportBtn, iconDownload);
    exportBtn.title = "Export GPX";
    exportBtn.addEventListener("click", () => {
      const gpx = routeToGpx(route);
      downloadFile(gpx, `${sanitizeFilename(route.name)}.gpx`, GPX_MIME);
    });

    const editBtn = document.createElement("button");
    editBtn.className = "manager-item-btn";
    setIcon(editBtn, iconEdit);
    editBtn.title = "Edit";
    editBtn.addEventListener("click", () => {
      this.hide();
      this.editor.startEditing(route);
      // Auto-open detail panel with live route reference
      const liveRoute = this.editor.getRoute();
      if (liveRoute) this.detailPanel.show(liveRoute);
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

    actions.append(navBtn, exportBtn, editBtn, toggleBtn, deleteBtn);
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
  private async exportAll(): Promise<void> {
    const routes = await getAllRoutes();
    if (routes.length === 0) {
      alert("No routes to export.");
      return;
    }
    const gpx = exportAllToGpx(routes, [], []);
    downloadFile(gpx, "pelorus-routes.gpx", GPX_MIME);
  }

  private async importGpx(): Promise<void> {
    let xml: string;
    try {
      xml = await pickFile(".gpx");
    } catch {
      return; // cancelled
    }

    const result = parseGpx(xml);
    if (result.routes.length === 0 && result.waypoints.length === 0) {
      alert("No routes or waypoints found in this GPX file.");
      return;
    }

    // Check for name conflicts
    const existing = await getAllRoutes();
    const existingNames = new Set(existing.map((r) => r.name));
    for (const route of result.routes) {
      if (existingNames.has(route.name)) {
        route.name += " (imported)";
      }
    }

    await Promise.all([
      ...result.routes.map((route) => saveRoute(route)),
      ...result.waypoints.map((wp) => saveWaypoint(wp)),
    ]);

    await this.routeLayer.reloadAll();
    if (result.waypoints.length > 0) {
      await this.waypointLayer?.reloadAll();
    }
    await this.refresh();

    const parts: string[] = [];
    if (result.routes.length > 0) {
      parts.push(
        `${result.routes.length} route${result.routes.length !== 1 ? "s" : ""}`,
      );
    }
    if (result.waypoints.length > 0) {
      parts.push(
        `${result.waypoints.length} waypoint${result.waypoints.length !== 1 ? "s" : ""}`,
      );
    }
    alert(`Imported ${parts.join(" and ")}.`);
  }
}

/** Format a distance in NM using the user's preferred unit system. */
function formatRouteDistance(nm: number): string {
  const unit = getSettings().speedUnit;
  if (unit === "kph") {
    const km = nm * 1.852;
    return km >= 5 ? `${Math.round(km)} km` : `${km.toFixed(1)} km`;
  }
  if (unit === "mph") {
    const mi = nm * 1.15078;
    return mi >= 5 ? `${Math.round(mi)} mi` : `${mi.toFixed(1)} mi`;
  }
  return nm >= 5 ? `${Math.round(nm)} nm` : `${nm.toFixed(1)} nm`;
}
