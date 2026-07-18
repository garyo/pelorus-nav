import { expect, test } from "@playwright/test";
import { acceptDisclaimer, suppressWhatsNew } from "./helpers";

/**
 * Track viewer maneuver markers: seed a zigzag track (90° turns, well
 * over the 60° maneuver threshold at 5 kn), open it in the viewer, and
 * verify the maneuver layer renders and the toolbar toggle hides/shows
 * it, persisting the choice to settings.
 */

const LYR_MANEUVERS = "_track-viewer-maneuvers";
const SRC_MANEUVERS = "_track-viewer-maneuvers-src";

interface MapProbeWindow {
  __map: {
    getLayer(id: string): unknown;
    getLayoutProperty(layer: string, prop: string): string | undefined;
    querySourceFeatures(src: string): unknown[];
  };
}

test("maneuver markers render in the track viewer and the toggle hides them", async ({
  page,
}) => {
  await suppressWhatsNew(page);
  await acceptDisclaimer(page);
  await page.goto("/");
  await expect(page.locator(".maplibregl-map")).toBeVisible({ timeout: 10000 });

  // Zigzag: 8 one-minute legs at 5 kn alternating 045°/135°, a fix every
  // 10 s. Each corner is a 90° turn — comfortably a detected maneuver.
  await page.evaluate(() => {
    const base = Date.UTC(2026, 0, 1, 12, 0, 0);
    const stepMs = 10_000;
    const legPoints = 6;
    const legs = 8;
    const spd = 5; // kn
    const nmPerFix = (spd * stepMs) / 3_600_000;
    const dLat = nmPerFix / 60 / Math.SQRT2;
    const dLon = dLat / Math.cos((42 * Math.PI) / 180);
    let lat = 42.0;
    let lon = -70.8;
    const points: {
      trackId: string;
      lat: number;
      lon: number;
      timestamp: number;
      sog: number;
      cog: number;
    }[] = [];
    for (let leg = 0; leg < legs; leg++) {
      const south = leg % 2 === 1; // 045 on even legs, 135 on odd
      for (let i = 0; i < legPoints; i++) {
        points.push({
          trackId: "e2e-zigzag",
          lat,
          lon,
          timestamp: base + points.length * stepMs,
          sog: spd,
          cog: south ? 135 : 45,
        });
        lat += south ? -dLat : dLat;
        lon += dLon;
      }
    }
    const meta = {
      id: "e2e-zigzag",
      name: "Zigzag",
      createdAt: base,
      color: "#ff4444",
      visible: false,
      pointCount: points.length,
      durationMs: (points.length - 1) * stepMs,
      totalDistanceNM: (points.length - 1) * nmPerFix,
    };
    return new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("pelorus-nav");
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(["tracks", "trackPoints"], "readwrite");
        tx.objectStore("tracks").put(meta);
        for (const p of points) tx.objectStore("trackPoints").add(p);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  });

  await page.getByRole("button", { name: "Tracks" }).click();
  const row = page.locator(".manager-item", { hasText: "Zigzag" });
  await expect(row).toBeVisible({ timeout: 5000 });
  await row.getByRole("button", { name: "View track" }).click();
  await expect(page.locator(".track-viewer-panel.open")).toBeVisible({
    timeout: 5000,
  });

  // Maneuver layer exists, is visible, and has features to draw
  const layerState = () =>
    page.evaluate(
      ([lyr]) => {
        const map = (window as unknown as MapProbeWindow).__map;
        return {
          exists: Boolean(map.getLayer(lyr)),
          visibility: map.getLayoutProperty(lyr, "visibility"),
        };
      },
      [LYR_MANEUVERS],
    );
  await expect
    .poll(async () => (await layerState()).exists, { timeout: 5000 })
    .toBe(true);
  expect((await layerState()).visibility).toBe("visible");
  await expect
    .poll(
      () =>
        page.evaluate(
          ([src]) =>
            (window as unknown as MapProbeWindow).__map.querySourceFeatures(src)
              .length,
          [SRC_MANEUVERS],
        ),
      { timeout: 5000 },
    )
    .toBeGreaterThan(0);

  // Toggle off: layer hidden, preference persisted
  const toggle = page.getByRole("button", { name: "Show maneuvers" });
  await toggle.click();
  expect((await layerState()).visibility).toBe("none");
  const stored = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("pelorus-nav-settings") ?? "{}")
        .trackShowManeuvers,
  );
  expect(stored).toBe(false);

  // Toggle back on
  await toggle.click();
  expect((await layerState()).visibility).toBe("visible");
});
