import { expect, test } from "@playwright/test";

test("map renders with MapLibre controls", async ({ page }) => {
  await page.goto("/");

  // Map container exists
  const mapContainer = page.locator("#map");
  await expect(mapContainer).toBeVisible();

  // MapLibre initializes (adds class to container)
  const mapElement = page.locator(".maplibregl-map");
  await expect(mapElement).toBeVisible({ timeout: 10000 });

  // Canvas renders
  const canvas = page.locator("canvas.maplibregl-canvas");
  await expect(canvas).toBeVisible();

  // Navigation control group is present
  const navControl = page.locator(".maplibregl-ctrl-group");
  await expect(navControl).toBeVisible();

  // Scale control is present (nautical miles)
  const scaleControl = page.locator(".maplibregl-ctrl-scale");
  await expect(scaleControl).toBeVisible();
});

test("page has correct title", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Pelorus Nav");
});
