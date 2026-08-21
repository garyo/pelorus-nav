import { expect, test } from "@playwright/test";
import {
  acceptDisclaimer,
  seedMapPosition,
  seedSettings,
  suppressWhatsNew,
} from "./helpers";

/**
 * Tides & currents overlay: enable the layer via settings, start over
 * Boston Harbor, verify station features render, and click a station to
 * get the upcoming-events popup.
 */
test("tides & currents overlay renders stations and shows event popup", async ({
  page,
}) => {
  // Seed settings + map position before the app boots
  await suppressWhatsNew(page);
  await acceptDisclaimer(page);
  await seedSettings(page, { layerGroups: { tidesCurrents: true } });
  await seedMapPosition(page, [-70.97, 42.34], 12);
  await page.goto("/");
  await expect(page.locator(".maplibregl-map")).toBeVisible({
    timeout: 10000,
  });

  // Wait for the overlay source to hold BOTH station kinds. Waiting on a bare
  // `length > 0` is not enough: querySourceFeatures reads whichever tiles have
  // been parsed so far, so tides and currents can land a frame apart, and a
  // plain assertion would then race whichever kind arrives second.
  const countKind = (kind: string) =>
    page.evaluate((k) => {
      if (!window.__map.getSource("_tides-currents")) return 0;
      return window.__map
        .querySourceFeatures("_tides-currents")
        .filter((f) => f.properties._kind === k).length;
    }, kind);

  await expect
    .poll(() => countKind("tide"), { timeout: 20000 })
    .toBeGreaterThan(0);
  await expect
    .poll(() => countKind("current"), { timeout: 20000 })
    .toBeGreaterThan(0);

  // Wait until current stations are actually drawn (icons load after the
  // source data arrives), not just present in the source.
  await page.waitForFunction(
    () => {
      const map = window.__map;
      return (
        map.queryRenderedFeatures(undefined, {
          layers: [
            "_current-arrows",
            "_current-slack-flood",
            "_current-slack-ebb",
          ],
        }).length > 0
      );
    },
    { timeout: 20000 },
  );

  // Click a rendered current station and verify the events popup appears.
  // Picked from the live map rather than hardcoded — station positions and
  // ids shift when the tides bundle is regenerated. The one nearest screen
  // center is least likely to sit under a HUD element.
  const point = await page.evaluate(() => {
    const map = window.__map;
    const stations = map.queryRenderedFeatures(undefined, {
      layers: ["_current-arrows", "_current-slack-flood", "_current-slack-ebb"],
    });
    const rect = map.getContainer().getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    let best: { x: number; y: number } | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (const f of stations) {
      const p = map.project(f.geometry.coordinates);
      const d = (p.x - cx) ** 2 + (p.y - cy) ** 2;
      if (d < bestD) {
        bestD = d;
        best = { x: rect.left + p.x, y: rect.top + p.y };
      }
    }
    return best;
  });
  expect(point).not.toBeNull();
  if (!point) return;
  await page.mouse.click(point.x, point.y);

  const panel = page.locator(".feature-info-panel.visible", {
    hasText: "Current Station",
  });
  await expect(panel).toBeVisible({ timeout: 5000 });
  await expect(panel).toContainText(/Max Flood|Max Ebb|Slack/);
});
