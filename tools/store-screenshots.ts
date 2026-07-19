/**
 * Play Store listing screenshots: 6 scenes x 3 form factors
 * (phone 1080x1920, 7" tablet 1200x1920, 10" tablet 1920x1200).
 * Dev server must be running on :5173. Run: bun tools/store-screenshots.ts
 * Output: branding/store-listing/
 */
import { mkdirSync } from "node:fs";
import { type Browser, chromium, type Page } from "playwright";
import { REPLAY_TRACK } from "../src/navigation/replay-track";

const BASE = "http://localhost:5173";
const OUT = new URL("../branding/store-listing", import.meta.url).pathname;
const APP_VERSION = "0.14.0";

// Outer-harbor leg of the simulator's Boston loop, saved as a visible route
// so the chart shows route legs + waypoints alongside the vessel.
const ROUTE_WPTS: Array<[number, number, string]> = [
  [42.352039, -71.032698, "Castle Is."],
  [42.342674, -71.014302, "President Roads"],
  [42.332517, -70.995676, "Deer Is."],
  [42.337764, -70.949034, "The Narrows"],
  [42.342743, -70.940904, "Channel Split"],
  [42.37055, -70.916631, "Outer Harbor"],
];

// ?simStart= always heads for the default route's first (inner-harbor)
// waypoint, i.e. inbound. To get an outbound vessel we instead use
// simulatorMode "custom", which follows a user route named SIMULATOR —
// seeded invisible below, starting at The Narrows heading northeast into
// the North/South Channel split.
const SIM_WPTS: Array<[number, number, string]> = [
  [42.337764, -70.949034, "start"],
  [42.342743, -70.940904, "split"],
  [42.37055, -70.916631, "outer"],
];

interface Scene {
  name: string;
  theme: "day" | "night";
  zoom: number;
  /** "free" pans to `center` instead of following the vessel. */
  chartMode?: "free";
  center?: [number, number]; // [lng, lat]
  /** Open a UI surface after the map settles. */
  ui?:
    | "settings-appearance"
    | "settings-layers"
    | "settings-navigation"
    | "track-viewer";
  /** Override the GPS source ("browser-gps" shows as "Device GPS" and uses
   *  Playwright's mocked geolocation — no simulator rows in Settings). */
  gpsSource?: "browser-gps";
}
const SCENES: Scene[] = [
  { name: "harbor-day", theme: "day", zoom: 13.2 },
  { name: "night-mode", theme: "night", zoom: 13.2 },
  {
    name: "settings-appearance",
    theme: "day",
    zoom: 13.2,
    ui: "settings-appearance",
  },
  { name: "settings-layers", theme: "day", zoom: 13.2, ui: "settings-layers" },
  {
    name: "settings-navigation",
    theme: "day",
    zoom: 13.2,
    ui: "settings-navigation",
    gpsSource: "browser-gps",
  },
  { name: "track-playback", theme: "day", zoom: 12.6, ui: "track-viewer" },
];

interface Format {
  name: string;
  width: number;
  height: number;
  dsf: number;
}
const FORMATS: Format[] = [
  { name: "phone", width: 360, height: 640, dsf: 3 }, // 1080x1920
  { name: "tab7", width: 600, height: 960, dsf: 2 }, // 1200x1920
  { name: "tab10", width: 960, height: 600, dsf: 2 }, // 1920x1200
];

// A real recorded sail (the simulator replay track), seeded into IndexedDB
// so the track viewer has something beautiful to play back. SOG/COG are
// derived from consecutive positions.
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
    id: "store-shot-track",
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

async function shoot(scene: Scene, fmt: Format, browser: Browser) {
  const ctx = await browser.newContext({
    viewport: { width: fmt.width, height: fmt.height },
    deviceScaleFactor: fmt.dsf,
    ...(scene.gpsSource === "browser-gps"
      ? {
          geolocation: { latitude: 42.3378, longitude: -70.949, accuracy: 5 },
          permissions: ["geolocation"],
        }
      : {}),
  });
  const page = await ctx.newPage();

  await page.addInitScript(
    (cfg: {
      scene: Scene;
      version: string;
      wpts: typeof ROUTE_WPTS;
      simWpts: typeof ROUTE_WPTS;
      track: typeof SEED_TRACK;
    }) => {
      const settings = {
        gpsSource: cfg.scene.gpsSource ?? "simulator",
        simulatorMode: "custom",
        chartMode: cfg.scene.chartMode ?? "follow",
        showInstrumentHUD: true,
        displayTheme: cfg.scene.theme,
      };
      localStorage.setItem("pelorus-nav-settings", JSON.stringify(settings));
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
          center: cfg.scene.center ?? [-70.949, 42.3378],
          zoom: cfg.scene.zoom,
        }),
      );

      // Seed routes + the recorded track into IndexedDB before the app
      // opens it. Schema must mirror src/data/db.ts (DB_VERSION 7).
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
          id: "store-shot-route",
          name: "Outer Harbor",
          createdAt: Date.now(),
          color: "#ffcc00",
          visible: true,
          waypoints: cfg.wpts.map(([lat, lon, name]) => ({ lat, lon, name })),
        });
        tx.objectStore("routes").put({
          id: "store-shot-sim",
          name: "SIMULATOR",
          createdAt: Date.now(),
          color: "#4488cc",
          visible: false,
          waypoints: cfg.simWpts.map(([lat, lon, name]) => ({
            lat,
            lon,
            name,
          })),
        });
        tx.objectStore("tracks").put(cfg.track.meta);
        const ptStore = tx.objectStore("trackPoints");
        for (const p of cfg.track.points) {
          ptStore.add({ trackId: cfg.track.meta.id, ...p });
        }
        tx.oncomplete = () => db.close();
      };
    },
    {
      scene,
      version: APP_VERSION,
      wpts: ROUTE_WPTS,
      simWpts: SIM_WPTS,
      track: SEED_TRACK,
    },
  );

  await page.goto(`${BASE}/`);
  await page.waitForFunction(
    () => {
      const text = document.querySelector(".instrument-value")?.textContent;
      return !!text && !text.includes("--");
    },
    { timeout: 30_000 },
  );
  await page.waitForTimeout(6_000); // tiles + sprite settle

  if (scene.ui?.startsWith("settings-")) {
    await clickTopbar(page, "Settings");
    const tab = scene.ui.slice("settings-".length);
    await page.click(`.settings-tab[data-tab="${tab}"]`);
    await page.waitForTimeout(1_000);
  } else if (scene.ui === "track-viewer") {
    await clickTopbar(page, "Tracks");
    await page.click('button[title="View track"]');
    await page.waitForSelector(".track-viewer-panel");
    // Scrub to ~55% so the cursor sits mid-track with the speed chart lit.
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
  }

  const path = `${OUT}/${scene.name}-${fmt.name}.png`;
  await page.screenshot({ path });
  console.log(`✓ ${path}`);
  await ctx.close();
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  args: ["--enable-webgl", "--use-gl=angle", "--use-angle=swiftshader"],
});
for (const scene of SCENES) {
  for (const fmt of FORMATS) {
    await shoot(scene, fmt, browser);
  }
}
await browser.close();
console.log("done");
