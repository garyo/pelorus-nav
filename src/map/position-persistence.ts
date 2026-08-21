/**
 * Map-position persistence: saves the camera (center/zoom) to localStorage
 * so a reload restores the user's last view.
 */
import type * as maplibregl from "maplibre-gl";

const MAP_POS_KEY = "pelorus-nav-map-position";

export interface SavedMapPosition {
  center: [number, number];
  zoom: number;
}

/** The saved map position, or null when absent/unreadable. */
export function loadSavedMapPosition(): SavedMapPosition | null {
  try {
    const raw = localStorage.getItem(MAP_POS_KEY);
    if (raw) return JSON.parse(raw) as SavedMapPosition;
  } catch {
    /* ignore */
  }
  return null;
}

// Persist map position (throttled — moveend fires ~10 Hz underway in follow
// mode, and each write is a synchronous localStorage round-trip). The
// throttle is non-re-arming so persistence can't be starved; flushed on
// hide/pagehide so a reload restores a fresh position.
const MAP_POS_SAVE_MS = 5_000;

export function installMapPositionPersistence(map: maplibregl.Map): void {
  let mapPosSaveTimer: ReturnType<typeof setTimeout> | null = null;
  const saveMapPosition = (): void => {
    const c = map.getCenter();
    localStorage.setItem(
      MAP_POS_KEY,
      JSON.stringify({
        center: [c.lng, c.lat],
        zoom: map.getZoom(),
      }),
    );
  };
  map.on("moveend", () => {
    if (mapPosSaveTimer) return;
    mapPosSaveTimer = setTimeout(() => {
      mapPosSaveTimer = null;
      saveMapPosition();
    }, MAP_POS_SAVE_MS);
  });
  window.addEventListener("pagehide", saveMapPosition);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveMapPosition();
  });
}
