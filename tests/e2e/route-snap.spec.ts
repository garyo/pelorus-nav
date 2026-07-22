import { expect, test } from "@playwright/test";
import { acceptDisclaimer, suppressWhatsNew } from "./helpers";

/** Matches src/data/Route.ts. */
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

const ROUTE_ID = "e2e-snap-seed";

// Boston Harbor, well separated on screen at z13.
const SEED_WPS: RouteWaypoint[] = [
  { lat: 42.33, lon: -71.02, name: "Harbor Exit" },
  { lat: 42.31, lon: -70.98, name: "Channel Mark" },
];

function seedRoute(): SeedRoute {
  return {
    id: ROUTE_ID,
    name: "Seed Route",
    createdAt: Date.now(),
    color: "#cc4444",
    visible: true,
    waypoints: SEED_WPS,
  };
}

declare global {
  interface Window {
    __map: {
      project(c: [number, number]): { x: number; y: number };
      jumpTo(opts: { center: [number, number]; zoom: number }): void;
    };
  }
}

test("new-route waypoints snap onto a visible route's waypoints", async ({
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
    seedRoute(),
  );
  // The route was seeded behind RouteLayer's back — reload so boot-time
  // reloadAll() picks it up as a snap-candidate source.
  await page.reload();
  await expect(page.locator(".maplibregl-map")).toBeVisible({ timeout: 10000 });
  await routesBtn.click();
  await expect(
    page.locator(`.manager-item[data-route-id="${ROUTE_ID}"]`),
  ).toBeVisible({ timeout: 5000 });

  await page.evaluate(
    (center) => {
      window.__map.jumpTo({ center, zoom: 13 });
    },
    [-71.0, 42.32] as [number, number],
  );

  // Start a new route; the panel's New button enters edit mode.
  await page.locator("#route-new-btn").click();
  await expect(page.locator(".route-editor-bar")).toBeVisible();

  const target = SEED_WPS[0];
  const canvas = page.locator(".maplibregl-map canvas").first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no map canvas");

  // Click ~10 px off the seeded waypoint — inside the snap radius.
  const near = await page.evaluate((c) => window.__map.project(c), [
    target.lon,
    target.lat,
  ] as [number, number]);
  await page.mouse.click(box.x + near.x + 8, box.y + near.y + 6);

  // Second click far from everything — must not snap.
  await page.mouse.click(box.x + near.x + 200, box.y + near.y + 120);

  await page.getByRole("button", { name: "Done" }).click();

  const routes = await page.evaluate(
    () =>
      new Promise<SeedRoute[]>((resolve, reject) => {
        const req = indexedDB.open("pelorus-nav");
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction("routes", "readonly");
          const getAll = tx.objectStore("routes").getAll();
          getAll.onsuccess = () => {
            db.close();
            resolve(getAll.result as SeedRoute[]);
          };
          getAll.onerror = () => reject(getAll.error);
        };
      }),
  );

  const created = routes.find((r) => r.id !== ROUTE_ID);
  expect(created).toBeTruthy();
  if (!created) return;
  expect(created.waypoints).toHaveLength(2);
  // Snapped: exact coordinates and inherited name.
  expect(created.waypoints[0].lat).toBe(target.lat);
  expect(created.waypoints[0].lon).toBe(target.lon);
  expect(created.waypoints[0].name).toBe(target.name);
  // Unsnapped: nowhere near any seed waypoint.
  const free = created.waypoints[1];
  for (const wp of SEED_WPS) {
    expect(free.lat).not.toBe(wp.lat);
    expect(free.lon).not.toBe(wp.lon);
  }
});
