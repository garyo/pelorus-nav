import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { REPLAY_TRACK } from "../../src/navigation/replay-track";
import { haversineDistanceNM } from "../../src/utils/coordinates";
import type { Scene, Storyboard } from "../tutorial-gen/index";
import type { PelorusApp, PelorusSetup } from "./pelorus-adapter";

/**
 * Pelorus Nav promo storyboard, as data on top of the generic tutorial engine.
 * Each scene is captured to its own clip; captions/durations/effects here are
 * the single source of truth shared with the assemble. Edit a scene, re-run
 * capture, rebuild — clip filenames are stable, so edits survive re-capture.
 *
 * The intro/outro cards are pre-rendered stills (logo + text), not captured.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const FONT = join(HERE, "..", "..", "branding", "fonts", "Outfit-SemiBold.ttf");
const TITLE = join(HERE, "assets", "title.png");
const OUTRO = join(HERE, "assets", "outro.png");
const MUSIC = join(HERE, "assets", "the-low-seas.mp3");

type PelorusScene = Scene<PelorusSetup, PelorusApp>;

/**
 * Scituate → Provincetown route (the owner's real "Scituate to Ptown" GPX).
 * Seeded into IndexedDB as "SIMULATOR" so the simulator navigates it
 * (simulatorMode "custom"). The capture runs in an isolated browser context,
 * so the route must be seeded — it can't see routes saved in the normal browser.
 */
const ROUTE_WAYPOINTS = [
  { lat: 42.15773470311723, lon: -70.69656202029356, name: "WP1" },
  { lat: 41.99623813820554, lon: -70.1904382572625, name: "WP2" },
  { lat: 42.03255406000969, lon: -70.1538716919916, name: "4" },
  { lat: 42.04403818884464, lon: -70.16230590780783, name: "X" },
];

/**
 * The simulator's real recorded Boston Harbor sail (REPLAY_TRACK: 1237 fixes,
 * 5.1 h, ~21 NM), converted to a saved Track for the track-review scene. The
 * capture context is isolated, so the track is seeded into IndexedDB each run.
 * sog/cog stay null — the viewer derives speed and course from the fixes.
 */
const HARBOR_SAIL_ID = "promo-harbor-sail";
const HARBOR_SAIL_START_MS = Date.UTC(2026, 5, 4, 17, 17, 0); // 13:17 EDT, the real sail's start
const HARBOR_SAIL = (() => {
  const points = REPLAY_TRACK.map(([t, lat, lon]) => ({
    trackId: HARBOR_SAIL_ID,
    lat,
    lon,
    timestamp: HARBOR_SAIL_START_MS + t * 1000,
    sog: null,
    cog: null,
  }));
  let totalDistanceNM = 0;
  for (let i = 1; i < points.length; i++) {
    const p = points[i - 1];
    const q = points[i];
    totalDistanceNM += haversineDistanceNM(p.lat, p.lon, q.lat, q.lon);
  }
  const meta = {
    id: HARBOR_SAIL_ID,
    name: "Boston Harbor sail",
    createdAt: HARBOR_SAIL_START_MS,
    color: "#ff4444",
    visible: true,
    pointCount: points.length,
    durationMs: points[points.length - 1].timestamp - points[0].timestamp,
    totalDistanceNM,
  };
  return { meta, points };
})();

const scenes: PelorusScene[] = [
  {
    id: "live-nav",
    caption: "Navigate with simple controls",
    duration: 9,
    in: 5,
    setup: {
      settings: { chartMode: "free", simulatorSpeed: 3 },
      mapPosition: { center: [-71.015376, 42.344358], zoom: 13.8 },
      zoom: 13.8,
      // Start the vessel in open water (President Roads channel, N of center) so
      // it's on screen and afloat — the default SIM_START is up the inner harbor,
      // off-frame, and the shoreline to the west/NW is too close.
      simStart: [42.348, -71.02],
    },
    async drive({ wait, app, click }) {
      await wait(4000);
      // Click the buoy to reveal its detail pane. Nudge the click point up ~20px
      // so the cursor lands right on the buoy symbol rather than just below it.
      const p = await app.project([-71.010425, 42.344284]);
      await click({ x: p.x, y: p.y - 20 });
      await wait(3800);
    },
  },
  {
    id: "s52-charts",
    caption: "Modern standard charts, updated daily from NOAA",
    duration: 6,
    in: 5.5,
    setup: {
      settings: { chartMode: "free", simulatorSpeed: 1 },
      // MapLibre uses [lng, lat]. Seed at the target so a startup restyle that
      // snaps the camera back still lands on this chart detail.
      mapPosition: { center: [-70.938767, 42.338494], zoom: 12.6 },
      zoom: 12.6,
    },
    async drive({ app }) {
      await app.flyTo({
        center: [-70.938767, 42.338494],
        zoom: 14.1,
        durationMs: 4500,
        holdMs: 2900, // dwell on the resolved chart detail, camera pinned
      });
    },
  },
  {
    id: "routes",
    caption: "Create and follow routes and waypoints",
    duration: 4.5,
    // Near-still teaching shot — the boat is held off the route on a fixed
    // heading (dev-only linear sim mode), so it settles instantly. The window
    // sits after the mid-drive reload + jumpTo has re-framed; verify frames.
    in: 9.5,
    setup: {
      settings: { chartMode: "free", simulatorSpeed: 1 },
      // Held off the route line, NW of WP2, on a course that steers wide of the
      // mark. With a divergent heading the three lines separate: the route
      // (WP1→WP2→…), the dashed bearing-to-next-WP, and the projected course line.
      simStart: [42.1, -70.42],
      simCog: 90,
      mapPosition: { center: [-70.33, 42.06], zoom: 11 },
      zoom: 11,
    },
    async drive({ page, app, wait, reload }) {
      // Seed the route (visible → route line) and mark leg 1 active (→ dashed
      // bearing line to WP2). The sim runs in linear mode (URL simMode=linear),
      // so it holds position/heading rather than snapping onto the route.
      await page.evaluate(async (wpts) => {
        const routeId = "promo-route";
        await new Promise<void>((resolve, reject) => {
          const req = indexedDB.open("pelorus-nav");
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction("routes", "readwrite");
            tx.objectStore("routes").put({
              id: routeId,
              name: "Scituate → Provincetown",
              createdAt: Date.now(),
              color: "#ff8800",
              visible: true,
              waypoints: wpts,
            });
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
        });
        localStorage.setItem(
          "pelorus-nav-active-nav",
          JSON.stringify({ type: "route", routeId, legIndex: 1 }),
        );
      }, ROUTE_WAYPOINTS);
      await reload();
      await app.waitForMapReady();
      await app.jumpTo({ center: [-70.33, 42.06], zoom: 11 });
      await wait(9000); // hold the near-still shot (lines settle near-instantly)
    },
  },
  {
    id: "track-record",
    caption: "Record and review your tracks",
    duration: 13,
    // Clip timeline: boot + IndexedDB seed + reload + preroll, then the map
    // settles on the full harbor sail. `in` starts just before the cursor
    // glides to the TRK button; TRK click, viewer open, then a single
    // continuous scrub sweep. Verify against decoded frames after any change.
    in: 6.5,
    setup: {
      // Free camera framed on the sail; the sim vessel starts well off-frame
      // (SE of the harbor) so its icon and course line stay out of the review.
      settings: { chartMode: "free", simulatorSpeed: 1 },
      simStart: [42.15, -70.6],
      mapPosition: { center: [-70.968, 42.358], zoom: 12.2 },
      zoom: 12.2,
    },
    async drive({ page, app, wait, click, drag, reload, resetCursor }) {
      // Seed the harbor sail (meta + points), then reload so the boot-time
      // TrackLayer renders the saved track line.
      await page.evaluate(async ({ meta, points }) => {
        await new Promise<void>((resolve, reject) => {
          const req = indexedDB.open("pelorus-nav");
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction(["tracks", "trackPoints"], "readwrite");
            tx.objectStore("tracks").put(meta);
            const store = tx.objectStore("trackPoints");
            for (const p of points) store.add(p);
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
        });
      }, HARBOR_SAIL);
      await reload();
      resetCursor(); // the reload re-centered the injected cursor overlay
      await app.waitForMapReady();
      // Re-center on the whole sail (the reload restored the map, but make
      // the framing explicit so the track sits centered before review).
      await app.jumpTo({ center: [-70.968, 42.358], zoom: 12.2 });
      await wait(2000); // chart + saved-track line settle (pre-trim)

      // Open the Tracks panel, then the viewer for the seeded sail.
      await click('button[aria-label="Tracks"]');
      await wait(450);
      await click(
        `.manager-item[data-track-id="${HARBOR_SAIL_ID}"] button[title="View track"]`,
      );
      await wait(1100); // viewer opens, fit-to-track animation lands

      // The money shot: one continuous scrub so the boat cursor sails the whole
      // track. (drag runs ~1.5x its nominal ms — per-step evaluate overhead.)
      await drag(".track-viewer-slider", 0.02, 0.98, 3600);
      await wait(900);
    },
  },
  {
    id: "tides-wind",
    caption: "See current and predicted tides and wind",
    duration: 13,
    in: 6.5,
    setup: {
      settings: {
        chartMode: "free",
        simulatorSpeed: 1,
        layerGroups: { lightSectors: true, tidesCurrents: true, wind: true },
      },
      // MapLibre uses [lng, lat].
      mapPosition: { center: [-70.98, 42.34], zoom: 12.5 },
      zoom: 12.5,
    },
    // PiP magnifier: enlarge the Deer Island tide station so its live predicted
    // height reads while the whole overview stays in shot.
    effects: [
      {
        kind: "pip",
        cropX: 1058,
        cropY: 310,
        crop: 290,
        scale: 1.55,
        label: "Tide station",
      },
    ],
    async drive({ wait, click, drag }) {
      await wait(4500); // let the overlay + Open-Meteo wind barbs populate
      // Open the time bar, then drag the slider so predictions animate forward.
      await click('button[aria-label="Time forecast"]');
      await wait(700);
      // Slow scrub forward then partway back so predictions animate gently.
      await drag(".time-bar-slider", 0.03, 0.72, 4200);
      await wait(800);
      await drag(".time-bar-slider", 0.72, 0.28, 3000);
      await wait(900);
    },
  },
  {
    id: "cob",
    caption: "Press COB to track crew overboard",
    duration: 9,
    in: 5,
    setup: { settings: { simulatorSpeed: 3 }, zoom: 14 },
    async drive({ wait, hold }) {
      await wait(1400); // beat on the chart before the gesture
      // Cursor glides to the COB button and presses (ring fills over 1.5 s).
      await hold(".cob-btn", 1900);
      await wait(5500); // mark drops, alarm banner shows — dwell so it registers
    },
  },
  {
    id: "settings",
    caption: "Customize it to your liking",
    duration: 5,
    in: 4.7,
    setup: { settings: { simulatorSpeed: 2 }, zoom: 13 },
    // Settings has no cursor; push in toward the options panel (right side of
    // frame) so the settings read large, per the storyboard.
    effects: [{ kind: "punch", zoom: 1.34, cx: 0.86, cy: 0.5 }],
    async drive({ page, wait }) {
      await page.getByRole("button", { name: "Settings" }).click();
      await wait(700);
      // Slow scroll through the options to convey breadth.
      for (let i = 0; i < 10; i++) {
        await page.evaluate(() => {
          document.querySelector(".settings-panel")?.scrollBy({ top: 130 });
        });
        await wait(280);
      }
      await wait(1800); // dwell on the options a beat longer
    },
  },
];

/** The complete Pelorus Nav promo, ready for the tutorial engine. */
export const PROMO: Storyboard<PelorusSetup, PelorusApp> = {
  scenes,
  theme: { font: FONT, accent: "#4ea3ff", panel: "rgba(8,15,28,0.60)" },
  intro: { image: TITLE, sec: 2.6 },
  outro: { image: OUTRO, sec: 3.2 },
  transition: { kind: "dissolve", sec: 0.5 },
  music: {
    path: MUSIC,
    startSec: 13.5,
    gainDb: -10,
    fadeInSec: 1.5,
    fadeOutSec: 3.5,
  },
};
