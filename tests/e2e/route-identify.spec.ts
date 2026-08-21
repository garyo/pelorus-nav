import { expect, test } from "@playwright/test";
import {
  acceptDisclaimer,
  seedRoute,
  suppressWhatsNew,
  waitForAppReady,
} from "./helpers";

const A: [number, number] = [42.363715, -71.04743]; // [lat, lon]
const B: [number, number] = [42.352039, -71.032698];

const ROUTE_ID = "e2e-route-identify";
const ROUTE_NAME = "E2E Identify Loop";

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

  // Seeding needs the "routes" object store — wait for the app-ready signal.
  await waitForAppReady(page);

  await seedRoute(page, {
    id: ROUTE_ID,
    name: ROUTE_NAME,
    createdAt: Date.now(),
    color: "#4488cc",
    visible: true,
    waypoints: [
      { lat: A[0], lon: A[1], name: "Inner Harbor" },
      { lat: B[0], lon: B[1], name: "Castle Island" },
    ],
  });

  // Reload so RouteLayer's style-load pass draws the seeded route.
  await page.reload();
  await expect(page.locator(".maplibregl-map")).toBeVisible({ timeout: 10000 });
  await waitForAppReady(page);

  // Center on the route's midpoint and wait for the map to settle so the
  // route line is rendered (hit-testable) at a known screen position.
  const mid: [number, number] = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
  await page.evaluate(async ([lat, lon]) => {
    await new Promise<void>((resolve) => {
      window.__map.once("idle", () => resolve());
      window.__map.jumpTo({ center: [lon, lat], zoom: 13 });
    });
  }, mid);

  // Project the midpoint (on the line, away from both waypoint markers)
  // to window coordinates and click it.
  const pt = await page.evaluate(([lat, lon]) => {
    const p = window.__map.project([lon, lat]);
    const rect = window.__map.getContainer().getBoundingClientRect();
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
