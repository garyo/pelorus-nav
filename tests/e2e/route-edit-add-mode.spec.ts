/**
 * Editing a saved route must not turn stray chart taps into waypoints —
 * the failure an iPad tester hit repeatedly, where every tap that missed a
 * handle hung a new point off the end of the route. Adding is opt-in via the
 * editor bar's Add Points toggle.
 */

import { expect, test } from "@playwright/test";
import { acceptDisclaimer, suppressWhatsNew } from "./helpers";

interface RouteWaypoint {
  lat: number;
  lon: number;
  name: string;
}

interface SeedRoute {
  id: string;
  name: string;
  createdAt: number;
  color: string;
  visible: boolean;
  waypoints: RouteWaypoint[];
}

const ROUTE_ID = "e2e-add-mode-seed";

// Boston Harbor, well separated on screen at z13.
const SEED_WPS: RouteWaypoint[] = [
  { lat: 42.33, lon: -71.02, name: "Harbor Exit" },
  { lat: 42.31, lon: -70.98, name: "Channel Mark" },
];

declare global {
  interface Window {
    __map: {
      project(c: [number, number]): { x: number; y: number };
      jumpTo(opts: { center: [number, number]; zoom: number }): void;
      getSource(id: string): {
        serialize(): { data: GeoJSON.FeatureCollection };
      };
    };
  }
}

function readRoute(): Promise<SeedRoute | undefined> {
  return new Promise<SeedRoute | undefined>((resolve, reject) => {
    const req = indexedDB.open("pelorus-nav");
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction("routes", "readonly");
      const getAll = tx.objectStore("routes").getAll();
      getAll.onsuccess = () => {
        db.close();
        resolve(
          (getAll.result as SeedRoute[]).find(
            (r) => r.id === "e2e-add-mode-seed",
          ),
        ); // ROUTE_ID — evaluate() can't close over module scope
      };
      getAll.onerror = () => reject(getAll.error);
    };
  });
}

test("editing a saved route ignores chart taps until Add Points is on", async ({
  page,
}) => {
  await suppressWhatsNew(page);
  await acceptDisclaimer(page);
  await page.goto("/");
  await expect(page.locator(".maplibregl-map")).toBeVisible({ timeout: 10000 });

  // Seeding needs the "routes" store; it exists once the Routes button does.
  const routesBtn = page.getByRole("button", { name: "Routes" });
  await routesBtn.click();
  await page.evaluate(
    (route) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open("pelorus-nav");
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction("routes", "readwrite");
          tx.objectStore("routes").put(route);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    {
      id: ROUTE_ID,
      name: "Seed Route",
      createdAt: Date.now(),
      color: "#cc4444",
      visible: true,
      waypoints: SEED_WPS,
    } satisfies SeedRoute,
  );
  await page.reload();
  await expect(page.locator(".maplibregl-map")).toBeVisible({ timeout: 10000 });

  // Open the seeded route's detail panel, then its editor.
  await routesBtn.click();
  await page
    .locator(`.manager-item[data-route-id="${ROUTE_ID}"] .manager-item-name`)
    .click();
  await page.locator(".route-detail-edit").click();
  await expect(page.locator(".route-editor-bar")).toBeVisible();

  // Editing frames the route; pin the camera so the click targets are known.
  await page.evaluate(
    (center) => {
      window.__map.jumpTo({ center, zoom: 13 });
    },
    [-71.0, 42.32] as [number, number],
  );

  const canvas = page.locator(".maplibregl-map canvas").first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no map canvas");

  // Open water: the first candidate that is clear of every edit handle and
  // has nothing layered over it. Hard-coding a spot is brittle — the panels
  // and map controls move with the viewport, and a click they swallow would
  // pass the "nothing happened" half of this test for the wrong reason.
  const spot = await page.evaluate(
    ({ clearance }) => {
      // Read the live handles rather than recomputing them, so this stays
      // correct as the editor gains or moves handles.
      const handles = ["_route-edit-points", "_route-edit-midpoints"].flatMap(
        (id) =>
          window.__map
            .getSource(id)
            .serialize()
            .data.features.map((f) =>
              window.__map.project(
                (f.geometry as GeoJSON.Point).coordinates as [number, number],
              ),
            ),
      );
      const canvasEl = document.querySelector(
        ".maplibregl-map canvas",
      ) as HTMLCanvasElement;
      const rect = canvasEl.getBoundingClientRect();
      for (const [fx, fy] of [
        [0.25, 0.3],
        [0.75, 0.75],
        [0.25, 0.7],
        [0.5, 0.3],
      ]) {
        const x = rect.width * fx;
        const y = rect.height * fy;
        const clear = handles.every(
          (h) => Math.hypot(h.x - x, h.y - y) > clearance,
        );
        if (!clear) continue;
        if (document.elementFromPoint(rect.left + x, rect.top + y) !== canvasEl)
          continue;
        return { x, y };
      }
      return null;
    },
    { clearance: 80 },
  );
  if (!spot) throw new Error("no clear water on screen to click");
  const emptyX = box.x + spot.x;
  const emptyY = box.y + spot.y;

  // A saved route opens inert: the toggle is dark and the tap does nothing.
  const addBtn = page.getByRole("button", { name: "Add Points" });
  const barText = page.locator(".route-editor-text");
  await expect(addBtn).toBeVisible();
  await expect(addBtn).not.toHaveClass(/route-editor-btn--active/);
  await expect(barText).toContainText("2 WPs");

  await page.mouse.click(emptyX, emptyY);
  await expect(barText).toContainText("2 WPs");

  // Switched on, the same tap places a waypoint.
  await addBtn.click();
  await expect(addBtn).toHaveClass(/route-editor-btn--active/);
  await page.mouse.click(emptyX, emptyY);
  await expect(barText).toContainText("3 WPs");

  await page.getByRole("button", { name: "Done" }).click();
  expect((await page.evaluate(readRoute))?.waypoints).toHaveLength(3);
});
