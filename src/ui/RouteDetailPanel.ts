/**
 * Panel showing a route's leg table: course, distance, and cumulative
 * distance for each leg.  Hovering/clicking a leg row highlights that leg
 * on the map.  While the route is being edited, waypoint rows become
 * selection targets kept in two-way sync with the map's tap-to-select.
 */

import { getAllRoutes, saveRoute } from "../data/db";
import type { Route } from "../data/Route";
import type { RouteEditor } from "../map/RouteEditor";
import type { RouteLayer } from "../map/RouteLayer";
import type {
  ActiveNavCallback,
  ActiveNavigationManager,
} from "../navigation/ActiveNavigation";
import { getSettings } from "../settings";
import { haversineDistanceNM, initialBearingDeg } from "../utils/coordinates";
import { formatBearing } from "../utils/magnetic";
import { iconEdit, iconNavigation, iconTrash, iconX, setIcon } from "./icons";
import { groupByFolder } from "./manager-folders";
import { getPanelStack } from "./PanelStack";
import { registerSurface } from "./SurfaceManager";

interface Leg {
  index: number;
  from: string;
  to: string;
  course: number;
  dist: number;
  cumDist: number;
  fromLat: number;
  fromLon: number;
}

function buildLegs(route: Route): Leg[] {
  const wps = route.waypoints;
  const legs: Leg[] = [];
  let cumDist = 0;
  for (let i = 0; i < wps.length - 1; i++) {
    const a = wps[i];
    const b = wps[i + 1];
    const dist = haversineDistanceNM(a.lat, a.lon, b.lat, b.lon);
    const course = initialBearingDeg(a.lat, a.lon, b.lat, b.lon);
    cumDist += dist;
    legs.push({
      index: i,
      from: a.name || `WP${i + 1}`,
      to: b.name || `WP${i + 2}`,
      course,
      dist,
      cumDist,
      fromLat: a.lat,
      fromLon: a.lon,
    });
  }
  return legs;
}

function fmtDist(nm: number): string {
  return nm < 10 ? nm.toFixed(2) : nm.toFixed(1);
}

function fmtCourse(deg: number, lat: number, lon: number): string {
  const { bearingMode } = getSettings();
  return formatBearing(deg, bearingMode, lat, lon);
}

export class RouteDetailPanel {
  private readonly el: HTMLDivElement;
  private readonly header: HTMLSpanElement;
  private readonly body: HTMLDivElement;
  private readonly footer: HTMLDivElement;
  private readonly routeLayer: RouteLayer;
  private readonly editor: RouteEditor;
  private activeNav: ActiveNavigationManager | null = null;
  private currentRoute: Route | null = null;
  /** Last selected waypoint index scrolled into view; guards against
   *  re-renders (drags, etc.) yanking the user's scroll position. */
  private lastScrolledSel: number | null = null;
  private navCallback: ActiveNavCallback | null = null;
  private readonly navBtn: HTMLButtonElement;
  onEdit: ((route: Route) => void) | null = null;
  /** Called whenever the panel hides (any path) — the manager clears the
   *  route selection halo here so it tracks the panel's lifetime. */
  onHide: (() => void) | null = null;
  onDelete: ((route: Route) => void) | null = null;
  onRename: ((route: Route) => void) | null = null;
  onFolderChange: ((route: Route) => void) | null = null;

  constructor(routeLayer: RouteLayer, editor: RouteEditor) {
    this.routeLayer = routeLayer;
    this.editor = editor;

    this.el = document.createElement("div");
    this.el.className = "manager-panel route-detail-panel";
    this.el.innerHTML =
      '<div class="manager-header">' +
      '<span class="route-detail-title"></span>' +
      '<div style="display:flex;gap:6px;align-items:center">' +
      '<button class="route-nav-btn manager-item-btn" title="Navigate route"></button>' +
      '<button class="route-detail-edit manager-item-btn" title="Edit"></button>' +
      '<button class="route-detail-delete manager-item-btn" title="Delete"></button>' +
      '<button class="manager-close"></button>' +
      "</div>" +
      "</div>" +
      '<div class="manager-body"></div>' +
      '<div class="route-detail-footer"></div>';
    getPanelStack().appendChild(this.el);

    this.header = this.el.querySelector(
      ".route-detail-title",
    ) as HTMLSpanElement;
    this.header.title = "Double-click to rename";
    this.header.style.cursor = "pointer";
    this.header.addEventListener("dblclick", () => this.renameRoute());
    this.body = this.el.querySelector(".manager-body") as HTMLDivElement;
    this.footer = this.el.querySelector(
      ".route-detail-footer",
    ) as HTMLDivElement;

    this.navBtn = this.el.querySelector(".route-nav-btn") as HTMLButtonElement;
    setIcon(this.navBtn, iconNavigation);
    this.navBtn.addEventListener("click", () => {
      if (this.activeNav && this.currentRoute) {
        if (this.isNavigatingCurrentRoute()) {
          this.activeNav.stop();
        } else {
          this.activeNav.startRoute(this.currentRoute);
        }
      }
    });

    const editBtn = this.el.querySelector(
      ".route-detail-edit",
    ) as HTMLButtonElement;
    setIcon(editBtn, iconEdit);
    editBtn.addEventListener("click", () => {
      if (this.currentRoute && this.onEdit) this.onEdit(this.currentRoute);
    });

    const deleteBtn = this.el.querySelector(
      ".route-detail-delete",
    ) as HTMLButtonElement;
    setIcon(deleteBtn, iconTrash);
    deleteBtn.addEventListener("click", () => {
      if (this.currentRoute && this.onDelete) this.onDelete(this.currentRoute);
    });

    const closeBtn = this.el.querySelector(".manager-close") as HTMLElement;
    setIcon(closeBtn, iconX);
    closeBtn.addEventListener("click", () => this.hide());
  }

  setActiveNav(activeNav: ActiveNavigationManager): void {
    this.activeNav = activeNav;
  }

  private readonly surface = registerSurface({
    id: "route-detail",
    slot: "top-right",
    group: "routes",
    // Part of the route-planning workspace — see route-manager.
    closeOnOutsideClick: false,
    // While editing, opening another panel (sun, charts…) must not evict
    // the waypoint list out from under the user; its X still closes it.
    pinned: () => this.isEditingThisRoute(),
    el: () => this.el,
    isOpen: () => this.el.classList.contains("open"),
    close: () => this.hide(),
  });

  isOpen(): boolean {
    return this.el.classList.contains("open");
  }

  private refreshRafId: number | null = null;
  /** True while a waypoint name (or other inline input) is being edited.
   *  Suppresses re-renders that would clobber the input element. */
  private editing = false;

  /** Re-render the table if visible, throttled to one frame. */
  refreshIfOpen(): void {
    if (!this.currentRoute || !this.el.classList.contains("open")) return;
    if (this.editing) return;
    if (this.refreshRafId !== null) return;
    this.refreshRafId = requestAnimationFrame(() => {
      this.refreshRafId = null;
      if (this.editing) return;
      this.render();
    });
  }

  show(route: Route): void {
    // When this route is the one being edited, hold the editor's *live*
    // object, not whatever copy the caller passed (the manager list hands
    // over a fresh DB snapshot on every refresh). isEditingThisRoute() is a
    // strict-identity check; a stale copy silently flips it false, which
    // among other things routes a waypoint rename down the persist-to-DB
    // branch and writes pre-edit geometry behind the edit's back.
    if (this.editor.isEditing() && this.editor.getRoute()?.id === route.id) {
      const live = this.editor.getRoute();
      if (live) route = live;
    }
    this.currentRoute = route;
    this.header.textContent = route.name;
    this.render();
    this.el.classList.add("open");
    this.surface.opened();
    // Subscribe to nav state changes to keep active leg highlighting current.
    // Use refreshIfOpen so an active inline edit (e.g. waypoint rename)
    // isn't clobbered by the next GPS tick.
    if (this.activeNav && !this.navCallback) {
      this.navCallback = (_info, _state) => {
        this.refreshIfOpen();
      };
      this.activeNav.subscribe(this.navCallback);
    }
  }

  private renameRoute(): void {
    if (!this.currentRoute) return;
    const route = this.currentRoute;
    const input = document.createElement("input");
    input.type = "text";
    input.value = route.name;
    input.className = "map-context-input";
    input.style.margin = "0";
    input.style.width = "100%";
    this.header.replaceWith(input);
    input.focus();
    input.select();

    const finish = async () => {
      const newName = input.value.trim() || route.name;
      route.name = newName;
      await saveRoute(route);
      input.replaceWith(this.header);
      this.header.textContent = newName;
      if (this.onRename) this.onRename(route);
    };

    input.addEventListener("blur", () => {
      finish().catch(console.error);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") input.blur();
      if (e.key === "Escape") {
        e.preventDefault(); // cancel the rename only — not navigation
        input.value = route.name;
        input.blur();
      }
    });
  }

  hide(): void {
    this.el.classList.remove("open");
    this.routeLayer.clearHighlight();
    this.currentRoute = null;
    if (this.activeNav && this.navCallback) {
      this.activeNav.unsubscribe(this.navCallback);
      this.navCallback = null;
    }
    this.onHide?.();
  }

  /** Returns true if actively navigating the currently displayed route. */
  private isNavigatingCurrentRoute(): boolean {
    if (!this.activeNav || !this.currentRoute) return false;
    const st = this.activeNav.getState();
    return st.type === "route" && st.route.id === this.currentRoute.id;
  }

  /** Returns the active leg index if navigating this route, or -1. */
  private getActiveLegIndex(): number {
    if (!this.activeNav || !this.currentRoute) return -1;
    const st = this.activeNav.getState();
    if (st.type === "route" && st.route.id === this.currentRoute.id) {
      return st.legIndex;
    }
    return -1;
  }

  private render(): void {
    const route = this.currentRoute;
    if (!route) return;

    const legs = buildLegs(route);

    if (route.waypoints.length === 0) {
      this.body.innerHTML = this.isEditingThisRoute()
        ? '<div class="manager-empty">No waypoints yet — tap the map to add some</div>'
        : '<div class="manager-empty">No waypoints</div>';
      this.renderFooter(route, "");
      return;
    }

    const activeLegIdx = this.getActiveLegIndex();
    const navigating = activeLegIdx >= 0;
    this.navBtn.classList.toggle("active", navigating);
    this.navBtn.title = navigating ? "Stop navigation" : "Navigate route";

    this.body.innerHTML = "";
    this.body.appendChild(this.buildRouteList(route, legs, activeLegIdx));

    this.renderFooter(
      route,
      legs.length === 0
        ? ""
        : `${legs.length} leg${legs.length !== 1 ? "s" : ""}, ${fmtDist(legs[legs.length - 1].cumDist)} NM`,
    );

    // Keep the selected waypoint's row visible, but only when the
    // selection actually changed — other re-renders (drags, renames)
    // must not yank the user's scroll position.
    const sel = this.isEditingThisRoute()
      ? this.editor.getSelectedIndex()
      : null;
    if (sel !== null && sel !== this.lastScrolledSel) {
      this.body
        .querySelector(".route-list-wp.selected")
        ?.scrollIntoView({ block: "nearest" });
    }
    this.lastScrolledSel = sel;
  }

  /** True when the panel is showing the editor's live route. */
  private isEditingThisRoute(): boolean {
    return (
      this.editor.isEditing() &&
      this.currentRoute !== null &&
      this.editor.getRoute() === this.currentRoute
    );
  }

  /** Footer: route summary + the folder picker. A native <select> keeps the
   *  mobile UX simple (OS picker sheet, no drag/hover); "New folder…" uses
   *  prompt(), matching the panel family's confirm()/alert() idiom. */
  private renderFooter(route: Route, summary: string): void {
    this.footer.innerHTML = "";
    const summaryEl = document.createElement("button");
    summaryEl.type = "button";
    summaryEl.className = "route-detail-summary";
    summaryEl.textContent = summary;
    summaryEl.title = "Zoom to route";
    summaryEl.setAttribute("aria-label", "Zoom to route");
    summaryEl.addEventListener("click", () => this.routeLayer.fitRoute(route));

    const select = document.createElement("select");
    select.className = "route-folder-select";
    select.title = "Move to folder";
    // Sentinel that no real folder name can collide with (names are trimmed).
    const NEW_SENTINEL = "\u0000new";

    const rebuild = (folders: string[]) => {
      select.innerHTML = "";
      const none = document.createElement("option");
      none.value = "";
      none.textContent = "No folder";
      select.appendChild(none);
      for (const name of folders) {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        select.appendChild(opt);
      }
      const create = document.createElement("option");
      create.value = NEW_SENTINEL;
      create.textContent = "New folder…";
      select.appendChild(create);
      select.value = route.folder ?? "";
    };
    rebuild(route.folder ? [route.folder] : []);
    getAllRoutes()
      .then((routes) => {
        rebuild([...groupByFolder(routes).folders.keys()]);
      })
      .catch(console.error);

    select.addEventListener("change", () => {
      let folder: string | undefined;
      if (select.value === NEW_SENTINEL) {
        const name = prompt("New folder name:")?.trim();
        if (!name) {
          select.value = route.folder ?? "";
          return;
        }
        folder = name;
      } else {
        folder = select.value || undefined;
      }
      if (folder) route.folder = folder;
      else delete route.folder;
      saveRoute(route)
        .then(() => this.onFolderChange?.(route))
        .catch(console.error);
    });

    this.footer.append(summaryEl, select);
  }

  /**
   * Render the route as an interleaved list: each waypoint, then the leg
   * info to the next waypoint (indented). Gives a top-to-bottom overview
   * with the rhumb-line course / distance / running total inline between
   * each pair of waypoints.
   */
  private buildRouteList(
    route: Route,
    legs: Leg[],
    activeLegIdx: number,
  ): HTMLDivElement {
    const wrap = document.createElement("div");
    wrap.className = "route-list";
    const navigating = activeLegIdx >= 0;
    const editing = this.isEditingThisRoute();
    const selIdx = editing ? this.editor.getSelectedIndex() : null;

    for (let i = 0; i < route.waypoints.length; i++) {
      // ── waypoint row ────────────────────────────────────────────
      const wp = route.waypoints[i];
      const wpRow = document.createElement("div");
      wpRow.className = "route-list-wp";
      if (activeLegIdx === i) wpRow.classList.add("active");
      const idx = document.createElement("span");
      idx.className = "route-list-wp-idx";
      idx.textContent = `${i + 1}.`;
      const name = document.createElement("span");
      name.className = "route-list-wp-name";
      name.textContent = wp.name || `WP${i + 1}`;
      name.title = "Double-click to rename";
      name.addEventListener("dblclick", () =>
        this.renameWaypoint(route, i, name),
      );
      wpRow.append(idx, name);
      if (editing) {
        // Waypoint rows mirror the map's tap-to-select: clicking selects
        // (yellow ring + Delete/Insert bar), clicking again deselects.
        // Dblclick rename still works: its two clicks toggle selection
        // twice (a no-op) before the dblclick fires.
        wpRow.classList.add("selectable");
        if (selIdx === i) wpRow.classList.add("selected");
        wpRow.addEventListener("click", () => {
          this.editor.setSelectedIndex(
            this.editor.getSelectedIndex() === i ? null : i,
            { reveal: true },
          );
        });
      }
      wrap.appendChild(wpRow);

      // ── leg row (skip after the final waypoint) ─────────────────
      if (i >= legs.length) continue;
      const leg = legs[i];
      const isActiveLeg = activeLegIdx === leg.index + 1;
      const legRow = document.createElement("div");
      legRow.className = "route-list-leg";
      if (isActiveLeg) legRow.classList.add("active");
      legRow.title = `${leg.from} → ${leg.to}`;

      // Optional ► nav-to control on the left (only while navigating).
      if (navigating) {
        const marker = document.createElement("span");
        marker.className = "route-list-leg-marker";
        if (isActiveLeg) {
          marker.classList.add("active-marker");
          marker.textContent = "►";
          marker.title = "Current target";
        } else {
          marker.classList.add("nav-btn");
          marker.textContent = "►";
          marker.title = "Navigate to this leg";
          marker.addEventListener("click", (e) => {
            e.stopPropagation();
            this.activeNav?.setLeg(leg.index + 1);
          });
        }
        legRow.appendChild(marker);
      }

      const course = document.createElement("span");
      course.className = "route-list-leg-course";
      course.textContent = fmtCourse(leg.course, leg.fromLat, leg.fromLon);
      const dist = document.createElement("span");
      dist.className = "route-list-leg-dist";
      dist.textContent = `${fmtDist(leg.dist)} NM`;
      const cum = document.createElement("span");
      cum.className = "route-list-leg-cum";
      cum.textContent = `Σ ${fmtDist(leg.cumDist)}`;
      legRow.append(course, dist, cum);

      // While editing, the route's normal display is hidden so the leg
      // highlight would draw nothing — clicking a leg selects its starting
      // waypoint instead (the camera fit already frames the leg).
      legRow.addEventListener("mouseenter", () => {
        if (!editing) this.selectLeg(legRow, leg.index);
      });
      legRow.addEventListener("mouseleave", () => {
        if (!editing) this.clearSelection();
      });
      legRow.addEventListener("click", () => {
        if (editing) this.editor.setSelectedIndex(leg.index);
        else this.selectLeg(legRow, leg.index);
        this.routeLayer.fitLeg(route, leg.index);
      });
      wrap.appendChild(legRow);
    }
    return wrap;
  }

  /** Inline rename for one waypoint in the current route. */
  private renameWaypoint(
    route: Route,
    index: number,
    nameEl: HTMLSpanElement,
  ): void {
    const wp = route.waypoints[index];
    const input = document.createElement("input");
    input.type = "text";
    input.value = wp.name || `WP${index + 1}`;
    input.className = "route-waypoint-input";
    nameEl.replaceWith(input);
    this.editing = true;
    input.focus();
    input.select();

    let finished = false;
    const finish = async (cancel: boolean) => {
      if (finished) return; // Enter triggers blur which would re-enter.
      finished = true;
      const newName = cancel ? wp.name : input.value.trim();
      if (!cancel && newName && newName !== wp.name) {
        if (this.isEditingThisRoute()) {
          // The rename lives on the editor's live route (undoable there):
          // Done persists it, Cancel discards it. Saving here would commit
          // in-progress geometry edits behind the user's back.
          this.editor.renameWaypoint(index, newName);
        } else {
          wp.name = newName;
          await saveRoute(route);
          // Refresh the on-map labels for this route.
          this.routeLayer.updateRoute(route);
        }
      }
      this.editing = false;
      // Full re-render now that we're done editing — picks up the new
      // name in both the waypoint list and any leg tooltips.
      this.refreshIfOpen();
    };

    input.addEventListener("blur", () => {
      finish(false).catch(console.error);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") input.blur();
      if (e.key === "Escape") {
        e.preventDefault(); // cancel the edit only — not navigation
        finish(true).catch(console.error);
      }
    });
  }

  private selectLeg(row: HTMLElement, legIndex: number): void {
    const route = this.currentRoute;
    if (!route) return;
    for (const el of this.body.querySelectorAll(".selected")) {
      el.classList.remove("selected");
    }
    row.classList.add("selected");
    this.routeLayer.highlightLeg(route, legIndex);
  }

  private clearSelection(): void {
    for (const el of this.body.querySelectorAll(".selected")) {
      el.classList.remove("selected");
    }
    this.routeLayer.clearHighlight();
  }
}
