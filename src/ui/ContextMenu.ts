/**
 * Map context menu — right-click / long-press menu with position actions.
 */
import type maplibregl from "maplibre-gl";
import type { StandaloneWaypoint } from "../data/Waypoint";
import { getMode, setMode } from "../map/InteractionMode";
import type { MeasurementLayer } from "../map/MeasurementLayer";
import type { PlottingLayer } from "../map/plotting/PlottingLayer";
import type { RouteEditor } from "../map/RouteEditor";
import type { WaypointLayer } from "../map/WaypointLayer";
import type { ActiveNavigationManager } from "../navigation/ActiveNavigation";
import { formatLatLon, parseLatLon } from "../utils/coordinates";
import { generateUUID } from "../utils/uuid";

export interface ContextMenuDeps {
  map: maplibregl.Map;
  routeEditor: RouteEditor;
  waypointLayer: WaypointLayer;
  plottingLayer: PlottingLayer;
  measurementLayer: MeasurementLayer;
  activeNav: ActiveNavigationManager;
  onWaypointAdded: () => void;
}

export interface ContextMenuHandle {
  readonly element: HTMLDivElement;
  hide(): void;
}

export function createContextMenu(deps: ContextMenuDeps): ContextMenuHandle {
  const {
    map,
    routeEditor,
    waypointLayer,
    plottingLayer,
    measurementLayer,
    activeNav,
    onWaypointAdded,
  } = deps;

  const menu = document.createElement("div");
  menu.className = "map-context-menu";
  document.body.appendChild(menu);

  let ctxLat = 0;
  let ctxLng = 0;

  const hide = () => {
    menu.style.display = "none";
  };

  // --- Build menu items ---

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

  menu.append(
    copyItem,
    waypointItem,
    measureItem,
    routeItem,
    plotItem,
    gotoItem,
    gotoInput,
  );

  // --- Show/hide logic ---

  const show = (lat: number, lng: number, clientX: number, clientY: number) => {
    ctxLat = lat;
    ctxLng = lng;
    copyLabel.textContent = `Copy ${formatLatLon(ctxLat, "lat")} ${formatLatLon(ctxLng, "lon")}`;
    gotoInput.style.display = "none";

    menu.style.display = "block";
    const menuW = menu.offsetWidth;
    const menuH = menu.offsetHeight;
    const left = Math.min(clientX, window.innerWidth - menuW - 4);
    const top = Math.min(clientY, window.innerHeight - menuH - 4);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
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
    const wp: StandaloneWaypoint = {
      id: generateUUID(),
      lat: ctxLat,
      lon: ctxLng,
      name: `WP ${formatLatLon(ctxLat, "lat")}`,
      notes: "",
      icon: "default",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    waypointLayer.addWaypoint(wp).then(onWaypointAdded).catch(console.error);
  });

  // --- Dismiss on click elsewhere or map move ---

  document.addEventListener("click", (e) => {
    if (!menu.contains(e.target as Node)) hide();
  });
  map.on("movestart", hide);

  // --- ESC key: cancel active navigation, exit plot mode, or clear measurement ---

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (menu.style.display !== "none") {
        hide();
      } else if (activeNav.getState().type !== "idle") {
        activeNav.stop();
      } else if (getMode() === "plot") {
        setMode("query");
      } else {
        measurementLayer.clear();
      }
    }
  });

  return { element: menu, hide };
}
