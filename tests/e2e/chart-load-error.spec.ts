import { expect, test } from "@playwright/test";
import { acceptDisclaimer } from "./helpers";

test.beforeEach(async ({ page }) => {
  await acceptDisclaimer(page);
});

const BANNER = '.status-banner[data-banner-id="chart-load"]';

test("chart load failure shows a banner; Retry clears it once loads succeed", async ({
  page,
}) => {
  // Simulate a dead chart server: every PMTiles request fails at the network
  // level (the browser is still "online", so this exercises the threshold +
  // grace-period path, not the navigator.onLine shortcut).
  await page.route("**/*.pmtiles*", (route) => route.abort("failed"));

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
  // itself once chart tiles actually arrive.
  await page.unroute("**/*.pmtiles*");
  await banner.getByRole("button", { name: "Retry" }).click();
  await expect(banner).toBeHidden({ timeout: 15000 });
  await expect(pill).not.toContainText("TILE LOAD ERROR");
});

test("offline failure names the cause and offers no Retry", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await expect(page.locator(".maplibregl-map")).toBeVisible({ timeout: 10000 });
  // Let the initial tiles settle, then cut the network and move the map so
  // fresh (uncached) tiles are requested and fail.
  await page.waitForTimeout(2000);
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

  // Reconnecting refreshes the failed sources and the banner clears itself.
  await context.setOffline(false);
  await expect(banner).toBeHidden({ timeout: 20000 });
});
