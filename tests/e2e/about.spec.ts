import { expect, test } from "@playwright/test";
import { acceptDisclaimer } from "./helpers";

test("the About dialog closes from its own close button", async ({ page }) => {
  await acceptDisclaimer(page);
  await page.goto("/");
  await expect(page.locator(".maplibregl-map")).toBeVisible({
    timeout: 10000,
  });

  const hamburger = page.locator("#hamburger-btn");
  if (await hamburger.isVisible()) await hamburger.click();
  await page.locator('button[title="About"]').click();
  // Several dialogs share the overlay class; the About one owns the close button.
  const overlay = page.locator(".about-overlay", {
    has: page.locator(".about-close"),
  });
  await expect(overlay).toBeVisible();

  await page.locator(".about-close").click();
  await expect(overlay).toBeHidden();
});
