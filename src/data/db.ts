/**
 * IndexedDB persistence for tracks and routes.
 * Thin wrapper — no library dependency.
 */

import type { PlottingSheet } from "../map/plotting/PlottingTypes";
import type { Route } from "./Route";
import type { TrackMeta, TrackPoint } from "./Track";
import type { StandaloneWaypoint } from "./Waypoint";

const DB_NAME = "pelorus-nav";
// Bump DB_VERSION when adding/removing stores or indexes. In onupgradeneeded,
// check oldVersion and apply incremental migrations (e.g. if (oldVersion < 2) ...).
const DB_VERSION = 4;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      const tx = req.transaction as IDBTransaction;
      const oldVersion = (event as IDBVersionChangeEvent).oldVersion;
      if (oldVersion < 1) {
        db.createObjectStore("tracks", { keyPath: "id" });
        const ptStore = db.createObjectStore("trackPoints", {
          autoIncrement: true,
        });
        ptStore.createIndex("byTrack", "trackId");
        db.createObjectStore("routes", { keyPath: "id" });
      }
      if (oldVersion < 2) {
        db.createObjectStore("waypoints", { keyPath: "id" });
      }
      if (oldVersion < 3) {
        db.createObjectStore("plottingSheets", { keyPath: "id" });
      }
      if (oldVersion < 4) {
        // Add compound index so track points are returned sorted by timestamp
        const ptStore = tx.objectStore("trackPoints");
        ptStore.createIndex("byTrackTime", ["trackId", "timestamp"]);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

// --- Tracks ---

export async function saveTrackMeta(meta: TrackMeta): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("tracks", "readwrite");
    tx.objectStore("tracks").put(meta);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllTrackMetas(): Promise<TrackMeta[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("tracks", "readonly");
    const req = tx.objectStore("tracks").getAll();
    req.onsuccess = () => resolve(req.result as TrackMeta[]);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteTrack(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["tracks", "trackPoints"], "readwrite");
    tx.objectStore("tracks").delete(id);
    // Delete all points for this track via index cursor
    const idx = tx.objectStore("trackPoints").index("byTrack");
    const range = IDBKeyRange.only(id);
    const cursorReq = idx.openCursor(range);
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function appendTrackPoint(
  trackId: string,
  point: TrackPoint,
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("trackPoints", "readwrite");
    tx.objectStore("trackPoints").add({ trackId, ...point });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getTrackPoints(trackId: string): Promise<TrackPoint[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("trackPoints", "readonly");
    // Use compound index [trackId, timestamp] so points come back sorted by time
    const idx = tx.objectStore("trackPoints").index("byTrackTime");
    const range = IDBKeyRange.bound([trackId], [trackId, Infinity]);
    const req = idx.getAll(range);
    req.onsuccess = () => resolve(req.result as TrackPoint[]);
    req.onerror = () => reject(req.error);
  });
}

// --- Routes ---

export async function saveRoute(route: Route): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("routes", "readwrite");
    tx.objectStore("routes").put(route);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllRoutes(): Promise<Route[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("routes", "readonly");
    const req = tx.objectStore("routes").getAll();
    req.onsuccess = () => resolve(req.result as Route[]);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteRoute(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("routes", "readwrite");
    tx.objectStore("routes").delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// --- Waypoints ---

export async function saveWaypoint(wp: StandaloneWaypoint): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("waypoints", "readwrite");
    tx.objectStore("waypoints").put(wp);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllWaypoints(): Promise<StandaloneWaypoint[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("waypoints", "readonly");
    const req = tx.objectStore("waypoints").getAll();
    req.onsuccess = () => resolve(req.result as StandaloneWaypoint[]);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteWaypoint(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("waypoints", "readwrite");
    tx.objectStore("waypoints").delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// --- Plotting Sheets ---

export async function savePlottingSheet(sheet: PlottingSheet): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("plottingSheets", "readwrite");
    tx.objectStore("plottingSheets").put(sheet);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getPlottingSheet(
  id: string,
): Promise<PlottingSheet | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("plottingSheets", "readonly");
    const req = tx.objectStore("plottingSheets").get(id);
    req.onsuccess = () => resolve(req.result as PlottingSheet | undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function deletePlottingSheet(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("plottingSheets", "readwrite");
    tx.objectStore("plottingSheets").delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
