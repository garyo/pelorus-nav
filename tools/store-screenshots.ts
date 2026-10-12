/**
 * App-store listing screenshots, built from the user-guide scenes in
 * docs-shots.ts so both stay deterministic and in step with the UI.
 *
 * Run (dev server on :5173):
 *   bun tools/store-screenshots.ts <android|ios> [--out DIR] [scene ...]
 * Output: DIR/NN-<scene>-<format>.png (default DIR: branding/store-listing),
 * numbered in listing order.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  launchBrowser,
  SCENES,
  type Scene,
  type ShotFormat,
  shoot,
} from "./docs-shots";

interface StoreFormat extends ShotFormat {
  name: string;
}

interface StoreScene {
  /** A docs-shots scene name. */
  scene: string;
  /** Field overrides for the store framing (e.g. a wider zoom on phones). */
  phone?: Partial<Scene>;
  tablet?: Partial<Scene>;
}

interface Platform {
  formats: Array<StoreFormat & { kind: "phone" | "tablet" }>;
  scenes: StoreScene[];
  /** Controls the platform's app doesn't offer, hidden from the web build. */
  hide?: string[];
}

/** The whole demo route in a phone-width frame. */
const PHONE_HARBOR: Partial<Scene> = { center: [-70.97, 42.34], zoom: 12.2 };

const PLATFORMS: Record<string, Platform> = {
  android: {
    formats: [
      {
        name: "phone",
        kind: "phone",
        width: 360,
        height: 640,
        deviceScaleFactor: 3,
      }, // 1080x1920
      {
        name: "tab7",
        kind: "tablet",
        width: 600,
        height: 960,
        deviceScaleFactor: 2,
      }, // 1200x1920
      {
        name: "tab10",
        kind: "tablet",
        width: 960,
        height: 600,
        deviceScaleFactor: 2,
      }, // 1920x1200
    ],
    scenes: [
      { scene: "overview" },
      { scene: "night-mode" },
      { scene: "settings-appearance" },
      { scene: "settings-layers" },
      { scene: "track-viewer" },
    ],
  },
  ios: {
    hide: ['button[title="Anchor Watch"]'], // see anchorWatchSupported()
    // App Store Connect's required sizes: 6.9" iPhone and 13" iPad.
    formats: [
      {
        name: "iphone69",
        kind: "phone",
        width: 440,
        height: 956,
        deviceScaleFactor: 3,
      }, // 1320x2868
      {
        name: "ipad13",
        kind: "tablet",
        width: 1376,
        height: 1032,
        deviceScaleFactor: 2,
      }, // 2752x2064
    ],
    // Phones are narrow: zoom out or re-centre so each scene's subject fits.
    scenes: [
      { scene: "overview", phone: PHONE_HARBOR },
      { scene: "route-navigation" },
      { scene: "tides-time" },
      { scene: "track-viewer" },
      { scene: "night-mode", phone: PHONE_HARBOR },
      { scene: "plotting", phone: { zoom: 12.7 } },
      {
        scene: "tide-station",
        phone: { center: [-70.955, 42.287], zoom: 12.6 },
      },
      { scene: "chart-regions" },
    ],
  },
};

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { out: { type: "string", default: "branding/store-listing" } },
});
const [platformName, ...only] = positionals;
const platform = PLATFORMS[platformName ?? ""];
if (!platform) {
  throw new Error(
    `usage: store-screenshots.ts <${Object.keys(PLATFORMS).join("|")}> [--out DIR] [scene ...]`,
  );
}

const byName = new Map(SCENES.map((s) => [s.name, s]));
const hideCss = platform.hide?.length
  ? `${platform.hide.join(", ")} { display: none !important; }`
  : null;
const out = resolve(values.out);
mkdirSync(out, { recursive: true });
const browser = await launchBrowser();
for (const [i, entry] of platform.scenes.entries()) {
  if (only.length && !only.includes(entry.scene)) continue;
  const base = byName.get(entry.scene);
  if (!base) throw new Error(`unknown docs scene: ${entry.scene}`);
  const num = String(i + 1).padStart(2, "0");
  for (const fmt of platform.formats) {
    const scene: Scene = { ...base, ...entry[fmt.kind] };
    if (hideCss) {
      scene.actions = async (page) => {
        await page.addStyleTag({ content: hideCss });
        await base.actions?.(page);
      };
    }
    await shoot(
      scene,
      browser,
      `${out}/${num}-${entry.scene}-${fmt.name}.png`,
      fmt,
    );
  }
}
await browser.close();
console.log("done");
