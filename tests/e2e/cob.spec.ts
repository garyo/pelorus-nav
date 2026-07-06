import { expect, type Page, test } from "@playwright/test";
import { suppressWhatsNew } from "./helpers";

// SimulatorProvider's Boston inner-harbor start point (see
// simulator-route-follow.spec.ts for the route geometry).
const START: [number, number] = [42.363559, -71.047973];

/** Press-and-hold the center of an element for `ms`, then release.
 *  hover() first: it waits for the element to be stable and actually
 *  hit-testable (layout settled, no overlay), unlike raw mouse coords. */
async function holdElement(
  page: Page,
  selector: string,
  ms: number,
): Promise<void> {
  await page.locator(selector).hover();
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

async function seedSimulatorSettings(page: Page): Promise<void> {
  await suppressWhatsNew(page);
  await page.addInitScript(() => {
    const raw = localStorage.getItem("pelorus-nav-settings");
    const settings = raw ? JSON.parse(raw) : {};
    Object.assign(settings, {
      gpsSource: "simulator",
      simulatorSpeed: 10,
      showInstrumentHUD: true,
    });
    localStorage.setItem("pelorus-nav-settings", JSON.stringify(settings));
  });
}

/**
 * The full crew-overboard journey: a too-short press does nothing, a 1.5 s
 * hold drops the COB waypoint and starts navigation back, the emergency
 * survives a full page reload, Escape is guarded rather than silently
 * canceling the return, and a held "Recovered" ends the event while keeping
 * the waypoint as a record.
 */
test("COB hold-to-activate, restart survival, cancel guard, and resolve", async ({
  page,
}) => {
  await seedSimulatorSettings(page);
  await page.goto(`/?simStart=${START[0]},${START[1]}`);
  await expect(page.locator(".maplibregl-map")).toBeVisible({ timeout: 10000 });

  // Wait for a simulator fix (HUD shows real coordinates instead of "GPS: --")
  await expect(page.locator(".nav-hud")).toContainText(/GPS: \d+°/, {
    timeout: 15000,
  });

  const cobBtn = page.locator(".cob-btn");
  await expect(cobBtn).toBeVisible();

  // Too-short press: no activation, hint shown instead.
  await holdElement(page, ".cob-btn", 400);
  await expect(page.locator(".cob-panel")).not.toHaveClass(/open/);
  await expect(page.locator(".cob-hint")).toBeVisible();

  // Full 1.5 s hold: emergency activates.
  await holdElement(page, ".cob-btn", 2000);
  const panel = page.locator(".cob-panel");
  await expect(panel).toHaveClass(/open/);
  await expect(panel).toContainText("CREW OVERBOARD");
  // Mayday coordinates in DDM
  await expect(panel.locator(".cob-panel-pos")).toContainText(/\d+°\d/);
  await expect(panel.locator(".cob-panel-pos")).toContainText("N");
  // Elapsed timer ticking
  await expect(panel.locator(".cob-panel-elapsed")).toContainText(/\d:\d\d/);
  // Navigation back is active: cancel-nav control appears, HUD shows BRG
  await expect(page.locator(".cancel-nav-btn")).toBeVisible();
  await expect(cobBtn).toHaveClass(/cob-active/);

  // The COB waypoint is in the waypoint manager, red-flagged
  await page.getByRole("button", { name: "Waypoints" }).click();
  const wpPanel = page.locator(".waypoint-manager-panel");
  await expect(wpPanel).toContainText(/COB \d\d:\d\d:\d\d/);
  await page.getByRole("button", { name: "Waypoints" }).click();

  // Reload mid-emergency: everything comes back.
  await page.reload();
  await expect(page.locator(".maplibregl-map")).toBeVisible({ timeout: 10000 });
  await expect(panel).toHaveClass(/open/, { timeout: 10000 });
  await expect(panel.locator(".cob-panel-elapsed")).toContainText(/\d:\d\d/);
  await expect(page.locator(".cancel-nav-btn")).toBeVisible();

  // Escape must not silently cancel the COB return — the guard dialog opens.
  await page.keyboard.press("Escape");
  const guard = page.locator(".cob-guard-card");
  await expect(guard).toBeVisible();
  await guard.getByRole("button", { name: "Keep navigating to COB" }).click();
  await expect(guard).not.toBeVisible();
  await expect(page.locator(".cancel-nav-btn")).toBeVisible();

  // Crew recovered: hold the resolve button. Event ends, waypoint remains.
  await holdElement(page, ".cob-panel-btn-resolve", 2000);
  await expect(panel).not.toHaveClass(/open/);
  await expect(page.locator(".cancel-nav-btn")).not.toBeVisible();
  await page.getByRole("button", { name: "Waypoints" }).click();
  await expect(wpPanel).toContainText(/COB \d\d:\d\d:\d\d/);
  await expect(wpPanel).toContainText(/resolved/);
});

test("COB without any GPS fix shows an error and does not activate", async ({
  page,
}) => {
  // Default gpsSource in a browser context is "none" — no fix ever arrives.
  await page.goto("/");
  await expect(page.locator(".maplibregl-map")).toBeVisible({ timeout: 10000 });

  await holdElement(page, ".cob-btn", 2000);
  await expect(page.locator(".status-banner")).toContainText(/No GPS fix/);
  await expect(page.locator(".cob-panel")).not.toHaveClass(/open/);
  await expect(page.locator(".cob-btn")).not.toHaveClass(/cob-active/);
});
