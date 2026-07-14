import type { Page } from "@playwright/test";

/**
 * A visible, animated cursor for walkthrough recordings. Playwright's real
 * pointer isn't captured on video, so we inject our own cursor element, glide
 * it to targets, and pulse on click — while still firing real mouse events so
 * the app responds. pointer-events:none keeps the overlay from blocking clicks.
 *
 * App-neutral: this knows nothing about any particular application.
 */

/** The overlay API installed on `window` by `installCursorScript`. */
interface CursorWindow {
  __pcMove(x: number, y: number): void;
  __pcPress(down: boolean): void;
  __pcRipple(x: number, y: number): void;
  __pcShow(visible: boolean): void;
}

/** Injected before app scripts (survives reloads). Sets up the overlay + API. */
export function installCursorScript(): void {
  const build = () => {
    if (document.getElementById("promo-cursor")) return;
    const style = document.createElement("style");
    style.textContent = `
      #promo-cursor{position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;
        width:28px;height:28px;transform:translate(-3px,-2px);transition:transform .08s ease-out,opacity .25s;
        filter:drop-shadow(0 2px 3px rgba(0,0,0,.45));will-change:left,top;opacity:0}
      #promo-cursor.press{transform:translate(-3px,-2px) scale(.82)}
      .promo-ripple{position:fixed;z-index:2147483646;pointer-events:none;border-radius:50%;
        border:3px solid rgba(90,170,255,.95);width:14px;height:14px;
        transform:translate(-50%,-50%) scale(.4);opacity:.9;
        animation:promoRipple .5s ease-out forwards}
      @keyframes promoRipple{to{transform:translate(-50%,-50%) scale(4.2);opacity:0}}
      #promo-cursor .halo{position:absolute;left:50%;top:50%;width:34px;height:34px;
        transform:translate(-50%,-50%);border-radius:50%;
        background:radial-gradient(circle,rgba(90,170,255,.35),transparent 70%)}
    `;
    document.head.appendChild(style);
    const c = document.createElement("div");
    c.id = "promo-cursor";
    c.innerHTML = `<div class="halo"></div>
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        <path d="M4 2 L4 22 L9.5 16.8 L13 24 L16 22.6 L12.5 15.5 L20 15.2 Z"
          fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/>
      </svg>`;
    (document.body ?? document.documentElement).appendChild(c);
    const w = window as unknown as CursorWindow;
    w.__pcMove = (x, y) => {
      c.style.left = `${x}px`;
      c.style.top = `${y}px`;
    };
    w.__pcShow = (visible) => {
      c.style.opacity = visible ? "1" : "0";
    };
    w.__pcPress = (down) => c.classList.toggle("press", down);
    w.__pcRipple = (x, y) => {
      const r = document.createElement("div");
      r.className = "promo-ripple";
      r.style.left = `${x}px`;
      r.style.top = `${y}px`;
      document.body.appendChild(r);
      setTimeout(() => r.remove(), 550);
    };
    w.__pcMove(60, 60);
  };
  if (document.body) build();
  else document.addEventListener("DOMContentLoaded", build);
}

const sleep = (p: Page, ms: number) => p.waitForTimeout(ms);
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** Track the cursor's current position so glides start from the right place. */
let cur = { x: 60, y: 60 };

/** Glide the visible cursor (and the real pointer) from its position to (x,y). */
export async function glideTo(
  page: Page,
  x: number,
  y: number,
  ms = 650,
): Promise<void> {
  await page.evaluate(() => (window as unknown as CursorWindow).__pcShow(true));
  const steps = Math.max(12, Math.round(ms / 16));
  const { x: sx, y: sy } = cur;
  for (let i = 1; i <= steps; i++) {
    const t = ease(i / steps);
    const px = sx + (x - sx) * t;
    const py = sy + (y - sy) * t;
    await page.evaluate(
      ([px, py]) => (window as unknown as CursorWindow).__pcMove(px, py),
      [px, py],
    );
    await page.mouse.move(px, py);
    await sleep(page, ms / steps);
  }
  cur = { x, y };
}

async function centerOf(
  page: Page,
  selector: string,
): Promise<{ x: number; y: number }> {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`no bounding box for ${selector}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Glide to an element and click it, with a press dip + ripple. */
export async function clickEl(
  page: Page,
  selector: string,
  glideMs = 650,
): Promise<void> {
  const { x, y } = await centerOf(page, selector);
  await clickXY(page, x, y, glideMs);
}

/** Glide to a screen coordinate and click it (e.g. a projected chart feature). */
export async function clickXY(
  page: Page,
  x: number,
  y: number,
  glideMs = 700,
): Promise<void> {
  await glideTo(page, x, y, glideMs);
  await page.evaluate(() =>
    (window as unknown as CursorWindow).__pcPress(true),
  );
  await page.evaluate(
    ([x, y]) => (window as unknown as CursorWindow).__pcRipple(x, y),
    [x, y],
  );
  await page.mouse.down();
  await sleep(page, 110);
  await page.mouse.up();
  await page.evaluate(() =>
    (window as unknown as CursorWindow).__pcPress(false),
  );
}

/** Press and hold at an element for `holdMs` (e.g. a hold-to-confirm gesture). */
export async function holdEl(
  page: Page,
  selector: string,
  holdMs: number,
  glideMs = 650,
): Promise<void> {
  const { x, y } = await centerOf(page, selector);
  await holdXY(page, x, y, holdMs, glideMs);
}

/** Press and hold at a screen coordinate for `holdMs`. */
export async function holdXY(
  page: Page,
  x: number,
  y: number,
  holdMs: number,
  glideMs = 650,
): Promise<void> {
  await glideTo(page, x, y, glideMs);
  await page.evaluate(() =>
    (window as unknown as CursorWindow).__pcPress(true),
  );
  await page.mouse.down();
  await sleep(page, holdMs);
  await page.mouse.up();
  await page.evaluate(() =>
    (window as unknown as CursorWindow).__pcPress(false),
  );
}

/** Glide onto an element and drag it to a horizontal fraction of its own width. */
export async function dragHoriz(
  page: Page,
  selector: string,
  fromFrac: number,
  toFrac: number,
  ms = 1600,
): Promise<void> {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`no bounding box for ${selector}`);
  const y = box.y + box.height / 2;
  const fromX = box.x + box.width * fromFrac;
  const toX = box.x + box.width * toFrac;
  await glideTo(page, fromX, y, 600);
  await page.evaluate(() =>
    (window as unknown as CursorWindow).__pcPress(true),
  );
  await page.mouse.down();
  const steps = Math.max(16, Math.round(ms / 20));
  for (let i = 1; i <= steps; i++) {
    const t = ease(i / steps);
    const px = fromX + (toX - fromX) * t;
    await page.evaluate(
      ([px, y]) => (window as unknown as CursorWindow).__pcMove(px, y),
      [px, y],
    );
    await page.mouse.move(px, y);
    await sleep(page, ms / steps);
  }
  await page.mouse.up();
  await page.evaluate(() =>
    (window as unknown as CursorWindow).__pcPress(false),
  );
  cur = { x: toX, y };
}

/** Reset tracked position (call after a reload re-centers the overlay). */
export function resetCursor(): void {
  cur = { x: 60, y: 60 };
}
