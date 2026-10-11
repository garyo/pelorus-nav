/**
 * Renaming a waypoint from the route editor's bar: tapping the selected
 * waypoint's name opens an inline rename. It's the only rename while editing
 * on a phone, where the detail panel's waypoint list stays closed. The
 * rename joins the edit session — Undo reverts it, Done saves it.
 */

import { expect, test } from "@playwright/test";
import {
  acceptDisclaimer,
  type RouteWaypoint,
  readIndexedDb,
  type SeedRoute,
  seedRoute,
  suppressWhatsNew,
  waitForAppReady,
} from "./helpers";

const ROUTE_ID = "e2e-bar-rename-seed";

const SEED_WPS: RouteWaypoint[] = [
  { lat: 42.33, lon: -71.02, name: "Harbor Exit" },
  { lat: 42.31, lon: -70.98, name: "Channel Mark" },
];

test("the editor bar renames the selected waypoint", async ({ page }) => {
  await suppressWhatsNew(page);
  await acceptDisclaimer(page);
  await page.goto("/");
  await expect(page.locator(".maplibregl-map")).toBeVisible({ timeout: 10000 });

  await waitForAppReady(page);
  const routesBtn = page.getByRole("button", { name: "Routes" });
  await routesBtn.click();
  await seedRoute(page, {
    id: ROUTE_ID,
    name: "Seed Route",
    createdAt: Date.now(),
    color: "#cc4444",
    visible: true,
    waypoints: SEED_WPS,
  });
  await page.reload();
  await expect(page.locator(".maplibregl-map")).toBeVisible({ timeout: 10000 });

  await routesBtn.click();
  await page
    .locator(`.manager-item[data-route-id="${ROUTE_ID}"] .manager-item-name`)
    .click();
  await page.locator(".route-detail-edit").click();
  await expect(page.locator(".route-editor-bar")).toBeVisible();

  // Select the second waypoint; the bar shows its name.
  await page.locator(".route-list-wp.selectable").nth(1).click();
  const barName = page.locator(".route-editor-bar .route-wp-name");
  await expect(barName).toHaveText("Channel Mark");

  // Tap the name, type a new one, Enter.
  await barName.click();
  const input = page.locator(".route-editor-bar input");
  await expect(input).toBeFocused();
  await input.fill("Outer Mark");
  await input.press("Enter");
  await expect(barName).toHaveText("Outer Mark");

  // Undo reverts the rename; a second rename sticks through Done.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(barName).toHaveText("Channel Mark");
  await barName.click();
  await input.fill("Outer Mark");
  await input.press("Enter");

  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.locator(".route-editor-bar")).toBeHidden();
  const saved = (await readIndexedDb<SeedRoute>(page, "routes")).find(
    (r) => r.id === ROUTE_ID,
  );
  expect(saved?.waypoints.map((w) => w.name)).toEqual([
    "Harbor Exit",
    "Outer Mark",
  ]);
});
