import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";

/** Current app version from package.json. */
export const APP_VERSION: string = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
).version;

/**
 * Pre-mark the current version's "What's New" notes as seen. Any test that
 * seeds `pelorus-nav-settings` looks like an upgrading user to the app, and
 * the one-time What's New dialog would otherwise overlay the map and
 * intercept every pointer event. Call before page.goto().
 */
export async function suppressWhatsNew(page: Page): Promise<void> {
  await page.addInitScript((version) => {
    localStorage.setItem("pelorus-nav-last-seen-version", version);
  }, APP_VERSION);
}
