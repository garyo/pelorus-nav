import { expect, test } from "@playwright/test";
import { acceptDisclaimer, suppressWhatsNew } from "./helpers";

interface ProbeMap {
  getSource(id: string): unknown;
  querySourceFeatures(id: string): { properties: Record<string, unknown> }[];
  project(lngLat: [number, number]): { x: number; y: number };
  getContainer(): HTMLElement;
}

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
  await page.addInitScript(() => {
    const raw = localStorage.getItem("pelorus-nav-settings");
    const settings = raw ? JSON.parse(raw) : {};
    settings.layerGroups = {
      ...(settings.layerGroups ?? {}),
      tidesCurrents: true,
    };
    localStorage.setItem("pelorus-nav-settings", JSON.stringify(settings));
    localStorage.setItem(
      "pelorus-nav-map-position",
      JSON.stringify({ center: [-70.97, 42.34], zoom: 12 }),
    );
  });
  await page.goto("/");
  await expect(page.locator(".maplibregl-map")).toBeVisible({
    timeout: 10000,
  });

  // Wait for the overlay source to be populated with station features
  await page.waitForFunction(
    () => {
      const map = (window as unknown as { __map?: ProbeMap }).__map;
      if (!map?.getSource("_tides-currents")) return false;
      return map.querySourceFeatures("_tides-currents").length > 0;
    },
    { timeout: 20000 },
  );

  const counts = await page.evaluate(() => {
    const map = (window as unknown as { __map: ProbeMap }).__map;
    const features = map.querySourceFeatures("_tides-currents");
    return {
      tide: features.filter((f) => f.properties._kind === "tide").length,
      current: features.filter((f) => f.properties._kind === "current").length,
    };
  });
  expect(counts.tide).toBeGreaterThan(0);
  expect(counts.current).toBeGreaterThan(0);

  // Click a current station (BOS1111, Deer Island Light) via its projected
  // screen position and verify the events popup appears.
  const point = await page.evaluate(() => {
    const map = (window as unknown as { __map: ProbeMap }).__map;
    const p = map.project([-70.95578, 42.33778]);
    const rect = map.getContainer().getBoundingClientRect();
    return { x: rect.left + p.x, y: rect.top + p.y };
  });
  await page.mouse.click(point.x, point.y);

  const panel = page.locator(".feature-info-panel.visible", {
    hasText: "Current Station",
  });
  await expect(panel).toBeVisible({ timeout: 5000 });
  await expect(panel).toContainText(/Max Flood|Max Ebb|Slack/);
});
