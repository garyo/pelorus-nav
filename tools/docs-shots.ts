/**
 * User-guide screenshots for docs-site/. Deterministic scenes: the simulator
 * holds the vessel at a fixed pose (dev-only ?simMode=linear) and routes,
 * waypoints, and settings are seeded before the app boots, so every run
 * produces the same images. Dev server must be running on :5173.
 *
 * Run: bun run docs:shots [scene ...]   (no args = all scenes)
 * Output: docs-site/public/images/<name>.png (committed to git).
 */
import { mkdirSync, readFileSync } from "node:fs";
import { type Browser, chromium, type Page } from "playwright";
import { REPLAY_TRACK } from "../src/navigation/replay-track";

const BASE = process.env.DOCS_SHOTS_BASE ?? "http://localhost:5173";
const OUT = new URL("../docs-site/public/images", import.meta.url).pathname;
const APP_VERSION = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version as string;

// Vessel pose: outer Boston Harbor at The Narrows, heading up the channel.
const VESSEL: [number, number] = [42.337764, -70.949034]; // lat, lon
const VESSEL_COG = 40;

// A tidy harbor route shown (and edited/followed) in the route scenes.
const ROUTE_WPTS: Array<[number, number, string]> = [
  [42.352039, -71.032698, "Castle Is."],
  [42.342674, -71.014302, "President Roads"],
  [42.332517, -70.995676, "Deer Is."],
  [42.337764, -70.949034, "The Narrows"],
  [42.342743, -70.940904, "Channel Split"],
  [42.37055, -70.916631, "Outer Harbor"],
];

// The recorded replay sail, seeded as a finished track so the Track Viewer
// has something real to show. SOG/COG derived from consecutive positions.
function buildSeedTrack() {
  const R_NM = 3440.065;
  const rad = (d: number) => (d * Math.PI) / 180;
  const points: Array<{
    lat: number;
    lon: number;
    timestamp: number;
    sog: number | null;
    cog: number | null;
  }> = [];
  const lastT = REPLAY_TRACK[REPLAY_TRACK.length - 1][0];
  const endMs = Date.now();
  const startMs = endMs - lastT * 1000;
  let totalNm = 0;
  for (let i = 0; i < REPLAY_TRACK.length; i++) {
    const [t, lat, lon] = REPLAY_TRACK[i];
    let sog: number | null = null;
    let cog: number | null = null;
    if (i > 0) {
      const [pt, plat, plon] = REPLAY_TRACK[i - 1];
      const dLat = rad(lat - plat);
      const dLon = rad(lon - plon);
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(rad(plat)) * Math.cos(rad(lat)) * Math.sin(dLon / 2) ** 2;
      const nm = 2 * R_NM * Math.asin(Math.sqrt(a));
      totalNm += nm;
      const dt = t - pt;
      sog = dt > 0 ? (nm / dt) * 3600 : null;
      const y = Math.sin(dLon) * Math.cos(rad(lat));
      const x =
        Math.cos(rad(plat)) * Math.sin(rad(lat)) -
        Math.sin(rad(plat)) * Math.cos(rad(lat)) * Math.cos(dLon);
      cog = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
    }
    points.push({ lat, lon, timestamp: startMs + t * 1000, sog, cog });
  }
  const meta = {
    id: "docs-shot-track",
    name: "Afternoon Sail",
    createdAt: startMs,
    color: "#2980b9",
    visible: true,
    pointCount: points.length,
    durationMs: lastT * 1000,
    totalDistanceNM: totalNm,
  };
  return { meta, points };
}
const SEED_TRACK = buildSeedTrack();

interface Scene {
  name: string;
  theme?: "day" | "dusk" | "night" | "eink";
  zoom?: number;
  center?: [number, number]; // [lng, lat]; defaults to the vessel
  /** Override the pinned vessel pose ([lat, lon], true heading). */
  vessel?: [number, number];
  cog?: number;
  width?: number; // viewport width; default 1000
  /** Seed the recorded demo track (only track scenes want it visible). */
  seedTrack?: boolean;
  /** Drive the UI after the chart settles; the screenshot follows. */
  actions?: (page: Page) => Promise<void>;
}

/** Click a topbar action by title, falling back to the hamburger menu. */
async function clickTopbar(page: Page, title: string) {
  const btn = page.locator(`button[title="${title}"]`).first();
  if (await btn.isVisible()) {
    await btn.click();
  } else {
    await page.click("#hamburger-btn");
    await page.locator(`#topbar-menu button[title="${title}"]`).click();
  }
}

async function openRoutePanel(page: Page) {
  await clickTopbar(page, "Routes");
  await page.waitForSelector(".route-manager-panel.open");
}

const SCENES: Scene[] = [
  { name: "overview", zoom: 12.6, center: [-70.98, 42.34] },
  { name: "night-mode", theme: "night", zoom: 12.6, center: [-70.98, 42.34] },
  {
    name: "settings-appearance",
    actions: async (page) => {
      await clickTopbar(page, "Settings");
      await page.click('.settings-tab[data-tab="appearance"]');
    },
  },
  {
    name: "settings-layers",
    actions: async (page) => {
      await clickTopbar(page, "Settings");
      await page.click('.settings-tab[data-tab="layers"]');
    },
  },
  {
    name: "chart-regions",
    actions: async (page) => {
      await clickTopbar(page, "Chart Regions");
      await page.waitForSelector(".chart-cache-panel.open");
    },
  },
  {
    name: "context-menu",
    zoom: 13.2,
    actions: async (page) => {
      const size = page.viewportSize();
      if (!size) throw new Error("no viewport");
      await page.mouse.click(size.width * 0.45, size.height * 0.55, {
        button: "right",
      });
      await page.waitForSelector(".map-context-menu");
    },
  },
  {
    name: "route-manager",
    zoom: 12.3,
    center: [-70.97, 42.345],
    actions: async (page) => {
      await openRoutePanel(page);
      // Select the route so the detail panel (leg table) opens alongside.
      await page.click(".route-manager-panel .manager-item-name");
      await page.waitForSelector(".route-detail-panel.open");
    },
  },
  {
    name: "route-editing",
    zoom: 12.3,
    center: [-70.97, 42.345],
    width: 1240,
    actions: async (page) => {
      await openRoutePanel(page);
      await page.click('.route-manager-panel button[title="Edit"]');
      await page.waitForSelector(".route-editor-bar", { state: "visible" });
      // Select a mid-route waypoint: highlight ring + Delete / Insert After.
      await page.click(".route-detail-panel .route-list-wp >> nth=2");
      await page.waitForTimeout(1_000);
    },
  },
  {
    name: "track-viewer",
    zoom: 12.4,
    seedTrack: true,
    actions: async (page) => {
      await clickTopbar(page, "Tracks");
      await page.click('button[title="View track"]');
      await page.waitForSelector(".track-viewer-panel");
      // Scrub to ~55% so the cursor sits mid-track with the chart lit.
      await page.evaluate(() => {
        const slider = document.querySelector<HTMLInputElement>(
          ".track-viewer-slider",
        );
        if (slider) {
          slider.value = String(Math.round(Number(slider.max) * 0.55));
          slider.dispatchEvent(new Event("input", { bubbles: true }));
        }
      });
      await page.waitForTimeout(3_000);
    },
  },
  {
    name: "route-navigation",
    zoom: 12.6,
    center: [-70.96, 42.34],
    // Mid-leg between Deer Is. and The Narrows, tracking the 095°M leg, so
    // DTW/BRG/VMG/Steer all show sensible under-way values.
    vessel: [42.3345, -70.975],
    cog: 81,
    actions: async (page) => {
      await openRoutePanel(page);
      await page.click('.route-manager-panel button[title="Navigate route"]');
      await page.waitForSelector(".instrument-nav-group");
      // Close any open panels so the chart, nav instruments, and cancel
      // button carry the shot.
      for (const panel of [".route-detail-panel", ".route-manager-panel"]) {
        const close = page.locator(`${panel}.open .manager-close`);
        if (await close.isVisible()) await close.click();
      }
      await page.waitForTimeout(1_500);
    },
  },
];

async function shoot(scene: Scene, browser: Browser) {
  const ctx = await browser.newContext({
    viewport: { width: scene.width ?? 1000, height: 700 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();

  await page.addInitScript(
    (cfg: {
      scene: { theme?: string; zoom?: number; center?: [number, number] };
      version: string;
      vessel: [number, number];
      wpts: typeof ROUTE_WPTS;
      track: typeof SEED_TRACK | null;
    }) => {
      localStorage.setItem(
        "pelorus-nav-settings",
        JSON.stringify({
          gpsSource: "simulator",
          simulatorMode: "route",
          chartMode: "free",
          showInstrumentHUD: true,
          displayTheme: cfg.scene.theme ?? "day",
        }),
      );
      localStorage.setItem("pelorus-nav-last-seen-version", cfg.version);
      localStorage.setItem(
        "pelorus-nav-disclaimer-acceptance",
        JSON.stringify({
          disclaimerVersion: 2,
          acceptedAt: Date.now(),
          appVersion: cfg.version,
        }),
      );
      localStorage.setItem(
        "pelorus-nav-map-position",
        JSON.stringify({
          center: cfg.scene.center ?? [cfg.vessel[1], cfg.vessel[0]],
          zoom: cfg.scene.zoom ?? 13.2,
        }),
      );

      // Seed the demo route before the app opens IndexedDB.
      // Schema must mirror src/data/db.ts (DB_VERSION 7).
      const req = indexedDB.open("pelorus-nav", 7);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore("tracks", { keyPath: "id" });
        const pt = db.createObjectStore("trackPoints", { autoIncrement: true });
        pt.createIndex("byTrack", "trackId");
        pt.createIndex("byTrackTime", ["trackId", "timestamp"]);
        db.createObjectStore("routes", { keyPath: "id" });
        db.createObjectStore("waypoints", { keyPath: "id" });
        db.createObjectStore("plottingSheets", { keyPath: "id" });
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(
          ["routes", "tracks", "trackPoints"],
          "readwrite",
        );
        tx.objectStore("routes").put({
          id: "docs-shot-route",
          name: "Outer Harbor",
          createdAt: Date.now(),
          color: "#ffcc00",
          visible: true,
          waypoints: cfg.wpts.map(([lat, lon, name]) => ({ lat, lon, name })),
        });
        if (cfg.track) {
          tx.objectStore("tracks").put(cfg.track.meta);
          const ptStore = tx.objectStore("trackPoints");
          for (const p of cfg.track.points) {
            ptStore.add({ trackId: cfg.track.meta.id, ...p });
          }
        }
        tx.oncomplete = () => db.close();
      };
    },
    {
      scene: scene,
      version: APP_VERSION,
      vessel: scene.vessel ?? VESSEL,
      wpts: ROUTE_WPTS,
      track: scene.seedTrack ? SEED_TRACK : null,
    },
  );

  // simMode=linear (dev-only) pins the vessel at simStart on a fixed heading,
  // so SOG/COG and every nav readout are stable run to run.
  const [lat, lon] = scene.vessel ?? VESSEL;
  await page.goto(
    `${BASE}/?simStart=${lat},${lon}&simMode=linear&simCog=${scene.cog ?? VESSEL_COG}`,
  );
  await page.waitForFunction(
    () => {
      const text = document.querySelector(".instrument-value")?.textContent;
      return !!text && !text.includes("--");
    },
    { timeout: 30_000 },
  );
  await page.waitForTimeout(6_000); // tiles + sprites settle

  await scene.actions?.(page);
  await page.waitForTimeout(500);

  const path = `${OUT}/${scene.name}.png`;
  await page.screenshot({ path });
  console.log(`✓ ${path}`);
  await ctx.close();
}

const only = process.argv.slice(2);
const scenes = only.length
  ? SCENES.filter((s) => only.includes(s.name))
  : SCENES;
if (only.length && scenes.length !== only.length) {
  const known = new Set(SCENES.map((s) => s.name));
  throw new Error(`unknown scene(s): ${only.filter((n) => !known.has(n))}`);
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  args: ["--enable-webgl", "--use-gl=angle", "--use-angle=swiftshader"],
});
for (const scene of scenes) {
  await shoot(scene, browser);
}
await browser.close();
console.log("done");
