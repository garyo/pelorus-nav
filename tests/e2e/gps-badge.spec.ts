import { expect, test } from "@playwright/test";
import {
  acceptDisclaimer,
  seedSettings,
  suppressWhatsNew,
  waitForAppReady,
} from "./helpers";

/** Tapping the GPS status badge opens Settings on the Navigation tab, where
 *  the GPS source and its connection live. */
test("the GPS badge opens the GPS settings", async ({ page }) => {
  await suppressWhatsNew(page);
  await acceptDisclaimer(page);
  await seedSettings(page, { showInstrumentHUD: true });
  await page.goto("/");
  await waitForAppReady(page);

  await page.locator(".instrument-gps").click();
  const panel = page.locator(".settings-panel.open");
  await expect(panel).toBeVisible();
  await expect(panel.locator(".settings-tab.active")).toHaveAttribute(
    "data-tab",
    "navigation",
  );
  await expect(
    panel.locator('.settings-tab-body[data-tab="navigation"]'),
  ).toBeVisible();
});
