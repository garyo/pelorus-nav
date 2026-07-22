/**
 * Enlarged chart-symbol PNGs for inline use in the user guide: station
 * icons rendered from the color-applied day-theme sprite SVGs (generated
 * files — run `bun run sprites` first if tools/sprites/s52/day/ is
 * missing), plus an example wind barb drawn by the app's own glyph code
 * (src/plugins/wind/wind-barb.ts) so it can never drift from the overlay.
 *
 * Run: bun tools/docs-icons.ts
 * Output: docs-site/public/images/icons/<name>.png (committed to git).
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright";

const ICONS = ["PELTIDG0", "PELTIDG2", "PELTIDG4", "PELCUR03", "PELSLK01"];
const SIZE = 64; // CSS px; rendered @2x → 128px PNG

const SRC = new URL("./sprites/s52/day/", import.meta.url);
const OUT = new URL("../docs-site/public/images/icons", import.meta.url)
  .pathname;

if (!existsSync(new URL(`${ICONS[0]}.svg`, SRC))) {
  throw new Error(
    "tools/sprites/s52/day/ not built — run `bun run sprites` first",
  );
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: SIZE, height: SIZE },
  deviceScaleFactor: 2,
});
for (const name of ICONS) {
  const svg = readFileSync(new URL(`${name}.svg`, SRC), "utf8");
  const b64 = Buffer.from(svg).toString("base64");
  await page.setContent(
    `<style>body{margin:0}</style>` +
      `<img src="data:image/svg+xml;base64,${b64}" width="${SIZE}" height="${SIZE}">`,
  );
  const path = `${OUT}/${name.toLowerCase()}.png`;
  await page.screenshot({ path, omitBackground: true });
  console.log(`✓ ${path}`);
}

// Example wind barb: 15 kt out of the south (staff pointing down-wind-ward,
// i.e. south, feathers at the southern tip). Rendered by the app's own
// barbImage(), rotated 180° from its north-wind orientation.
const bundle = await Bun.build({
  entrypoints: [
    new URL("../src/plugins/wind/wind-barb.ts", import.meta.url).pathname,
  ],
  target: "browser",
  format: "esm",
});
const barbScript = await bundle.outputs[0].text();
await page.setContent(
  "<style>body{margin:0}</style>" +
    '<canvas id="c" width="128" height="128" style="width:64px;height:64px"></canvas>',
);
await page.evaluate(async (code: string) => {
  const url = URL.createObjectURL(
    new Blob([code], { type: "text/javascript" }),
  );
  const mod = (await import(url)) as {
    barbImage(kt: number): {
      width: number;
      height: number;
      data: Uint8Array;
    };
  };
  const barb = mod.barbImage(15);
  const tmp = document.createElement("canvas");
  tmp.width = barb.width;
  tmp.height = barb.height;
  const tctx = tmp.getContext("2d");
  const ctx = document.querySelector<HTMLCanvasElement>("#c")?.getContext("2d");
  if (!tctx || !ctx) throw new Error("no canvas context");
  tctx.putImageData(
    new ImageData(new Uint8ClampedArray(barb.data), barb.width, barb.height),
    0,
    0,
  );
  ctx.translate(64, 64);
  ctx.rotate(Math.PI);
  ctx.drawImage(tmp, -64, -64);
}, barbScript);
const barbPath = `${OUT}/wind-barb-s15.png`;
await page.locator("#c").screenshot({ path: barbPath, omitBackground: true });
console.log(`✓ ${barbPath}`);

await browser.close();
