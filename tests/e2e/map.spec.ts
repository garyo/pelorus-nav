import { expect, test } from "@playwright/test";

test("map renders with MapLibre controls and top bar", async ({ page }) => {
  await page.goto("/");

  // MapLibre initializes
  const mapElement = page.locator(".maplibregl-map");
  await expect(mapElement).toBeVisible({ timeout: 10000 });

  // Canvas renders
  const canvas = page.locator("canvas.maplibregl-canvas");
  await expect(canvas).toBeVisible();

  // Navigation control group (top-right)
  const navControl = page.locator(
    ".maplibregl-ctrl-top-right .maplibregl-ctrl-group",
  );
  await expect(navControl).toBeVisible();

  // Scale control (nautical)
  const scaleControl = page.locator(".maplibregl-ctrl-scale");
  await expect(scaleControl).toBeVisible();

  // App top bar is present
  await expect(page.locator("#topbar-menu")).toBeAttached();
});

test("chart source select in settings switches providers", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".maplibregl-map")).toBeVisible({
    timeout: 10000,
  });

  // Open the settings panel (gear in the top bar menu) and the Layers tab,
  // where the chart-source select lives.
  await page.locator(".settings-wrapper button").first().click();
  await page.getByRole("button", { name: "Layers" }).click();

  const select = page.locator("#settings-chart-source");
  await expect(select).toBeVisible();

  // All four chart providers are offered
  const options = select.locator("option");
  await expect(options).toHaveCount(4);

  // Vector charts are the default provider
  await expect(select).toHaveValue("s57-vector");

  // Switching to OSM takes effect
  await select.selectOption("osm");
  await expect(select).toHaveValue("osm");
});

test("page has correct title", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Pelorus Nav");
});
