import { expect, test } from "@playwright/test";
import { acceptDisclaimer, suppressWhatsNew } from "./helpers";

interface TrackMetaProbe {
  id: string;
  name: string;
  createdAt: number;
  pointCount: number;
  totalDistanceNM?: number;
  durationMs?: number;
}

const START: [number, number] = [42.363559, -71.047973]; // inner harbor

/**
 * Track record -> stop: with the simulator moving, enable recording, let
 * it run long enough to clear the recorder's trivial-track thresholds
 * (>=3 points, >5s, >10m — see isTrivialTrack in src/data/Track.ts), stop,
 * and verify the track survived into the Tracks panel with a plausible
 * nonzero distance, cross-checked directly against IndexedDB.
 */
test("recording a track while the simulator moves produces a saved track with distance", async ({
  page,
}) => {
  await suppressWhatsNew(page);
  await acceptDisclaimer(page);
  await page.addInitScript(() => {
    const raw = localStorage.getItem("pelorus-nav-settings");
    const settings = raw ? JSON.parse(raw) : {};
    Object.assign(settings, {
      gpsSource: "simulator",
      simulatorSpeed: 50,
    });
    localStorage.setItem("pelorus-nav-settings", JSON.stringify(settings));
  });

  await page.goto(`/?simStart=${START[0]},${START[1]}`);
  await expect(page.locator(".maplibregl-map")).toBeVisible({
    timeout: 10000,
  });

  const recordBtn = page.getByRole("button", { name: "Record track" });
  await recordBtn.click();
  await expect(
    page.getByRole("button", { name: "Stop recording" }),
  ).toBeVisible({ timeout: 5000 });

  // Let the simulator (1 fix/sec, 50x speed => ~0.08 nm/fix) run long
  // enough to clear the trivial-track thresholds with margin.
  await page.waitForTimeout(9000);

  await page.getByRole("button", { name: "Stop recording" }).click();
  await expect(page.getByRole("button", { name: "Record track" })).toBeVisible({
    timeout: 5000,
  });

  const tracksBtn = page.getByRole("button", { name: "Tracks" });
  await tracksBtn.click();

  const row = page.locator(".manager-item").first();
  await expect(row).toBeVisible({ timeout: 5000 });
  await expect(row.locator(".manager-item-detail")).toContainText("nm");

  const metas = await page.evaluate(
    () =>
      new Promise<TrackMetaProbe[]>((resolve, reject) => {
        const req = indexedDB.open("pelorus-nav");
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction("tracks", "readonly");
          const getAll = tx.objectStore("tracks").getAll();
          getAll.onsuccess = () => {
            db.close();
            resolve(getAll.result as TrackMetaProbe[]);
          };
          getAll.onerror = () => reject(getAll.error);
        };
      }),
  );

  expect(metas.length).toBeGreaterThan(0);
  const latest = metas.reduce((a, b) => (a.createdAt > b.createdAt ? a : b));
  expect(latest.pointCount).toBeGreaterThanOrEqual(3);
  expect(latest.totalDistanceNM ?? 0).toBeGreaterThan(0);
});
