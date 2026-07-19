/**
 * Play Store listing screenshots: 3 scenes x 3 form factors
 * (phone 1080x1920, 7" tablet 1200x1920, 10" tablet 1920x1200).
 * Dev server must be running on :5173. Run: bun tools/store-screenshots.ts
 * Output: branding/store-listing/
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

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
  tides: boolean;
  zoom: number;
  /** "free" pans to `center` instead of following the vessel. */
  chartMode?: "free";
  center?: [number, number]; // [lng, lat]
}
const SCENES: Scene[] = [
  { name: "harbor-day", theme: "day", tides: false, zoom: 13.2 },
  {
    name: "tides-currents",
    theme: "day",
    tides: true,
    zoom: 13.4,
    chartMode: "free",
    center: [-70.946, 42.337],
  },
  { name: "night-mode", theme: "night", tides: false, zoom: 13.2 },
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

async function shoot(
  scene: Scene,
  fmt: Format,
  browser: import("playwright").Browser,
) {
  const ctx = await browser.newContext({
    viewport: { width: fmt.width, height: fmt.height },
    deviceScaleFactor: fmt.dsf,
  });
  const page = await ctx.newPage();

  await page.addInitScript(
    (cfg: {
      scene: Scene;
      version: string;
      wpts: typeof ROUTE_WPTS;
      simWpts: typeof ROUTE_WPTS;
    }) => {
      const settings = {
        gpsSource: "simulator",
        simulatorMode: "custom",
        chartMode: cfg.scene.chartMode ?? "follow",
        showInstrumentHUD: true,
        displayTheme: cfg.scene.theme,
        layerGroups: cfg.scene.tides ? { tidesCurrents: true } : {},
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

      // Seed the route into IndexedDB before the app opens it. Schema must
      // mirror src/data/db.ts (DB_VERSION 7).
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
        const tx = db.transaction("routes", "readwrite");
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
        tx.oncomplete = () => db.close();
      };
    },
    { scene, version: APP_VERSION, wpts: ROUTE_WPTS, simWpts: SIM_WPTS },
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
