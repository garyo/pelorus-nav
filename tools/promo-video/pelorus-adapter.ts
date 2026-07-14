import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import type { AppAdapter } from "../tutorial-gen/index";

/**
 * PelorusAdapter — the app-specific seam for the tutorial engine. Holds every
 * Pelorus Nav detail the generic engine must not know: settings/disclaimer
 * seeding, the `?simStart/simMode/simCog` URL rigging, the `window.__map`
 * readiness predicate, pmtiles-HEAD blocking, and the MapLibre camera ops
 * (flyTo watchdog, project, jumpTo) exposed to scenes as `ctx.app`.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.PELORUS_URL ?? "http://localhost:5173";
const APP_VERSION: string = JSON.parse(
  readFileSync(join(HERE, "..", "..", "package.json"), "utf8"),
).version;

/** Simulator route start = first point of BOSTON_HARBOR_ROUTE (inner harbor). */
export const SIM_START: [number, number] = [42.363715, -71.04743];

/** Settings seeded into every scene before the app boots. */
export const BASE_SETTINGS: Record<string, unknown> = {
  textScale: 1.4, // large chart text for video legibility
  iconScale: 1.3,
  showInstrumentHUD: true,
  instrumentCells: ["sog", "cog", "hdg", "depth"],
  gpsSource: "simulator",
  simulatorMode: "route",
  simulatorSpeed: 4, // ~24 kn effective — reads as "live", stays plausible
  chartMode: "follow",
  displayTheme: "day",
  layerGroups: { lightSectors: true },
};

/** Per-scene Pelorus configuration (consumed only by this adapter). */
export interface PelorusSetup {
  /** Settings merged over BASE_SETTINGS. */
  settings?: Record<string, unknown>;
  /** Map center/zoom seeded before boot (follow mode may override center). */
  mapPosition?: { center: [number, number]; zoom: number };
  /** Zoom applied after boot (survives follow mode, unlike the seeded one). */
  zoom?: number;
  /** Simulator start [lat, lon] (URL ?simStart=). Defaults to SIM_START. */
  simStart?: [number, number];
  /** Dev-only linear sim: hold the boat at simStart on this fixed heading (deg). */
  simCog?: number;
  /** URL to open; defaults to the sim-route start. */
  url?: string;
}

/** The MapLibre camera surface exposed to scenes as `ctx.app`. */
export interface PelorusApp {
  /**
   * Animate the map camera and wait for it to arrive. The move runs under a
   * watchdog that survives app-side camera interruptions, and the target is
   * pinned for `holdMs` (default 400) after arrival — put the post-move dwell
   * time there rather than in a following wait() so the shot holds.
   */
  flyTo(opts: {
    center?: [number, number];
    zoom?: number;
    bearing?: number;
    durationMs?: number;
    holdMs?: number;
  }): Promise<void>;
  /** Jump the camera instantly (no animation). */
  jumpTo(opts: { center: [number, number]; zoom: number }): Promise<void>;
  /** Project [lng, lat] to a screen pixel (for clicking chart features). */
  project(lngLat: [number, number]): Promise<{ x: number; y: number }>;
  /** Wait for the map object to exist (e.g. after a reload). */
  waitForMapReady(): Promise<void>;
}

/** Runs in the page before any app script (serialized — keep self-contained). */
function seedInit(seed: {
  version: string;
  settings: Record<string, unknown>;
  mapPosition: unknown;
}) {
  // Merges settings, pre-accepts the disclaimer, and marks the current What's
  // New as seen so nothing overlays.
  localStorage.setItem("pelorus-nav-settings", JSON.stringify(seed.settings));
  localStorage.setItem("pelorus-nav-last-seen-version", seed.version);
  localStorage.setItem(
    "pelorus-nav-disclaimer-acceptance",
    JSON.stringify({
      disclaimerVersion: 2,
      acceptedAt: Date.now(),
      appVersion: seed.version,
    }),
  );
  if (seed.mapPosition)
    localStorage.setItem(
      "pelorus-nav-map-position",
      JSON.stringify(seed.mapPosition),
    );
}

// isStyleLoaded()/areTilesLoaded() never settle with streaming sources, so gate
// only on the map object existing, then rely on the capture's settle.
async function waitForMap(page: Page): Promise<void> {
  await page
    .locator(".maplibregl-map")
    .waitFor({ state: "visible", timeout: 15000 });
  await page.waitForFunction(
    () => !!(window as unknown as { __map?: unknown }).__map,
    { timeout: 15000 },
  );
}

export const pelorusAdapter: AppAdapter<PelorusSetup, PelorusApp> = {
  baseUrl: BASE_URL,

  async prepare(page, scene) {
    // The startup chart-version check HEADs the streaming pmtiles; if it
    // resolves mid-flyTo it triggers refreshStyle() → setStyle(), which cancels
    // the camera animation. Abort just those HEADs — tile reads are GETs.
    await page.route("**/*.pmtiles*", (route) =>
      route.request().method() === "HEAD" ? route.abort() : route.continue(),
    );
    const settings = { ...BASE_SETTINGS, ...(scene.setup?.settings ?? {}) };
    await page.addInitScript(seedInit, {
      version: APP_VERSION,
      settings,
      mapPosition: scene.setup?.mapPosition ?? null,
    });
  },

  urlFor(scene) {
    const s = scene.setup ?? {};
    const start = s.simStart ?? SIM_START;
    const params = new URLSearchParams({ simStart: `${start[0]},${start[1]}` });
    if (s.simCog !== undefined) {
      params.set("simMode", "linear");
      params.set("simCog", String(s.simCog));
    }
    return s.url ?? `${BASE_URL}/?${params.toString()}`;
  },

  ready: waitForMap,

  async afterReady(page, scene) {
    const z = scene.setup?.zoom;
    if (z === undefined) return;
    await page.evaluate((zz) => {
      (
        window as unknown as { __map: { setZoom(z: number): void } }
      ).__map.setZoom(zz);
    }, z);
  },

  makeApp(page): PelorusApp {
    return {
      // A bare map.flyTo is fire-and-forget: any app-side camera call
      // (map.stop()/jumpTo/easeTo from startup async work) silently kills the
      // animation and the clip records no move at all. So drive the flight
      // under an in-page rAF watchdog: re-issue it if it gets cancelled, then
      // pin the target camera for holdMs so the end state survives too.
      async flyTo({ center, zoom, bearing, durationMs = 2500, holdMs = 400 }) {
        await page.evaluate(
          ({ center, zoom, bearing, durationMs, holdMs }) => {
            const w = window as unknown as {
              __map: {
                flyTo(o: unknown): void;
                jumpTo(o: unknown): void;
                isMoving(): boolean;
                getCenter(): { lng: number; lat: number };
                getZoom(): number;
                getBearing(): number;
              };
              __promoFlySeq?: number;
              __promoFlyDone?: boolean;
            };
            const m = w.__map;
            const seq = (w.__promoFlySeq ?? 0) + 1;
            w.__promoFlySeq = seq;
            const to = {
              center: center ?? [m.getCenter().lng, m.getCenter().lat],
              zoom: zoom ?? m.getZoom(),
              bearing: bearing ?? m.getBearing(),
            };
            const deadline = performance.now() + durationMs;
            const end = deadline + holdMs;
            w.__promoFlyDone = false;
            m.flyTo({ ...to, duration: durationMs, essential: true });
            const atTarget = () =>
              Math.abs(m.getZoom() - to.zoom) < 1e-3 &&
              Math.abs(m.getCenter().lng - to.center[0]) < 1e-7 &&
              Math.abs(m.getCenter().lat - to.center[1]) < 1e-7 &&
              Math.abs(m.getBearing() - to.bearing) < 1e-2;
            const tick = (now: number) => {
              if (w.__promoFlySeq !== seq) return; // superseded by a newer flyTo
              if (now < deadline) {
                // Mid-flight but not animating → something stopped it; resume
                // smoothly for the remaining time.
                if (!m.isMoving()) {
                  m.flyTo({ ...to, duration: deadline - now, essential: true });
                }
              } else if (!atTarget()) {
                m.jumpTo(to); // arrived: hold the shot against stray moves
              }
              if (now >= end) {
                w.__promoFlyDone = true;
                return;
              }
              requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          },
          { center, zoom, bearing, durationMs, holdMs },
        );
        await page.waitForFunction(
          () =>
            (window as unknown as { __promoFlyDone?: boolean })
              .__promoFlyDone === true,
          { timeout: durationMs + holdMs + 5000 },
        );
      },

      async jumpTo(pos) {
        await page.evaluate((p) => {
          (
            window as unknown as { __map: { jumpTo(o: unknown): void } }
          ).__map.jumpTo(p);
        }, pos);
      },

      project: (lngLat) =>
        page.evaluate((ll) => {
          const p = (
            window as unknown as {
              __map: { project(c: [number, number]): { x: number; y: number } };
            }
          ).__map.project(ll);
          return { x: p.x, y: p.y };
        }, lngLat),

      waitForMapReady: () => waitForMap(page),
    };
  },
};
