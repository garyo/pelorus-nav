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

interface MapProbeWindow {
  __map: {
    jumpTo(opts: { center: [number, number]; zoom: number }): void;
    project(lngLat: [number, number]): { x: number; y: number };
    getContainer(): HTMLElement;
    once(event: string, cb: () => void): void;
  };
}

const A: [number, number] = [42.363715, -71.04743]; // [lat, lon]
const B: [number, number] = [42.352039, -71.032698];

const ROUTE_ID = "e2e-route-identify";
const ROUTE_NAME = "E2E Identify Loop";

function seedRoute(): SeedRoute {
  return {
    id: ROUTE_ID,
    name: ROUTE_NAME,
    createdAt: Date.now(),
    color: "#4488cc",
    visible: true,
    waypoints: [
      { lat: A[0], lon: A[1], name: "Inner Harbor" },
      { lat: B[0], lon: B[1], name: "Castle Island" },
    ],
  };
}

/**
 * Tap-to-identify: click a visible route's line on the chart, expect the
 * feature-info card naming the route, then use its "Open in Routes panel"
 * action and expect the route manager open with that row selected.
 */
test("tapping a route line identifies it and opens the Routes panel selected", async ({
  page,
}) => {
  await suppressWhatsNew(page);
  await acceptDisclaimer(page);

  await page.goto("/");
  await expect(page.locator(".maplibregl-map")).toBeVisible({ timeout: 10000 });

  // The Routes button only exists once boot-time restore (which touches
  // IndexedDB) has completed, so the "routes" object store is guaranteed
  // to exist by the time it's clickable.
  await expect(page.getByRole("button", { name: "Routes" })).toBeVisible({
    timeout: 10000,
  });

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

  // Reload so RouteLayer's style-load pass draws the seeded route.
  await page.reload();
  await expect(page.locator(".maplibregl-map")).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole("button", { name: "Routes" })).toBeVisible({
    timeout: 10000,
  });

  // Center on the route's midpoint and wait for the map to settle so the
  // route line is rendered (hit-testable) at a known screen position.
  const mid: [number, number] = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
  await page.evaluate(async ([lat, lon]) => {
    const map = (window as unknown as MapProbeWindow).__map;
    await new Promise<void>((resolve) => {
      map.once("idle", () => resolve());
      map.jumpTo({ center: [lon, lat], zoom: 13 });
    });
  }, mid);

  // Project the midpoint (on the line, away from both waypoint markers)
  // to window coordinates and click it.
  const pt = await page.evaluate(([lat, lon]) => {
    const map = (window as unknown as MapProbeWindow).__map;
    const p = map.project([lon, lat]);
    const rect = map.getContainer().getBoundingClientRect();
    return { x: rect.left + p.x, y: rect.top + p.y };
  }, mid);
  await page.mouse.click(pt.x, pt.y);

  const infoPanel = page.locator(".feature-info-panel");
  await expect(infoPanel).toHaveClass(/visible/, { timeout: 5000 });
  await expect(infoPanel.locator(".feature-info-title")).toHaveText(
    `Route: ${ROUTE_NAME}`,
  );

  await infoPanel.getByRole("button", { name: "Open in Routes panel" }).click();

  await expect(page.locator(".manager-panel.route-manager-panel")).toHaveClass(
    /open/,
  );
  const row = page.locator(`.manager-item[data-route-id="${ROUTE_ID}"]`);
  await expect(row).toBeVisible({ timeout: 5000 });
  await expect(row).toHaveClass(/selected/);
});
