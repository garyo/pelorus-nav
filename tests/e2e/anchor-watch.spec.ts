import { expect, type Page, test } from "@playwright/test";
import {
  acceptDisclaimer,
  seedSettings,
  suppressWhatsNew,
  waitForAppReady,
} from "./helpers";

// SimulatorProvider's Boston inner-harbor start point (see
// simulator-route-follow.spec.ts for the route geometry).
const START: [number, number] = [42.363559, -71.047973];

/** Press-and-hold the center of an element for `ms`, then release. */
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
  await acceptDisclaimer(page);
  await seedSettings(page, {
    gpsSource: "simulator",
    simulatorSpeed: 10,
    depthUnit: "meters",
  });
}

async function bootWithSimulator(page: Page): Promise<void> {
  await page.goto(`/?simStart=${START[0]},${START[1]}`);
  await expect(page.locator(".maplibregl-map")).toBeVisible({ timeout: 10000 });
  await waitForAppReady(page);
  // Wait for a simulator fix (HUD shows real coordinates instead of "GPS: --")
  await expect(page.locator(".nav-hud")).toContainText(/GPS: \d+°/, {
    timeout: 15000,
  });
}

/**
 * The full drag scenario against the simulator: enter anchor mode from the
 * menu, arm a deliberately tiny 30 m watch at the start position, and let
 * the 10 kn simulator sail straight out of it — warn zone, then the drag
 * alarm after the 15 s exit hysteresis. Tapping the alarm acknowledges
 * (silences, stays armed); continued dragging re-fires it (acknowledged
 * alarms are never one-shot); holding disarm on the banner stands the watch
 * down; the corner badge is gone once disarmed.
 */
test("anchor drag: warn, alarm, tap-acknowledge, re-alarm, hold-disarm", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await seedSimulatorSettings(page);
  await bootWithSimulator(page);

  // Enter anchor mode from the menu: the setup card opens.
  await page.getByRole("button", { name: "Anchor Watch" }).click();
  const panel = page.locator(".anchor-panel");
  await expect(panel).toHaveClass(/open/);
  await expect(panel).toContainText("ANCHOR WATCH");
  await expect(panel).toHaveAttribute("data-armed", "0");

  // Tiny radius so the simulator exits quickly.
  await page.locator(".anchor-radius-input").fill("30");

  // A too-short press must not arm.
  await holdElement(page, ".anchor-arm-btn", 200);
  await expect(panel).toHaveAttribute("data-armed", "0");

  // Hold to arm (600 ms).
  await holdElement(page, ".anchor-arm-btn", 1200);
  await expect(panel).toHaveAttribute("data-armed", "1");
  // Armed view: live distance readout and time at anchor tick.
  await expect(panel.locator(".anchor-dist")).toContainText(/\d+ m/, {
    timeout: 10000,
  });
  await expect(panel.locator(".anchor-panel-elapsed")).toContainText(/\d:\d\d/);
  // In anchor mode the corner badge stays out of the way.
  await expect(page.locator(".anchor-badge")).toBeHidden();

  // The vessel leaves the safe zone. Which side of the warning ring a given
  // fix lands on isn't assertable here — at 10 kn the 8 m warning band takes
  // under two seconds to cross, less than the fix cadence — so this checks
  // only that the watch left "ok"; the manager's unit tests cover the
  // ok→warn→outside sequence deterministically.
  await expect(panel).not.toHaveAttribute("data-zone", "ok", {
    timeout: 30000,
  });
  // The drag alarm fires after ~15 s continuously outside 30 m.
  const alarm = page.locator(".anchor-alarm");
  await expect(alarm).toHaveClass(/open/, { timeout: 45000 });
  await expect(alarm).toContainText("ANCHOR DRAGGING");

  // Tap anywhere on the banner = acknowledge: silence this event, stay armed.
  await alarm.locator(".anchor-alarm-title").click();
  await expect(alarm).not.toHaveClass(/open/);
  await expect(panel).toHaveAttribute("data-armed", "1");

  // Still dragging — the acknowledged alarm re-fires (never one-shot).
  await expect(alarm).toHaveClass(/open/, { timeout: 30000 });

  // Hold-to-disarm on the banner is the full stand-down.
  await holdElement(page, ".anchor-alarm .anchor-disarm-btn", 2500);
  await expect(alarm).not.toHaveClass(/open/);
  await expect(panel).toHaveAttribute("data-armed", "0");

  // Leave the mode; nothing armed, so no corner badge.
  await page.keyboard.press("Escape");
  await expect(panel).not.toHaveClass(/open/);
  await expect(page.locator(".anchor-badge")).toBeHidden();
});

/**
 * Arming survives leaving the mode and a full reload: the corner badge shows
 * the armed watch in the main UX, and tapping it re-enters anchor mode.
 */
test("anchor watch persists across mode exit and reload", async ({ page }) => {
  await seedSimulatorSettings(page);
  await bootWithSimulator(page);

  await page.getByRole("button", { name: "Anchor Watch" }).click();
  const panel = page.locator(".anchor-panel");
  await expect(panel).toHaveClass(/open/);
  // Large radius: the vessel stays inside for the duration of this test.
  await page.locator(".anchor-radius-input").fill("2000");
  await holdElement(page, ".anchor-arm-btn", 1200);
  await expect(panel).toHaveAttribute("data-armed", "1");

  // Leaving the mode keeps the watch running; the badge appears.
  await page.keyboard.press("Escape");
  await expect(panel).not.toHaveClass(/open/);
  const badge = page.locator(".anchor-badge");
  await expect(badge).toBeVisible();
  await expect(badge).toContainText(/m|NM/);

  // Reload mid-watch: restore re-arms and re-shows the badge.
  await page.reload();
  await expect(page.locator(".maplibregl-map")).toBeVisible({ timeout: 10000 });
  await waitForAppReady(page);
  await expect(badge).toBeVisible({ timeout: 10000 });

  // Tapping the badge re-enters anchor mode with the armed view.
  await badge.click();
  await expect(panel).toHaveClass(/open/);
  await expect(panel).toHaveAttribute("data-armed", "1");
  await expect(badge).toBeHidden();

  // Stand down so nothing leaks into other tests' storage state. The alarm
  // banner is its own surface with its own disarm button, so scope this to
  // the panel's.
  await holdElement(page, ".anchor-panel .anchor-disarm-btn", 2500);
  await expect(panel).toHaveAttribute("data-armed", "0");
});

/**
 * Arming is all-or-nothing: with no position source the watch cannot watch,
 * so the button is disabled and says why rather than arming into a blind
 * state that would only reveal itself later.
 */
test("arming is blocked, with a reason, until there is a fix", async ({
  page,
}) => {
  await suppressWhatsNew(page);
  await acceptDisclaimer(page);
  await seedSettings(page, { gpsSource: "none", depthUnit: "meters" });
  await page.goto("/");
  await expect(page.locator(".maplibregl-map")).toBeVisible({ timeout: 10000 });
  await waitForAppReady(page);

  await page.getByRole("button", { name: "Anchor Watch" }).click();
  const panel = page.locator(".anchor-panel");
  await expect(panel).toHaveClass(/open/);

  const armBtn = page.locator(".anchor-arm-btn");
  await expect(armBtn).toBeDisabled();
  await expect(page.locator(".anchor-arm-blocked")).toContainText(/GPS/i);

  // Holding a disabled button must not arm.
  await holdElement(page, ".anchor-arm-btn", 1200);
  await expect(panel).toHaveAttribute("data-armed", "0");
  await expect(page.locator(".anchor-badge")).toBeHidden();
});
