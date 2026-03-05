import { expect, test } from "@playwright/test";

test("map renders with NOAA charts and MapLibre controls", async ({ page }) => {
  await page.goto("/");

  // MapLibre initializes
  const mapElement = page.locator(".maplibregl-map");
  await expect(mapElement).toBeVisible({ timeout: 10000 });

  // Canvas renders
  const canvas = page.locator("canvas.maplibregl-canvas");
  await expect(canvas).toBeVisible();

  // Navigation control group (in top-right, not the chart switcher)
  const navControl = page.locator(
    ".maplibregl-ctrl-top-right .maplibregl-ctrl-group",
  );
  await expect(navControl).toBeVisible();

  // Scale control (nautical)
  const scaleControl = page.locator(".maplibregl-ctrl-scale");
  await expect(scaleControl).toBeVisible();

  // NOAA attribution is present
  const attribution = page.locator(".maplibregl-ctrl-attrib-inner");
  await expect(attribution).toContainText("NOAA");
});

test("chart source switcher is present and works", async ({ page }) => {
  await page.goto("/");

  // Wait for map to initialize
  await expect(page.locator(".maplibregl-map")).toBeVisible({
    timeout: 10000,
  });

  // Chart switcher dropdown exists
  const switcher = page.locator(".chart-switcher-select");
  await expect(switcher).toBeVisible();

  // Has NOAA, ECDIS, OSM, and Vector options
  const options = switcher.locator("option");
  await expect(options).toHaveCount(4);
  await expect(options.nth(0)).toHaveText("NOAA Nautical Charts");
  await expect(options.nth(1)).toHaveText("NOAA ECDIS Charts");
  await expect(options.nth(2)).toHaveText("OpenStreetMap");
  await expect(options.nth(3)).toHaveText("NOAA Vector Charts");

  // NOAA is initially selected
  await expect(switcher).toHaveValue("noaa-ncds");

  // Switch to OSM
  await switcher.selectOption("osm");
  await expect(switcher).toHaveValue("osm");

  // Attribution changes to OpenStreetMap
  const attribution = page.locator(".maplibregl-ctrl-attrib-inner");
  await expect(attribution).toContainText("OpenStreetMap");
});

test("page has correct title", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Pelorus Nav");
});
