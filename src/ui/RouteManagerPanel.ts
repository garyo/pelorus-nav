/**
 * Floating panel for listing, toggling, editing, and deleting routes.
 */

import { deleteRoute, getAllRoutes, saveRoute } from "../data/db";
import type { Route } from "../data/Route";
import type { RouteEditor } from "../map/RouteEditor";
import type { RouteLayer } from "../map/RouteLayer";
import { getPanelStack } from "./PanelStack";

export class RouteManagerPanel {
  private readonly el: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly routeLayer: RouteLayer;
  private readonly editor: RouteEditor;

  constructor(routeLayer: RouteLayer, editor: RouteEditor) {
    this.routeLayer = routeLayer;
    this.editor = editor;

    this.el = document.createElement("div");
    this.el.className = "manager-panel route-manager-panel";
    this.el.innerHTML =
      '<div class="manager-header">' +
      "<span>Routes</span>" +
      '<div style="display:flex;gap:6px;align-items:center">' +
      '<button class="route-editor-btn" id="route-new-btn">New</button>' +
      '<button class="manager-close">&times;</button>' +
      "</div>" +
      "</div>" +
      '<div class="manager-body"></div>';
    getPanelStack().appendChild(this.el);

    this.body = this.el.querySelector(".manager-body") as HTMLDivElement;
    this.el
      .querySelector(".manager-close")
      ?.addEventListener("click", () => this.hide());
    this.el.querySelector("#route-new-btn")?.addEventListener("click", () => {
      this.hide();
      this.editor.startEditing();
    });

    editor.onEditorChange(() => this.refresh());
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
    name.title = "Click to rename";
    name.addEventListener("click", () => this.rename(route, name));

    const detail = document.createElement("div");
    detail.className = "manager-item-detail";
    detail.textContent = `${route.waypoints.length} waypoints`;

    info.append(name, detail);

    const actions = document.createElement("div");
    actions.className = "manager-item-actions";

    const editBtn = document.createElement("button");
    editBtn.className = "manager-item-btn";
    editBtn.textContent = "\u270E";
    editBtn.title = "Edit";
    editBtn.addEventListener("click", () => {
      this.hide();
      this.editor.startEditing(route);
    });

    const toggleBtn = document.createElement("button");
    toggleBtn.className = "manager-item-btn";
    toggleBtn.textContent = route.visible
      ? "\u{1F441}"
      : "\u{1F441}\u200D\u{1F5E8}";
    toggleBtn.title = route.visible ? "Hide" : "Show";
    toggleBtn.addEventListener("click", () => {
      (async () => {
        route.visible = !route.visible;
        await saveRoute(route);
        await this.routeLayer.toggleVisibility(route.id, route.visible);
        await this.refresh();
      })().catch(console.error);
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "manager-item-btn";
    deleteBtn.textContent = "\u{1F5D1}";
    deleteBtn.title = "Delete";
    deleteBtn.addEventListener("click", () => {
      if (!confirm(`Delete route "${route.name}"?`)) return;
      (async () => {
        await deleteRoute(route.id);
        await this.routeLayer.reloadAll();
        await this.refresh();
      })().catch(console.error);
    });

    actions.append(editBtn, toggleBtn, deleteBtn);
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
