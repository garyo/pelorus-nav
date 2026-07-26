import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { acceptDisclaimer } from "./helpers";

test.beforeEach(async ({ page }) => {
  await acceptDisclaimer(page);
});

const BANNER = '.status-banner[data-banner-id="chart-load"]';
const CHART_GLOBS = ["**/*.pmtiles*", "**/*.coverage.geojson*"];

// A real (tiny, mid-Pacific) PMTiles archive. Served for every chart URL it
// makes sources load successfully — and since its bounds are nowhere near the
// test viewport, no actual tile data is ever requested. This keeps the tests
// independent of which chart artifacts exist on disk: the CI checkout has
// none (they're gitignored, served from R2 in production), so an un-routed
// request 404s there while succeeding on a dev machine.
const FIXTURE = readFileSync(
  new URL("./fixtures/import-fixture.pmtiles", import.meta.url),
);

/** Answer chart requests from the fixture (range-aware) — "server healthy". */
async function serveChartStubs(page: Page): Promise<void> {
  await page.route("**/*.pmtiles*", (route) => {
    const range = route.request().headers().range;
    const m = range?.match(/bytes=(\d+)-(\d+)?/);
    const start = m ? Number(m[1]) : 0;
    const end = m?.[2]
      ? Math.min(Number(m[2]), FIXTURE.length - 1)
      : FIXTURE.length - 1;
    const body = FIXTURE.subarray(start, end + 1);
    return route.fulfill({
      status: m ? 206 : 200,
      headers: {
        "accept-ranges": "bytes",
        "content-range": `bytes ${start}-${end}/${FIXTURE.length}`,
        "content-length": String(body.length),
        "content-type": "application/octet-stream",
      },
      body,
    });
  });
  await page.route("**/*.coverage.geojson*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ type: "FeatureCollection", features: [] }),
    }),
  );
}

/** Fail every chart request at the network level — "server unreachable". */
async function abortChartRequests(page: Page): Promise<void> {
  for (const glob of CHART_GLOBS) {
    await page.route(glob, (route) => route.abort("failed"));
  }
}

async function unrouteChartRequests(page: Page): Promise<void> {
  for (const glob of CHART_GLOBS) {
    await page.unroute(glob);
  }
}

test("chart load failure shows a banner; Retry clears it once loads succeed", async ({
  page,
}) => {
  // Dead network for charts (browser still "online" → the threshold +
  // grace-period path, not the navigator.onLine shortcut).
  await abortChartRequests(page);

  await page.goto("/");
  await expect(page.locator(".maplibregl-map")).toBeVisible({ timeout: 10000 });

  const banner = page.locator(BANNER);
  await expect(banner).toBeVisible({ timeout: 15000 });
  await expect(banner).toContainText("Can't load charts");
  await expect(banner).toContainText("network problem");

  // The pill carries a persistent red warning while tiles are failing.
  const pill = page.locator(".chart-in-use");
  await expect(pill).toContainText("TILE LOAD ERROR");

  // Dismissing hides the banner but not the warning; tapping the warning
  // brings the banner back.
  await banner.getByRole("button", { name: "Dismiss" }).click();
  await expect(banner).toBeHidden();
  await expect(pill).toContainText("TILE LOAD ERROR");
  await pill.getByText("TILE LOAD ERROR").click();
  await expect(banner).toBeVisible();

  // Server comes back; Retry rebuilds the sources and everything clears
  // itself once the sources actually load.
  await unrouteChartRequests(page);
  await serveChartStubs(page);
  await banner.getByRole("button", { name: "Retry" }).click();
  await expect(banner).toBeHidden({ timeout: 15000 });
  await expect(pill).not.toContainText("TILE LOAD ERROR");
});

test("offline failure names the cause and offers no Retry", async ({
  page,
  context,
}) => {
  // Healthy server for the initial load, regardless of what's on disk.
  await serveChartStubs(page);
  await page.goto("/");
  await expect(page.locator(".maplibregl-map")).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(2000);

  // Go "offline": fulfilled routes bypass Playwright's network emulation,
  // so swap them for aborts; setOffline drives navigator.onLine for the
  // classification. Then move the map so fresh tiles are requested and fail.
  await unrouteChartRequests(page);
  await abortChartRequests(page);
  await context.setOffline(true);
  await page.evaluate(() => {
    const m = (
      window as unknown as {
        __map: {
          getCenter(): { lng: number; lat: number };
          getZoom(): number;
          jumpTo(o: { center: [number, number]; zoom: number }): void;
        };
      }
    ).__map;
    const c = m.getCenter();
    m.jumpTo({ center: [c.lng + 0.05, c.lat + 0.03], zoom: m.getZoom() + 1 });
  });

  const banner = page.locator(BANNER);
  await expect(banner).toBeVisible({ timeout: 15000 });
  await expect(banner).toContainText("no internet connection");
  // No downloaded regions in a fresh profile → no false reassurance,
  // and Retry can't help while offline (reconnecting auto-refreshes).
  await expect(banner).not.toContainText("Downloaded regions");
  await expect(banner.getByRole("button", { name: "Retry" })).toHaveCount(0);

  // Reconnecting (healthy server again) refreshes the failed sources and
  // the banner clears itself.
  await unrouteChartRequests(page);
  await serveChartStubs(page);
  await context.setOffline(false);
  await expect(banner).toBeHidden({ timeout: 20000 });
});
