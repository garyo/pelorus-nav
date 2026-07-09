import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { PNG } from "pngjs";
import { suppressWhatsNew } from "./helpers";

/**
 * BYO chart import: a raster PMTiles the catalog doesn't know is imported via
 * Chart Regions → "Load from File…", derived from its header into a chart
 * entry, rendered on the map, and removable again.
 *
 * The fixture (see fixtures/make-import-fixture.py) is four magenta z10
 * tiles in the mid-Pacific, converted from mbtiles with `pmtiles convert` —
 * the same path a user-converted satellite chart takes — and deliberately
 * outside every catalog chart so nothing else can satisfy the assertions.
 */

const ARCHIVE = new URL("./fixtures/import-fixture.pmtiles", import.meta.url);
const SOURCE_ID = "rnc-import-e2e-test";
// Center of the fixture's bounds (mid-Pacific, no catalog coverage)
const FIXTURE_CENTER = { lng: -149.77, lat: -30.14 };

declare global {
  interface Window {
    __map: {
      getStyle(): { sources: Record<string, unknown> };
      getLayer(id: string): unknown;
      getCenter(): { lng: number; lat: number };
      getZoom(): number;
      once(ev: string, cb: () => void): void;
      project(lngLat: [number, number]): { x: number; y: number };
    };
  }
}

test("imported raster PMTiles becomes a rendered chart and can be removed", async ({
  page,
}) => {
  await suppressWhatsNew(page);
  await page.goto("/");
  await expect(page.locator(".maplibregl-map")).toBeVisible({ timeout: 10000 });

  // Import via the panel's hidden file input (the "Load from File…" flow).
  await page.getByRole("button", { name: "Chart Regions" }).click();
  await page.locator("input.chart-cache-file-input").setInputFiles({
    name: "e2e-test.pmtiles",
    mimeType: "application/octet-stream",
    buffer: readFileSync(ARCHIVE),
  });

  // The panel lists it as a first-class raster row, named from its metadata.
  const row = page.locator(".manager-item", { hasText: "Imported" });
  await expect(row).toBeVisible({ timeout: 15000 });
  await expect(row).toContainText("E2E Import Fixture");

  // The map style gains its source and layer.
  await expect
    .poll(() =>
      page.evaluate((id) => id in window.__map.getStyle().sources, SOURCE_ID),
    )
    .toBe(true);
  expect(
    await page.evaluate(
      (id) => !!window.__map.getLayer(`${id}-layer`),
      SOURCE_ID,
    ),
  ).toBe(true);

  // "Show on chart" flies to the fixture's bounds, clamped to its minZoom
  // (z10) — a plain fitBounds would land just below it and draw nothing.
  await row.locator("button.manager-item-btn").first().click();
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const m = window.__map;
          const c = m.getCenter();
          return (
            Math.abs(c.lng - -149.77) < 0.1 &&
            Math.abs(c.lat - -30.14) < 0.1 &&
            m.getZoom() >= 10
          );
        }),
      { timeout: 15000 },
    )
    .toBe(true);

  // The chart-in-use readout picks it up (bbox containment + quilt logic).
  await expect(page.locator(".chart-in-use")).toContainText("IMPORT-E2E-TEST", {
    timeout: 15000,
  });

  // Painted-pixel proof: wait for idle, then sample the map at the fixture
  // center — the magenta tile must actually have been served and drawn.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        };
        window.__map.once("idle", finish);
        setTimeout(finish, 8000); // fallback: never hang the run
      }),
  );
  const px = await page.evaluate(
    ([lng, lat]) => {
      const p = window.__map.project([lng, lat]);
      return { x: Math.round(p.x), y: Math.round(p.y) };
    },
    [FIXTURE_CENTER.lng, FIXTURE_CENTER.lat] as [number, number],
  );
  const shot = PNG.sync.read(
    await page.screenshot({
      clip: { x: px.x - 2, y: px.y - 2, width: 4, height: 4 },
    }),
  );
  const [r, g, b] = [shot.data[0], shot.data[1], shot.data[2]];
  expect(r, `pixel at chart center was rgb(${r},${g},${b})`).toBeGreaterThan(
    180,
  );
  expect(b).toBeGreaterThan(180);
  expect(g).toBeLessThan(120);

  // Delete removes the row and the style entries.
  page.on("dialog", (d) => d.accept());
  await row.locator("button.manager-item-btn").last().click();
  await expect(row).toHaveCount(0, { timeout: 15000 });
  await expect
    .poll(() =>
      page.evaluate((id) => id in window.__map.getStyle().sources, SOURCE_ID),
    )
    .toBe(false);
});
