import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { DISCLAIMER_VERSION } from "../../src/ui/DisclaimerDialog";

/** Current app version from package.json. */
export const APP_VERSION: string = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
).version;

/** The app's IndexedDB database (see src/data/db.ts). */
const DB_NAME = "pelorus-nav";

// ── Map probe ────────────────────────────────────────────────────────────

/** A rendered/source feature as the specs' probes read it. */
export interface MapProbeFeature {
  properties: Record<string, unknown>;
  geometry: { coordinates: [number, number] };
}

/**
 * Probe view of the MapLibre map that main.ts exposes as `window.__map`
 * for tests. Mirrors the subset of the real Map API the e2e specs touch;
 * extend as specs need more.
 */
export interface MapProbe {
  project(lngLat: [number, number]): { x: number; y: number };
  jumpTo(opts: { center: [number, number]; zoom: number }): void;
  once(event: string, cb: () => void): void;
  getContainer(): HTMLElement;
  getCenter(): { lng: number; lat: number };
  getZoom(): number;
  getStyle(): { sources: Record<string, unknown> };
  getLayer(id: string): unknown;
  getLayoutProperty(layerId: string, prop: string): string | undefined;
  getSource(
    id: string,
  ): { serialize(): { data: GeoJSON.FeatureCollection } } | undefined;
  querySourceFeatures(sourceId: string): MapProbeFeature[];
  queryRenderedFeatures(
    geometry?: unknown,
    options?: { layers: string[] },
  ): MapProbeFeature[];
}

declare global {
  interface Window {
    /** The live MapLibre map, assigned during boot in main.ts. */
    __map: MapProbe;
  }
}

// ── Boot-time localStorage seeding (call before page.goto) ───────────────

/**
 * Pre-mark the current version's "What's New" notes as seen. Any test that
 * seeds `pelorus-nav-settings` looks like an upgrading user to the app, and
 * the one-time What's New dialog would otherwise overlay the map and
 * intercept every pointer event. Call before page.goto().
 */
export async function suppressWhatsNew(page: Page): Promise<void> {
  await page.addInitScript((version) => {
    localStorage.setItem("pelorus-nav-last-seen-version", version);
  }, APP_VERSION);
}

/**
 * Pre-accept the blocking navigation disclaimer (DisclaimerDialog.ts) —
 * without this, app startup halts at the "I Agree" dialog and the map never
 * initializes. Call before page.goto(). The version comes straight from the
 * app source, so a DISCLAIMER_VERSION bump can't strand the suite.
 */
export async function acceptDisclaimer(page: Page): Promise<void> {
  await page.addInitScript(
    ({ version, appVersion }) => {
      localStorage.setItem(
        "pelorus-nav-disclaimer-acceptance",
        JSON.stringify({
          disclaimerVersion: version,
          acceptedAt: Date.now(),
          appVersion,
        }),
      );
    },
    { version: DISCLAIMER_VERSION, appVersion: APP_VERSION },
  );
}

/**
 * Merge the given keys into the app's persisted settings
 * (`pelorus-nav-settings`) before the app boots. Call before page.goto().
 */
export async function seedSettings(
  page: Page,
  settings: Record<string, unknown>,
): Promise<void> {
  await page.addInitScript((partial) => {
    const raw = localStorage.getItem("pelorus-nav-settings");
    const merged = raw ? JSON.parse(raw) : {};
    Object.assign(merged, partial);
    localStorage.setItem("pelorus-nav-settings", JSON.stringify(merged));
  }, settings);
}

/**
 * Seed the persisted map camera (`pelorus-nav-map-position`) so the app
 * boots already looking at the test area. Call before page.goto().
 */
export async function seedMapPosition(
  page: Page,
  center: [number, number],
  zoom: number,
): Promise<void> {
  await page.addInitScript(
    (position) => {
      localStorage.setItem(
        "pelorus-nav-map-position",
        JSON.stringify(position),
      );
    },
    { center, zoom },
  );
}

// ── Boot readiness ───────────────────────────────────────────────────────

/**
 * Wait for the app's boot-readiness signal: main.ts sets
 * `data-app-ready="1"` on <html> once persisted nav/COB state has been
 * restored and the app's IndexedDB is open (object stores created). The
 * topbar renders before those restores, so button visibility does NOT
 * imply the database is ready — call this before seedIndexedDb/readIndexedDb.
 */
export async function waitForAppReady(page: Page): Promise<void> {
  await page
    .locator("html[data-app-ready='1']")
    .waitFor({ state: "attached", timeout: 15000 });
}

// ── IndexedDB seeding/reading (call after the app has created the DB) ────

/**
 * Put records into the app's IndexedDB, one readwrite transaction across all
 * listed stores. The stores must already exist — seed only after
 * waitForAppReady() has resolved.
 */
export async function seedIndexedDb(
  page: Page,
  stores: Record<string, unknown[]>,
): Promise<void> {
  await page.evaluate(
    ({ dbName, byStore }) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open(dbName);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(Object.keys(byStore), "readwrite");
          for (const [store, records] of Object.entries(byStore)) {
            for (const record of records) tx.objectStore(store).put(record);
          }
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    { dbName: DB_NAME, byStore: stores },
  );
}

/** All records from one of the app's IndexedDB object stores. */
export function readIndexedDb<T>(page: Page, store: string): Promise<T[]> {
  return page.evaluate(
    ({ dbName, storeName }) =>
      new Promise<unknown[]>((resolve, reject) => {
        const req = indexedDB.open(dbName);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(storeName, "readonly");
          const getAll = tx.objectStore(storeName).getAll();
          getAll.onsuccess = () => {
            db.close();
            resolve(getAll.result);
          };
          getAll.onerror = () => reject(getAll.error);
        };
      }),
    { dbName: DB_NAME, storeName: store },
  ) as Promise<T[]>;
}

// ── Route seeding ────────────────────────────────────────────────────────

/** Matches src/data/Route.ts. */
export interface RouteWaypoint {
  lat: number;
  lon: number;
  name: string;
}

export interface SeedRoute {
  id: string;
  name: string;
  createdAt: number;
  color: string;
  visible: boolean;
  waypoints: RouteWaypoint[];
}

/** Put one route into the "routes" store (see seedIndexedDb for timing). */
export function seedRoute(page: Page, route: SeedRoute): Promise<void> {
  return seedIndexedDb(page, { routes: [route] });
}

// ── Settings panel (layout-aware) ────────────────────────────────────────

/**
 * Open the settings panel from either topbar presentation: on wide screens
 * the gear sits inline in the top bar; on narrow screens (`topbar-collapsed`,
 * e.g. the mobile-chrome project) it lives in the hamburger dropdown, which
 * must be opened first. Resolves once the panel is open.
 */
export async function openSettings(page: Page): Promise<void> {
  const hamburger = page.locator("#hamburger-btn");
  if (await hamburger.isVisible()) await hamburger.click();
  await page.locator(".settings-wrapper button").first().click();
  await page.locator(".settings-panel.open").waitFor();
}

/**
 * Close the settings panel in either layout: on narrow screens the hamburger
 * doubles as the panel's close (✕) button; on wide screens the gear toggles
 * it shut. Resolves once the panel is closed.
 */
export async function closeSettings(page: Page): Promise<void> {
  const hamburger = page.locator("#hamburger-btn");
  if (await hamburger.isVisible()) {
    await hamburger.click();
  } else {
    await page.locator(".settings-wrapper button").first().click();
  }
  await page.locator(".settings-panel.open").waitFor({ state: "hidden" });
}
