import type { Page } from "@playwright/test";
import {
  clickEl,
  clickXY,
  dragHoriz,
  holdEl,
  holdXY,
  resetCursor,
} from "./cursor";
import type { Driver } from "./types";

/**
 * Build the generic `Driver` handed to a scene's `drive()`. Wraps the injected
 * cursor helpers over a Playwright page and carries the adapter-provided app-op
 * surface. App-neutral: no application specifics leak in here.
 */
export function makeDriver<App>(page: Page, app: App): Driver<App> {
  return {
    page,
    app,
    wait: (ms) => page.waitForTimeout(ms),
    goto: async (url) => {
      await page.goto(url, { waitUntil: "domcontentloaded" });
    },
    reload: async () => {
      await page.reload({ waitUntil: "domcontentloaded" });
    },
    click: (target) =>
      typeof target === "string"
        ? clickEl(page, target)
        : clickXY(page, target.x, target.y),
    hold: (target, holdMs) =>
      typeof target === "string"
        ? holdEl(page, target, holdMs)
        : holdXY(page, target.x, target.y, holdMs),
    drag: (selector, fromFrac, toFrac, ms) =>
      dragHoriz(page, selector, fromFrac, toFrac, ms),
    resetCursor,
  };
}
