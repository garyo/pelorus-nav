import { expect, type Page, test } from "@playwright/test";
import { acceptDisclaimer } from "./helpers";

/**
 * System-UI insets. Chromium cannot emulate env(safe-area-inset-*), but the
 * stylesheet reads the --safe-area-inset-* variables the Capacitor shell
 * injects first, so injecting them here exercises the same path an
 * edge-to-edge Android phone takes: a 48 px navigation bar along the
 * bottom (portrait) or the right edge (landscape).
 */

const INSET = 48;

async function injectInsets(
  page: Page,
  insets: Partial<Record<"top" | "right" | "bottom" | "left", number>>,
): Promise<void> {
  await page.evaluate((insets) => {
    const style = document.documentElement.style;
    for (const [edge, px] of Object.entries(insets)) {
      style.setProperty(`--safe-area-inset-${edge}`, `${px}px`);
    }
  }, insets);
}

test.beforeEach(async ({ page }) => {
  await acceptDisclaimer(page);
});

test("bottom-edge controls sit above a bottom navigation bar", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/");
  const bottomLeft = page.locator(".maplibregl-ctrl-bottom-left");
  await expect(bottomLeft).toBeVisible();
  const before = await bottomLeft.boundingBox();

  await injectInsets(page, { bottom: INSET });
  await expect
    .poll(async () => (await bottomLeft.boundingBox())?.y)
    .toBeLessThan((before?.y ?? 0) - INSET + 1);
  const box = await bottomLeft.boundingBox();
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(780 - INSET);
});

test("right-edge controls and the top bar clear a side navigation bar in landscape", async ({
  page,
}) => {
  await page.setViewportSize({ width: 780, height: 360 });
  await page.goto("/");
  const topRight = page.locator(".maplibregl-ctrl-top-right");
  await expect(topRight).toBeVisible();

  await injectInsets(page, { right: INSET, top: 10 });
  await expect
    .poll(async () => {
      const box = await topRight.boundingBox();
      return (box?.x ?? 0) + (box?.width ?? 0);
    })
    .toBeLessThanOrEqual(780 - INSET);

  // The top bar pads its content down by the top inset.
  const paddingTop = await page
    .locator("#top-bar")
    .evaluate((el) => getComputedStyle(el).paddingTop);
  expect(paddingTop).toBe("10px");
});
