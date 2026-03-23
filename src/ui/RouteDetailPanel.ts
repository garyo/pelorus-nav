/**
 * Panel showing a route's leg table: course, distance, and cumulative
 * distance for each leg.  Hovering/clicking a row highlights that leg
 * on the map.
 */

import type { Route } from "../data/Route";
import type { RouteLayer } from "../map/RouteLayer";
import type {
  ActiveNavCallback,
  ActiveNavigationManager,
} from "../navigation/ActiveNavigation";
import { getSettings } from "../settings";
import { haversineDistanceNM, initialBearingDeg } from "../utils/coordinates";
import { formatBearing } from "../utils/magnetic";
import { iconNavigation, iconX, setIcon } from "./icons";
import { getPanelStack } from "./PanelStack";

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
  private activeNav: ActiveNavigationManager | null = null;
  private currentRoute: Route | null = null;
  private navCallback: ActiveNavCallback | null = null;
  private readonly navBtn: HTMLButtonElement;

  constructor(routeLayer: RouteLayer) {
    this.routeLayer = routeLayer;

    this.el = document.createElement("div");
    this.el.className = "manager-panel route-detail-panel";
    this.el.innerHTML =
      '<div class="manager-header">' +
      '<span class="route-detail-title"></span>' +
      '<div style="display:flex;gap:6px;align-items:center">' +
      '<button class="route-nav-btn manager-item-btn" title="Navigate route"></button>' +
      '<button class="manager-close"></button>' +
      "</div>" +
      "</div>" +
      '<div class="manager-body"></div>' +
      '<div class="route-detail-footer"></div>';
    getPanelStack().appendChild(this.el);

    this.header = this.el.querySelector(
      ".route-detail-title",
    ) as HTMLSpanElement;
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

    const closeBtn = this.el.querySelector(".manager-close") as HTMLElement;
    setIcon(closeBtn, iconX);
    closeBtn.addEventListener("click", () => this.hide());
  }

  setActiveNav(activeNav: ActiveNavigationManager): void {
    this.activeNav = activeNav;
  }

  /** Re-render the table if the panel is currently visible. */
  refreshIfOpen(): void {
    if (this.currentRoute && this.el.classList.contains("open")) {
      this.render();
    }
  }

  show(route: Route): void {
    this.currentRoute = route;
    this.header.textContent = route.name;
    this.render();
    this.el.classList.add("open");
    // Subscribe to nav state changes to keep active leg highlighting current
    if (this.activeNav && !this.navCallback) {
      this.navCallback = (_info, _state) => {
        if (this.currentRoute && this.el.classList.contains("open")) {
          this.render();
        }
      };
      this.activeNav.subscribe(this.navCallback);
    }
  }

  hide(): void {
    this.el.classList.remove("open");
    this.routeLayer.clearHighlight();
    this.currentRoute = null;
    if (this.activeNav && this.navCallback) {
      this.activeNav.unsubscribe(this.navCallback);
      this.navCallback = null;
    }
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

    if (legs.length === 0) {
      this.body.innerHTML =
        '<div class="manager-empty">No legs (need at least 2 waypoints)</div>';
      this.footer.textContent = "";
      return;
    }

    const activeLegIdx = this.getActiveLegIndex();
    const navigating = activeLegIdx >= 0;
    this.navBtn.classList.toggle("active", navigating);
    this.navBtn.title = navigating ? "Stop navigation" : "Navigate route";

    // Build table
    const table = document.createElement("table");
    table.className = "route-leg-table";

    const thead = document.createElement("thead");
    thead.innerHTML =
      activeLegIdx >= 0
        ? "<tr><th></th><th>Leg</th><th>Course</th><th>Dist</th><th>Total</th></tr>"
        : "<tr><th>Leg</th><th>Course</th><th>Dist</th><th>Total</th></tr>";
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (const leg of legs) {
      const tr = document.createElement("tr");
      // legIndex in the route is leg.index + 1 (targeting destination waypoint)
      const isActive = activeLegIdx === leg.index + 1;
      if (isActive) tr.classList.add("active-leg");

      let navCell = "";
      if (activeLegIdx >= 0) {
        navCell = `<td class="leg-nav-cell">${
          isActive
            ? '<span class="leg-active-marker" title="Current target">►</span>'
            : '<button class="leg-nav-btn" title="Navigate to this leg">►</button>'
        }</td>`;
      }

      tr.innerHTML =
        navCell +
        `<td class="leg-num">${leg.index + 1}</td>` +
        `<td class="leg-course">${fmtCourse(leg.course, leg.fromLat, leg.fromLon)}</td>` +
        `<td class="leg-dist">${fmtDist(leg.dist)}</td>` +
        `<td class="leg-cum">${fmtDist(leg.cumDist)}</td>`;
      tr.title = `${leg.from} → ${leg.to}`;

      // Nav-to button click
      if (activeLegIdx >= 0 && !isActive) {
        const navBtn = tr.querySelector(".leg-nav-btn");
        if (navBtn) {
          navBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            this.activeNav?.setLeg(leg.index + 1);
          });
        }
      }

      tr.addEventListener("mouseenter", () => {
        this.selectRow(tr, leg.index);
      });
      tr.addEventListener("mouseleave", () => {
        this.clearSelection();
      });
      tr.addEventListener("click", () => {
        this.selectRow(tr, leg.index);
        this.routeLayer.fitLeg(route, leg.index);
      });

      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    this.body.innerHTML = "";
    this.body.appendChild(table);

    const totalDist = legs[legs.length - 1].cumDist;
    this.footer.textContent = `${legs.length} leg${legs.length !== 1 ? "s" : ""}, ${fmtDist(totalDist)} NM`;
  }

  private selectRow(tr: HTMLTableRowElement, legIndex: number): void {
    const route = this.currentRoute;
    if (!route) return;
    for (const row of this.body.querySelectorAll("tr.selected")) {
      row.classList.remove("selected");
    }
    tr.classList.add("selected");
    this.routeLayer.highlightLeg(route, legIndex);
  }

  private clearSelection(): void {
    for (const row of this.body.querySelectorAll("tr.selected")) {
      row.classList.remove("selected");
    }
    this.routeLayer.clearHighlight();
  }
}
