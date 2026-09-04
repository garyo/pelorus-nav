/**
 * Map context menu — right-click / long-press menu with position actions.
 */
import type * as maplibregl from "maplibre-gl";
import type { SearchEntry } from "../data/search-index";
import type { StandaloneWaypoint } from "../data/Waypoint";
import { logUiAction } from "../diagnostics/uiActionLog";
import { getMode, setMode } from "../map/InteractionMode";
import type { MeasurementLayer } from "../map/MeasurementLayer";
import type { PlottingLayer } from "../map/plotting/PlottingLayer";
import { findPointCandidates } from "../map/point-candidates";
import { isMapPressClaimed } from "../map/press-claim";
import type { RouteEditor } from "../map/RouteEditor";
import type { RouteLayer } from "../map/RouteLayer";
import type { WaypointLayer } from "../map/WaypointLayer";
import type { ActiveNavigationManager } from "../navigation/ActiveNavigation";
import { findNearestNamedFeature } from "../search/feature-search";
import { formatLatLon, parseLatLon } from "../utils/coordinates";
import { abbreviateFeatureName } from "../utils/feature-name";
import { generateUUID } from "../utils/uuid";
import {
  clampToViewport,
  type Insets,
  placeSubmenu,
  type Viewport,
} from "./popup-placement";

export interface ContextMenuDeps {
  map: maplibregl.Map;
  routeEditor: RouteEditor;
  routeLayer: RouteLayer;
  waypointLayer: WaypointLayer;
  plottingLayer: PlottingLayer;
  measurementLayer: MeasurementLayer;
  activeNav: ActiveNavigationManager;
  onWaypointAdded: () => void;
  /** Returns the loaded chart-feature search index (may be empty until loaded). */
  getSearchEntries?: () => SearchEntry[];
  /**
   * Consulted before the Escape fallback cancels active navigation;
   * returning true means the guard took over (e.g. COB confirm dialog).
   */
  guardNavCancel?: () => boolean;
}

export interface ContextMenuHandle {
  readonly element: HTMLDivElement;
  hide(): void;
}

export function createContextMenu(deps: ContextMenuDeps): ContextMenuHandle {
  const {
    map,
    routeEditor,
    routeLayer,
    waypointLayer,
    plottingLayer,
    measurementLayer,
    activeNav,
    onWaypointAdded,
    getSearchEntries,
    guardNavCancel,
  } = deps;

  const menu = document.createElement("div");
  menu.className = "map-context-menu";
  document.body.appendChild(menu);

  let ctxLat = 0;
  let ctxLng = 0;

  const hide = () => {
    menu.style.display = "none";
    closeSubmenu();
  };

  // --- Build menu items ---

  // Targeted object rows (Move waypoint "X" / Edit route "Y"), rebuilt on
  // every show from what's under the pressed point. Empty (and the divider
  // hidden) for a press on open chart. See docs/gesture-model.md.
  const objectRows = document.createElement("div");
  const objectDivider = document.createElement("div");
  objectDivider.className = "map-context-divider";
  objectDivider.style.display = "none";

  const copyItem = document.createElement("div");
  copyItem.className = "map-context-item";
  const copyLabel = document.createElement("span");
  copyItem.appendChild(copyLabel);

  const gotoItem = document.createElement("div");
  gotoItem.className = "map-context-item";
  gotoItem.textContent = "Go to\u2026";

  const gotoInput = document.createElement("input");
  gotoInput.type = "text";
  gotoInput.placeholder = "lat,lon or 42\u00b018.3'N 70\u00b056.8'W";
  gotoInput.className = "map-context-input";
  gotoInput.style.display = "none";

  const measureItem = document.createElement("div");
  measureItem.className = "map-context-item";
  measureItem.textContent = "Measure from here";

  const routeItem = document.createElement("div");
  routeItem.className = "map-context-item";
  routeItem.textContent = "Route from here";

  const waypointItem = document.createElement("div");
  waypointItem.className = "map-context-item";
  waypointItem.textContent = "Mark waypoint here";

  // Plot submenu
  const plotItem = document.createElement("div");
  plotItem.className = "map-context-item map-context-submenu-parent";
  plotItem.textContent = "Plot \u25B8";

  const plotSub = document.createElement("div");
  plotSub.className = "map-context-submenu";

  const plotBearing = document.createElement("div");
  plotBearing.className = "map-context-item";
  plotBearing.textContent = "Bearing line";

  const plotLine = document.createElement("div");
  plotLine.className = "map-context-item";
  plotLine.textContent = "Segment line";

  const plotSymbol = document.createElement("div");
  plotSymbol.className = "map-context-item";
  plotSymbol.textContent = "Symbol";

  const plotArc = document.createElement("div");
  plotArc.className = "map-context-item";
  plotArc.textContent = "Distance arc";

  plotSub.append(plotBearing, plotLine, plotArc, plotSymbol);
  plotItem.appendChild(plotSub);

  // --- Placement: keep the menu and submenu on screen ---

  const viewport = (): Viewport => {
    const vv = window.visualViewport;
    return vv
      ? {
          left: vv.offsetLeft,
          top: vv.offsetTop,
          width: vv.width,
          height: vv.height,
        }
      : {
          left: 0,
          top: 0,
          width: window.innerWidth,
          height: window.innerHeight,
        };
  };

  /** The system-bar insets, as the stylesheet resolved them. */
  const safeInsets = (): Insets => {
    const style = getComputedStyle(document.documentElement);
    const px = (name: string) =>
      Number.parseFloat(style.getPropertyValue(name)) || 0;
    return {
      top: px("--safe-top"),
      right: px("--safe-right"),
      bottom: px("--safe-bottom"),
      left: px("--safe-left"),
    };
  };

  const positionSubmenu = () => {
    const { x, y } = placeSubmenu(
      plotItem.getBoundingClientRect(),
      plotSub.offsetWidth,
      plotSub.offsetHeight,
      viewport(),
      safeInsets(),
    );
    plotSub.style.left = `${x}px`;
    plotSub.style.top = `${y}px`;
  };

  const openSubmenu = () => {
    plotItem.classList.add("open");
    positionSubmenu();
  };

  function closeSubmenu() {
    plotItem.classList.remove("open");
  }

  /** Put the menu's top-left at a client point, pulled back inside the viewport. */
  const position = (clientX: number, clientY: number) => {
    const { x, y } = clampToViewport(
      clientX,
      clientY,
      menu.offsetWidth,
      menu.offsetHeight,
      viewport(),
      safeInsets(),
    );
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    if (plotItem.classList.contains("open")) positionSubmenu();
  };

  // The submenu opens on tap (touch has no hover) and on hover; hover-out
  // closes it. The submenu is a descendant of the row, so moving the mouse
  // into it does not count as leaving. A click never closes: a mouse click
  // arrives after the hover already opened it.
  plotItem.addEventListener("click", (e) => {
    if (plotSub.contains(e.target as Node)) return;
    openSubmenu();
  });
  plotItem.addEventListener("mouseenter", openSubmenu);
  plotItem.addEventListener("mouseleave", closeSubmenu);

  menu.append(
    objectRows,
    objectDivider,
    copyItem,
    waypointItem,
    measureItem,
    routeItem,
    plotItem,
    gotoItem,
    gotoInput,
  );

  /** Truncate long user names so a row stays one line. */
  const shortName = (name: string, fallback: string): string => {
    const n = name.trim() || fallback;
    return n.length > 24 ? `${n.slice(0, 23)}…` : n;
  };

  /** Rebuild the object rows for a press at canvas point (x, y). */
  const buildObjectRows = (x: number, y: number): void => {
    objectRows.replaceChildren();
    const candidates = findPointCandidates(
      (ll) => map.project(ll),
      x,
      y,
      waypointLayer.getWaypoints().filter((w) => w.visible),
      routeLayer.getVisibleRoutes(),
    ).slice(0, 4);
    for (const c of candidates) {
      const row = document.createElement("div");
      row.className = "map-context-item";
      if (c.kind === "waypoint") {
        row.textContent = `Move waypoint "${shortName(c.waypoint.name, "waypoint")}"`;
        row.addEventListener("click", () => {
          hide();
          waypointLayer.armMove(c.waypoint);
        });
      } else {
        row.textContent = `Edit route "${shortName(c.route.name, "route")}"`;
        row.addEventListener("click", () => {
          hide();
          routeEditor.startEditing(c.route, { selectIndex: c.index });
        });
      }
      objectRows.appendChild(row);
    }
    objectDivider.style.display = candidates.length > 0 ? "" : "none";
  };

  // --- Show/hide logic ---

  const show = (lat: number, lng: number, clientX: number, clientY: number) => {
    ctxLat = lat;
    ctxLng = lng;
    copyLabel.textContent = `Copy ${formatLatLon(ctxLat, "lat")} ${formatLatLon(ctxLng, "lon")}`;
    gotoInput.style.display = "none";
    const rect = map.getCanvas().getBoundingClientRect();
    buildObjectRows(clientX - rect.left, clientY - rect.top);

    menu.style.display = "block";
    position(clientX, clientY);
    logUiAction("open context-menu");
  };

  // --- Right-click (desktop) ---

  let rightDownX = 0;
  let rightDownY = 0;
  map.getCanvas().addEventListener("mousedown", (e) => {
    if (e.button === 2) {
      rightDownX = e.clientX;
      rightDownY = e.clientY;
    }
  });

  map.getCanvas().addEventListener("contextmenu", (e) => {
    e.preventDefault();
    // No chart menu during route editing: every press there belongs to the
    // edit gestures, and "Route from here" would discard the session.
    if (getMode() === "route-edit") return;
    const dx = e.clientX - rightDownX;
    const dy = e.clientY - rightDownY;
    if (dx * dx + dy * dy > 25) return;

    const canvas = map.getCanvas();
    const rect = canvas.getBoundingClientRect();
    const lngLat = map.unproject([e.clientX - rect.left, e.clientY - rect.top]);
    show(lngLat.lat, lngLat.lng, e.clientX, e.clientY);
  });

  // --- Long-press (mobile) ---
  {
    let longPressTimer: ReturnType<typeof setTimeout> | null = null;
    let touchStartX = 0;
    let touchStartY = 0;
    const LONG_PRESS_MS = 500;
    const MOVE_THRESHOLD = 10;

    const canvas = map.getCanvas();

    canvas.addEventListener(
      "touchstart",
      (e) => {
        if (e.touches.length !== 1) {
          if (longPressTimer) clearTimeout(longPressTimer);
          longPressTimer = null;
          return;
        }
        const touch = e.touches[0];
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;

        longPressTimer = setTimeout(() => {
          longPressTimer = null;
          // A shorter hold on a waypoint arms first and claims the press:
          // picking a waypoint up must not also open the chart menu.
          if (isMapPressClaimed()) return;
          // No chart menu during route editing — a hold there is a grab
          // (or a fat-fingered tap), and the menu popping up mid-edit both
          // startled users and left stray waypoints behind when the
          // dismissing tap fell through to the chart.
          if (getMode() === "route-edit") return;
          const rect = canvas.getBoundingClientRect();
          const lngLat = map.unproject([
            touchStartX - rect.left,
            touchStartY - rect.top,
          ]);
          show(lngLat.lat, lngLat.lng, touchStartX, touchStartY);
        }, LONG_PRESS_MS);
      },
      { passive: true },
    );

    canvas.addEventListener(
      "touchmove",
      (e) => {
        if (!longPressTimer) return;
        const touch = e.touches[0];
        const dx = touch.clientX - touchStartX;
        const dy = touch.clientY - touchStartY;
        if (dx * dx + dy * dy > MOVE_THRESHOLD * MOVE_THRESHOLD) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
      },
      { passive: true },
    );

    canvas.addEventListener("touchend", () => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    });

    canvas.addEventListener("touchcancel", () => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    });
  }

  // --- Click handlers ---

  copyItem.addEventListener("click", () => {
    const text = `${ctxLat.toFixed(6)},${ctxLng.toFixed(6)}`;
    navigator.clipboard.writeText(text).catch(() => {});
    hide();
  });

  gotoItem.addEventListener("click", () => {
    gotoInput.style.display = "block";
    gotoInput.value = "";
    gotoInput.focus();
    // The input grew the menu; keep its bottom on screen.
    position(
      Number.parseFloat(menu.style.left),
      Number.parseFloat(menu.style.top),
    );
  });

  const flyToInput = (value: string) => {
    const result = parseLatLon(value);
    if (result) {
      const [lat, lon] = result;
      map.flyTo({
        center: [lon, lat],
        zoom: Math.max(map.getZoom(), 10),
      });
      hide();
    } else {
      gotoInput.classList.add("error");
      setTimeout(() => gotoInput.classList.remove("error"), 1000);
    }
  };

  gotoInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") flyToInput(gotoInput.value);
    if (e.key === "Escape") hide();
    e.stopPropagation();
  });

  plotBearing.addEventListener("click", () => {
    hide();
    plottingLayer.promptBearing(ctxLat, ctxLng);
  });

  plotLine.addEventListener("click", () => {
    hide();
    plottingLayer.startSegmentFrom(ctxLat, ctxLng);
  });

  plotArc.addEventListener("click", () => {
    hide();
    plottingLayer.startArcFrom(ctxLat, ctxLng);
  });

  plotSymbol.addEventListener("click", () => {
    hide();
    plottingLayer.placeSymbolAt(ctxLat, ctxLng);
  });

  measureItem.addEventListener("click", () => {
    hide();
    measurementLayer.startFrom(ctxLng, ctxLat);
  });

  routeItem.addEventListener("click", () => {
    hide();
    routeEditor.startFromPoint(ctxLat, ctxLng);
  });

  waypointItem.addEventListener("click", () => {
    hide();
    // Try to auto-name from a nearby charted feature; fall back to the
    // latitude-based default if no index loaded or nothing close.
    const entries = getSearchEntries?.();
    const nearby =
      entries && entries.length > 0
        ? findNearestNamedFeature(ctxLng, ctxLat, entries)
        : null;
    const name = nearby
      ? abbreviateFeatureName(nearby.name)
      : `WP ${formatLatLon(ctxLat, "lat")}`;
    const wp: StandaloneWaypoint = {
      id: generateUUID(),
      lat: ctxLat,
      lon: ctxLng,
      name,
      notes: "",
      icon: "default",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      visible: true,
    };
    waypointLayer.addWaypoint(wp).then(onWaypointAdded).catch(console.error);
  });

  // --- Dismiss on click elsewhere or a user pan; ride along with the chart ---

  document.addEventListener("click", (e) => {
    if (!menu.contains(e.target as Node)) hide();
  });
  // Only a user gesture dismisses. Follow modes recentre the chart on every
  // fix with a programmatic jumpTo (no originalEvent), which closed the
  // menu the instant a long-pressing finger lifted under way.
  map.on("movestart", (e) => {
    if ((e as unknown as maplibregl.MapMouseEvent).originalEvent) hide();
  });
  // …and while the chart moves under it, the menu stays on its point.
  map.on("move", () => {
    if (menu.style.display !== "block") return;
    const p = map.project([ctxLng, ctxLat]);
    const rect = map.getCanvas().getBoundingClientRect();
    position(rect.left + p.x, rect.top + p.y);
  });

  // --- ESC key: cancel active navigation, exit plot mode, or clear measurement ---
  //
  // This is the global FALLBACK for Escape — it must never fire when some
  // dialog/input consumed the key. Dialogs mark consumption with
  // preventDefault(); deferring the check one tick makes listener
  // registration order irrelevant. Also bail while typing in any text field
  // (inline renames bubble to document).

  const isTyping = (): boolean => {
    const el = document.activeElement;
    return (
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      (el instanceof HTMLElement && el.isContentEditable)
    );
  };

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (menu.style.display === "block") {
      e.preventDefault(); // consumed — the fallback below must not also act
      hide();
      return;
    }
    setTimeout(() => {
      if (e.defaultPrevented || isTyping()) return;
      if (activeNav.getState().type !== "idle") {
        if (guardNavCancel?.()) return;
        activeNav.stop();
      } else if (getMode() === "plot") {
        setMode("query");
      } else {
        measurementLayer.clear();
      }
    }, 0);
  });

  return { element: menu, hide };
}
