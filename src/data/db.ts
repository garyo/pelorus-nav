/**
 * IndexedDB persistence for tracks and routes.
 * Thin wrapper — no library dependency.
 */

import type { Route } from "./Route";
import type { TrackMeta, TrackPoint } from "./Track";

const DB_NAME = "pelorus-nav";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("tracks")) {
        db.createObjectStore("tracks", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("trackPoints")) {
        const store = db.createObjectStore("trackPoints", {
          autoIncrement: true,
        });
        store.createIndex("byTrack", "trackId");
      }
      if (!db.objectStoreNames.contains("routes")) {
        db.createObjectStore("routes", { keyPath: "id" });
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
    const idx = tx.objectStore("trackPoints").index("byTrack");
    const req = idx.getAll(trackId);
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
