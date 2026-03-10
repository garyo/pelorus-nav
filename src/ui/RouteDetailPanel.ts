/**
 * Panel showing a route's leg table: course, distance, and cumulative
 * distance for each leg.  Hovering/clicking a row highlights that leg
 * on the map.
 */

import type { Route } from "../data/Route";
import type { RouteLayer } from "../map/RouteLayer";
import { haversineDistanceNM, initialBearingDeg } from "../utils/coordinates";
import { iconX } from "./icons";
import { getPanelStack } from "./PanelStack";

interface Leg {
  index: number;
  from: string;
  to: string;
  course: number;
  dist: number;
  cumDist: number;
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
    });
  }
  return legs;
}

function fmtDist(nm: number): string {
  return nm < 10 ? nm.toFixed(2) : nm.toFixed(1);
}

function fmtCourse(deg: number): string {
  return `${Math.round(deg).toString().padStart(3, "0")}°T`;
}

export class RouteDetailPanel {
  private readonly el: HTMLDivElement;
  private readonly header: HTMLSpanElement;
  private readonly body: HTMLDivElement;
  private readonly footer: HTMLDivElement;
  private readonly routeLayer: RouteLayer;
  private currentRoute: Route | null = null;

  constructor(routeLayer: RouteLayer) {
    this.routeLayer = routeLayer;

    this.el = document.createElement("div");
    this.el.className = "manager-panel route-detail-panel";
    this.el.innerHTML =
      '<div class="manager-header">' +
      '<span class="route-detail-title"></span>' +
      '<button class="manager-close"></button>' +
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

    const closeBtn = this.el.querySelector(".manager-close") as HTMLElement;
    closeBtn.innerHTML = iconX;
    closeBtn.addEventListener("click", () => this.hide());
  }

  show(route: Route): void {
    this.currentRoute = route;
    this.header.textContent = route.name;
    this.render();
    this.el.classList.add("open");
  }

  hide(): void {
    this.el.classList.remove("open");
    this.routeLayer.clearHighlight();
    this.currentRoute = null;
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

    // Build table
    const table = document.createElement("table");
    table.className = "route-leg-table";

    const thead = document.createElement("thead");
    thead.innerHTML =
      "<tr><th>Leg</th><th>Course</th><th>Dist</th><th>Total</th></tr>";
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (const leg of legs) {
      const tr = document.createElement("tr");
      tr.innerHTML =
        `<td class="leg-num">${leg.index + 1}</td>` +
        `<td class="leg-course">${fmtCourse(leg.course)}</td>` +
        `<td class="leg-dist">${fmtDist(leg.dist)}</td>` +
        `<td class="leg-cum">${fmtDist(leg.cumDist)}</td>`;
      tr.title = `${leg.from} → ${leg.to}`;

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
