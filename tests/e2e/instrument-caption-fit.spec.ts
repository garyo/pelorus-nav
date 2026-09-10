import { expect, type Page, test } from "@playwright/test";
import {
  acceptDisclaimer,
  seedRoute,
  seedSettings,
  suppressWhatsNew,
  waitForAppReady,
} from "./helpers";

/**
 * Nav caption fit. The strip above the nav cells ("Next: name · time" and
 * "Dest: distance / arrival") must hold its widest realistic texts in every
 * instrument layout and viewport without clipping, and its height must not
 * depend on the text: a longer waypoint name or a time growing from "9m"
 * to "1h 25m" would otherwise shift the nav grid under the helmsman's eye.
 * style.css fixes the line count per layout and lets only the name give
 * way (ellipsis); this pins that across the device matrix.
 *
 * Texts are injected straight into the caption's spans rather than waiting
 * for the simulator to produce them, so the check is about geometry alone
 * and runs in seconds.
 */

// CSS px viewports: phones, the BOOX Go Color 7, a tablet, desktops —
// portrait and landscape, on both sides of the 600px landscape gate.
const VIEWPORTS: [number, number][] = [
  [360, 740],
  [390, 844],
  [630, 896],
  [768, 1024],
  [740, 360],
  [844, 390],
  [896, 630],
  [1000, 700],
  [1366, 768],
];

interface CaptionTexts {
  name: string;
  ttg: string;
  dest: string;
  eta: string;
}

/** Widest values the formatters can produce for a coastal passage. */
const WIDEST: CaptionTexts = {
  name: "Next: Inner Harbor Red 4 Approach Buoy",
  ttg: "~23h 59m",
  dest: "Dest: 125.3 NM",
  eta: "~Tue 11:58 AM",
};
const SHORTEST: CaptionTexts = {
  name: "Next: Pt",
  ttg: "5m",
  dest: "Dest: 1.2 NM",
  eta: "--",
};
const TYPICAL: CaptionTexts = {
  name: "Next: Castle Island",
  ttg: "25m",
  dest: "Dest: 12.4 NM",
  eta: "2:32 PM",
};

interface Fit {
  hudHeight: number;
  /** Pixels each span overruns the caption's content box (0 = fits). */
  overrun: { ttg: number; dest: number; eta: number };
  nameWidth: number;
}

/** Write the texts into the live caption and measure the result. */
function measure(page: Page, texts: CaptionTexts): Promise<Fit> {
  return page.evaluate((t) => {
    const q = (sel: string) => {
      const el = document.querySelector<HTMLElement>(sel);
      if (!el) throw new Error(`missing ${sel}`);
      return el;
    };
    q(".instrument-next-wp-name").textContent = t.name;
    const ttg = q(".instrument-next-wp-ttg");
    ttg.textContent = t.ttg;
    ttg.hidden = false;
    const dest = q(".instrument-next-wp-dest");
    (dest.firstChild as Text).data = t.dest;
    const eta = q(".instrument-next-wp-eta");
    eta.textContent = t.eta;
    eta.hidden = false;

    const cap = q(".instrument-next-wp");
    const style = getComputedStyle(cap);
    const box = cap.getBoundingClientRect();
    const left = box.left + Number.parseFloat(style.paddingLeft);
    const right = box.right - Number.parseFloat(style.paddingRight);
    const overrun = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return Math.max(0, r.right - right, left - r.left);
    };
    return {
      hudHeight: q(".instrument-hud").getBoundingClientRect().height,
      overrun: { ttg: overrun(ttg), dest: overrun(dest), eta: overrun(eta) },
      nameWidth: q(".instrument-next-wp-name").getBoundingClientRect().width,
    };
  }, texts);
}

const A: [number, number] = [42.363715, -71.04743];
const B: [number, number] = [42.352039, -71.032698];

for (const layout of ["standard", "side"] as const) {
  test(`nav caption fits every viewport in the ${layout} layout`, async ({
    page,
  }) => {
    await suppressWhatsNew(page);
    await acceptDisclaimer(page);
    await seedSettings(page, {
      showInstrumentHUD: true,
      instrumentLayout: layout,
      chartMode: "free",
    });
    await page.goto(`/?simStart=${A[0]},${A[1]}`);
    await waitForAppReady(page);

    const routesBtn = page.getByRole("button", { name: "Routes" });
    await routesBtn.click();
    await expect(
      page.locator(".manager-panel.route-manager-panel"),
    ).toHaveClass(/open/);
    await seedRoute(page, {
      id: "caption-fit",
      name: "Caption fit",
      createdAt: Date.now(),
      color: "#4488cc",
      visible: true,
      waypoints: [
        { lat: A[0], lon: A[1], name: "Inner Harbor" },
        { lat: B[0], lon: B[1], name: "Castle Island" },
      ],
    });
    await routesBtn.click();
    await routesBtn.click();
    await page
      .locator('.manager-item[data-route-id="caption-fit"] .route-nav-btn')
      .click();
    await routesBtn.click();
    await expect(page.locator(".instrument-next-wp")).toBeAttached();

    for (const [width, height] of VIEWPORTS) {
      await page.setViewportSize({ width, height });
      const where = `${layout} ${width}x${height}`;
      const shortest = await measure(page, SHORTEST);
      const widest = await measure(page, WIDEST);
      expect(widest.hudHeight, `${where}: height shifts with text`).toBe(
        shortest.hudHeight,
      );
      for (const [span, px] of Object.entries(widest.overrun)) {
        expect(px, `${where}: ${span} clipped`).toBeLessThanOrEqual(0.5);
      }
      const typical = await measure(page, TYPICAL);
      expect(
        typical.nameWidth,
        `${where}: waypoint name squeezed out`,
      ).toBeGreaterThan(40);
    }
  });
}
