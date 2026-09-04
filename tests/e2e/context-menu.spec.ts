import { expect, type Page, test } from "@playwright/test";
import {
  acceptDisclaimer,
  seedSettings,
  suppressWhatsNew,
  waitForAppReady,
} from "./helpers";

/** Boston Harbor, on the simulator's route. */
const START: [number, number] = [42.363715, -71.04743];

async function bootSimulator(
  page: Page,
  settings: Record<string, unknown>,
): Promise<void> {
  await suppressWhatsNew(page);
  await acceptDisclaimer(page);
  await seedSettings(page, {
    gpsSource: "simulator",
    simulatorSpeed: 100,
    ...settings,
  });
  await page.goto(`/?simStart=${START[0]},${START[1]}`);
  await expect(page.locator(".maplibregl-map")).toBeVisible({
    timeout: 10000,
  });
  await waitForAppReady(page);
}

async function mapCenter(page: Page): Promise<[number, number]> {
  return page.evaluate(() => {
    const map = (
      window as unknown as {
        __map: { getCenter(): { lng: number; lat: number } };
      }
    ).__map;
    const c = map.getCenter();
    return [c.lng, c.lat];
  });
}

async function openMenuAt(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.click(x, y, { button: "right" });
  await expect(page.locator(".map-context-menu")).toBeVisible();
}

test("stays open while a follow mode recentres on the moving vessel", async ({
  page,
}) => {
  await bootSimulator(page, { chartMode: "north-up" });

  // The chart must actually be moving under the menu for this to mean anything.
  const before = await mapCenter(page);
  await expect
    .poll(async () => {
      const [lng, lat] = await mapCenter(page);
      return Math.abs(lng - before[0]) + Math.abs(lat - before[1]);
    })
    .toBeGreaterThan(0);

  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
  await openMenuAt(page, viewport.width / 2, viewport.height / 2);
  await page.waitForTimeout(1500);
  await expect(page.locator(".map-context-menu")).toBeVisible();

  // A user drag is a look-away: it dismisses the menu (and releases follow).
  await page.mouse.move(viewport.width / 4, viewport.height / 4);
  await page.mouse.down();
  await page.mouse.move(viewport.width / 4 + 80, viewport.height / 4 + 60, {
    steps: 5,
  });
  await page.mouse.up();
  await expect(page.locator(".map-context-menu")).toBeHidden();
});

test("the Plot submenu stays inside the viewport near the bottom-right corner", async ({
  page,
}) => {
  await bootSimulator(page, { chartMode: "free" });
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };

  await openMenuAt(page, viewport.width - 8, viewport.height - 8);
  const menuBox = await page.locator(".map-context-menu").boundingBox();
  expect(menuBox).not.toBeNull();
  expect((menuBox?.x ?? 0) + (menuBox?.width ?? 0)).toBeLessThanOrEqual(
    viewport.width,
  );
  expect((menuBox?.y ?? 0) + (menuBox?.height ?? 0)).toBeLessThanOrEqual(
    viewport.height,
  );

  await page.locator(".map-context-submenu-parent").click();
  const submenu = page.locator(".map-context-submenu");
  await expect(submenu).toBeVisible();
  const box = await submenu.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(viewport.width);
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(
    viewport.height,
  );
});
