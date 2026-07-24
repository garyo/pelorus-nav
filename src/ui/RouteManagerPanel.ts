/**
 * Floating panel for listing, toggling, editing, and deleting routes.
 */

import { deleteRoute, getAllRoutes, saveRoute, saveWaypoint } from "../data/db";
import {
  downloadFile,
  GPX_ACCEPT,
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
import { getSettings, updateSettings } from "../settings";
import { haversineDistanceNM } from "../utils/coordinates";
import { openColorPicker } from "./color-picker";
import {
  iconActivity,
  iconChevronDown,
  iconChevronRight,
  iconEdit,
  iconExport,
  iconEye,
  iconEyeOff,
  iconFolderOpen,
  iconNavigation,
  iconTrash,
  iconX,
  setIcon,
} from "./icons";
import { startInlineRename } from "./inline-rename";
import { folderVisibility, groupByFolder } from "./manager-folders";
import { getPanelStack } from "./PanelStack";
import { RouteDetailPanel } from "./RouteDetailPanel";
import { registerSurface } from "./SurfaceManager";

export class RouteManagerPanel {
  private readonly el: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly routeLayer: RouteLayer;
  private readonly editor: RouteEditor;
  private readonly detailPanel: RouteDetailPanel;
  private waypointLayer: WaypointLayer | null = null;
  private onPreviewRoute?: (route: Route) => void;
  private activeNav: ActiveNavigationManager | null = null;
  private selectedRouteId: string | null = null;
  /** True while an inline rename input is open. Suppresses refresh() so a
   *  background refresh (e.g. from an editor change) can't destroy the
   *  input mid-edit and silently lose the rename. */
  private editing = false;

  constructor(routeLayer: RouteLayer, editor: RouteEditor) {
    this.routeLayer = routeLayer;
    this.editor = editor;
    this.detailPanel = new RouteDetailPanel(routeLayer, editor);
    this.detailPanel.onFolderChange = () => {
      this.refresh().catch(console.error);
    };

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
    setIcon(importBtn, iconFolderOpen);
    importBtn.addEventListener("click", () => this.importGpx());

    const exportAllBtn = this.el.querySelector(
      "#route-export-all-btn",
    ) as HTMLElement;
    setIcon(exportAllBtn, iconExport);
    exportAllBtn.addEventListener("click", () => this.exportAll());

    this.el.querySelector("#route-new-btn")?.addEventListener("click", () => {
      this.hide();
      this.detailPanel.hide();
      this.editor.startEditing();
    });

    editor.onEditorChange(() => {
      this.refreshSoon();
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

    this.detailPanel.onEdit = (route) => this.beginEdit(route);

    this.detailPanel.onHide = () => this.clearSelection();

    this.detailPanel.onRename = () => {
      this.refresh().catch(console.error);
    };

    this.detailPanel.onDelete = (route) => {
      if (!confirm(`Delete route "${route.name}"?`)) return;
      // Discard an in-progress edit of this route first — otherwise the
      // editor keeps a live copy and Done would re-save the deleted route.
      if (this.editor.isEditing() && this.editor.getRoute()?.id === route.id) {
        this.editor.cancel();
      }
      deleteRoute(route.id)
        .then(async () => {
          this.activeNav?.noteRouteDeleted(route.id);
          if (this.selectedRouteId === route.id) this.clearSelection();
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

  /** Register the route pre-visualization entry point (wired in main.ts). */
  setOnPreviewRoute(cb: (route: Route) => void): void {
    this.onPreviewRoute = cb;
  }

  /** Show the detail panel for the currently navigated route (if any). */
  showActiveRoute(): void {
    if (!this.activeNav) return;
    const st = this.activeNav.getState();
    if (st.type === "route") {
      this.detailPanel.show(st.route);
    }
  }

  private readonly surface = registerSurface({
    id: "route-manager",
    slot: "top-right",
    group: "routes",
    // Route planning is a workspace: outside taps (panning the chart,
    // measuring) must not dismiss it. Closes via X, Escape, or eviction.
    closeOnOutsideClick: false,
    el: () => this.el,
    isOpen: () => this.el.classList.contains("open"),
    close: () => this.hide(),
  });

  toggle(): void {
    if (this.el.classList.contains("open")) {
      this.hide();
    } else {
      this.show();
    }
  }

  show(): void {
    this.el.classList.add("open");
    this.surface.opened();
    // Defensive reset: guards against `editing` ever latching true (e.g. a
    // rename input removed from the DOM without firing `blur`), which would
    // otherwise freeze refresh() for the rest of the session.
    this.editing = false;
    this.refresh();
  }

  hide(): void {
    // Only the list: the detail panel is the user's route workspace and
    // outlives it (eviction closes both — each is its own surface).
    this.el.classList.remove("open");
    this.editing = false;
  }

  /** Start editing a route: open its detail panel as the editing workspace
   *  and collapse the route list. Both edit entry points (the detail panel's
   *  pencil and each row's pencil) funnel through here so they stay
   *  consistent — the list closing on edit shouldn't depend on which pencil
   *  you tapped. */
  private beginEdit(route: Route): void {
    this.editor.startEditing(route);
    const liveRoute = this.editor.getRoute();
    if (liveRoute) this.detailPanel.show(liveRoute);
    this.hide();
  }

  private clearSelection(): void {
    if (this.selectedRouteId === null) return;
    this.selectedRouteId = null;
    for (const row of this.body.querySelectorAll(".manager-item.selected")) {
      row.classList.remove("selected");
    }
    this.routeLayer.clearSelectedRoute();
  }

  private selectRoute(route: Route): void {
    if (this.selectedRouteId === route.id) {
      this.clearSelection();
      return;
    }
    this.selectedRouteId = route.id;
    for (const row of this.body.querySelectorAll(".manager-item.selected")) {
      row.classList.remove("selected");
    }
    const row = this.body.querySelector<HTMLElement>(
      `.manager-item[data-route-id="${route.id}"]`,
    );
    if (row) row.classList.add("selected");

    // Selecting a hidden route makes it visible — the glow on a missing line
    // is confusing, and the user asked to see this route.
    if (!route.visible) {
      route.visible = true;
      (async () => {
        await saveRoute(route);
        await this.routeLayer.toggleVisibility(route.id, true);
        this.routeLayer.selectRoute(route);
        this.routeLayer.fitRoute(route);
        await this.refresh();
      })().catch(console.error);
      return;
    }

    this.routeLayer.selectRoute(route);
    this.routeLayer.fitRoute(route);
  }

  private refreshRafId: number | null = null;
  /** Frame-throttled refresh — editor changes fire per drag movement and
   *  the list stays visible during editing. */
  private refreshSoon(): void {
    if (this.refreshRafId !== null) return;
    this.refreshRafId = requestAnimationFrame(() => {
      this.refreshRafId = null;
      this.refresh().catch(console.error);
    });
  }

  private async refresh(): Promise<void> {
    if (this.editing) return;
    const routes = await getAllRoutes();

    if (routes.length === 0) {
      this.body.innerHTML = '<div class="manager-empty">No routes</div>';
      return;
    }

    const { ungrouped, folders } = groupByFolder(routes);

    // Prune collapse-state entries for folders that no longer exist.
    const stored = getSettings().collapsedRouteFolders;
    const collapsed = stored.filter((f) => folders.has(f));
    if (collapsed.length !== stored.length) {
      updateSettings({ collapsedRouteFolders: collapsed });
    }

    this.body.innerHTML = "";
    for (const route of ungrouped) {
      this.body.appendChild(this.createRouteItem(route));
    }
    for (const [name, contents] of folders) {
      const isCollapsed = collapsed.includes(name);
      this.body.appendChild(this.createFolderRow(name, contents, isCollapsed));
      if (!isCollapsed) {
        for (const route of contents) {
          this.body.appendChild(this.createRouteItem(route, true));
        }
      }
    }
  }

  /** Header row for a folder: chevron + name + count + bulk-visibility eye.
   *  Clicking the row collapses/expands (list-only); the eye shows/hides all
   *  contained routes on the map. */
  private createFolderRow(
    name: string,
    contents: Route[],
    isCollapsed: boolean,
  ): HTMLDivElement {
    const item = document.createElement("div");
    item.className = "manager-item manager-folder";
    item.title = isCollapsed ? "Expand folder" : "Collapse folder";

    const chevron = document.createElement("span");
    chevron.className = "manager-folder-chevron";
    setIcon(chevron, isCollapsed ? iconChevronRight : iconChevronDown);

    const info = document.createElement("div");
    info.className = "manager-item-info";
    const nameEl = document.createElement("div");
    nameEl.className = "manager-item-name";
    nameEl.textContent = name;
    const count = document.createElement("span");
    count.className = "manager-folder-count";
    count.textContent = ` (${contents.length})`;
    nameEl.appendChild(count);
    info.appendChild(nameEl);

    const actions = document.createElement("div");
    actions.className = "manager-item-actions";
    const eyeBtn = document.createElement("button");
    eyeBtn.className = "manager-item-btn";
    const vis = folderVisibility(contents);
    setIcon(eyeBtn, vis === "none" ? iconEyeOff : iconEye);
    eyeBtn.classList.toggle("mixed", vis === "mixed");
    eyeBtn.title = vis === "none" ? "Show all" : "Hide all";
    eyeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      (async () => {
        const show = folderVisibility(contents) === "none";
        for (const route of contents) {
          await this.setRouteVisible(route, show);
        }
        await this.refresh();
      })().catch(console.error);
    });
    actions.appendChild(eyeBtn);

    item.addEventListener("click", () => {
      const current = getSettings().collapsedRouteFolders;
      const next = current.includes(name)
        ? current.filter((f) => f !== name)
        : [...current, name];
      updateSettings({ collapsedRouteFolders: next });
      this.refresh().catch(console.error);
    });

    item.append(chevron, info, actions);
    return item;
  }

  /** Set a route's map visibility with the panel's usual side effects:
   *  hiding the actively navigated route stops navigation, and hiding the
   *  selected route clears the selection glow. No-op if already set; does
   *  not refresh the list. */
  private async setRouteVisible(route: Route, visible: boolean): Promise<void> {
    if (route.visible === visible) return;
    route.visible = visible;
    if (!visible && this.activeNav) {
      const st = this.activeNav.getState();
      if (st.type === "route" && st.route.id === route.id) {
        this.activeNav.stop();
      }
    }
    // Hiding a selected route clears selection so the glow doesn't
    // linger without the crisp line under it.
    if (!visible && this.selectedRouteId === route.id) {
      this.clearSelection();
    }
    await saveRoute(route);
    await this.routeLayer.toggleVisibility(route.id, visible);
  }

  private createRouteItem(route: Route, inFolder = false): HTMLDivElement {
    const item = document.createElement("div");
    item.className = inFolder
      ? "manager-item manager-item--sub"
      : "manager-item";
    item.dataset.routeId = route.id;
    if (this.selectedRouteId === route.id) item.classList.add("selected");

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
    name.title = "Click to select, double-click to rename";
    name.style.cursor = "pointer";
    let clickTimer: ReturnType<typeof setTimeout> | null = null;
    name.addEventListener("click", () => {
      if (clickTimer) return; // second click of a dblclick — ignore
      clickTimer = setTimeout(() => {
        clickTimer = null;
        this.selectRoute(route);
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

    const previewBtn = document.createElement("button");
    previewBtn.className = "manager-item-btn";
    setIcon(previewBtn, iconActivity);
    previewBtn.title = "Preview route";
    previewBtn.addEventListener("click", () => this.onPreviewRoute?.(route));

    const exportBtn = document.createElement("button");
    exportBtn.className = "manager-item-btn";
    setIcon(exportBtn, iconExport);
    exportBtn.title = "Export GPX";
    exportBtn.addEventListener("click", () => {
      const gpx = routeToGpx(route);
      downloadFile(gpx, `${sanitizeFilename(route.name)}.gpx`, GPX_MIME);
    });

    const editBtn = document.createElement("button");
    editBtn.className = "manager-item-btn";
    setIcon(editBtn, iconEdit);
    // Light this row's pencil while its route is the one being edited — the
    // edit session outlives the panel, so reopening the list must show it.
    const editingThis =
      this.editor.isEditing() && this.editor.getRoute()?.id === route.id;
    editBtn.classList.toggle("editing", editingThis);
    editBtn.title = editingThis ? "Editing this route" : "Edit";
    editBtn.addEventListener("click", () => this.beginEdit(route));

    const toggleBtn = document.createElement("button");
    toggleBtn.className = "manager-item-btn";
    setIcon(toggleBtn, route.visible ? iconEye : iconEyeOff);
    toggleBtn.title = route.visible ? "Hide" : "Show";
    toggleBtn.addEventListener("click", () => {
      (async () => {
        await this.setRouteVisible(route, !route.visible);
        await this.refresh();
      })().catch(console.error);
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "manager-item-btn";
    setIcon(deleteBtn, iconTrash);
    deleteBtn.title = "Delete";
    deleteBtn.addEventListener("click", () => {
      if (!confirm(`Delete route "${route.name}"?`)) return;
      // Discard an in-progress edit of this route first, so Done can't
      // re-save the route just deleted (same guard as the detail panel's).
      if (this.editor.isEditing() && this.editor.getRoute()?.id === route.id) {
        this.editor.cancel();
      }
      (async () => {
        if (this.selectedRouteId === route.id) this.clearSelection();
        await deleteRoute(route.id);
        this.activeNav?.noteRouteDeleted(route.id);
        await this.routeLayer.reloadAll();
        await this.refresh();
      })().catch(console.error);
    });

    actions.append(
      navBtn,
      previewBtn,
      exportBtn,
      editBtn,
      toggleBtn,
      deleteBtn,
    );
    item.append(color, info, actions);
    return item;
  }

  private rename(route: Route, nameEl: HTMLDivElement): void {
    startInlineRename(nameEl, route.name, {
      setEditing: (v) => {
        this.editing = v;
      },
      onCommit: async (newName) => {
        route.name = newName;
        await saveRoute(route);
      },
      refresh: () => this.refresh(),
    });
  }

  private pickColor(route: Route, colorEl: HTMLDivElement): void {
    openColorPicker(
      colorEl,
      route.color,
      (color) => {
        route.color = color;
        colorEl.style.backgroundColor = color;
      },
      (color) => {
        route.color = color;
        (async () => {
          await saveRoute(route);
          await this.routeLayer.reloadAll();
        })().catch(console.error);
      },
    );
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
      xml = await pickFile(GPX_ACCEPT);
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
