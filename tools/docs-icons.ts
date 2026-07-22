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
const bounds = await page.evaluate(async (code: string) => {
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

  // Tight bounding box of the drawn pixels, in CSS px, so the saved PNG
  // has no dead whitespace and centers properly when inlined in text.
  const img = ctx.getImageData(0, 0, 128, 128);
  let minX = 128;
  let minY = 128;
  let maxX = -1;
  let maxY = -1;
  for (let py = 0; py < 128; py++) {
    for (let px = 0; px < 128; px++) {
      if (img.data[(py * 128 + px) * 4 + 3] > 0) {
        if (px < minX) minX = px;
        if (py < minY) minY = py;
        if (px > maxX) maxX = px;
        if (py > maxY) maxY = py;
      }
    }
  }
  return {
    x: Math.floor(minX / 2) - 1,
    y: Math.floor(minY / 2) - 1,
    width: Math.ceil((maxX - minX) / 2) + 2,
    height: Math.ceil((maxY - minY) / 2) + 2,
  };
}, barbScript);
const barbPath = `${OUT}/wind-barb-s15.png`;
await page.screenshot({ path: barbPath, omitBackground: true, clip: bounds });
console.log(`✓ ${barbPath}`);

// Plotting symbols (DR / Fix / EP / R.Fix), drawn by the app's own
// SHAPE_DRAWERS at 3× their on-chart size.
const plotBundle = await Bun.build({
  entrypoints: [
    new URL("../src/map/plotting/plot-icons.ts", import.meta.url).pathname,
  ],
  target: "browser",
  format: "esm",
});
const plotScript = await plotBundle.outputs[0].text();
const SCALE = 3;
const plotPage = await browser.newPage({
  viewport: { width: 24 * SCALE, height: 24 * SCALE },
  deviceScaleFactor: 2,
});
for (const shape of ["half-circle", "circle", "square", "triangle"]) {
  await plotPage.setContent(
    "<style>body{margin:0}</style>" +
      `<canvas id="c" width="${24 * SCALE * 2}" height="${24 * SCALE * 2}" style="width:${24 * SCALE}px;height:${24 * SCALE}px"></canvas>`,
  );
  const shapeBounds = await plotPage.evaluate(
    async (arg: { code: string; shape: string; scale: number }) => {
      const url = URL.createObjectURL(
        new Blob([arg.code], { type: "text/javascript" }),
      );
      const mod = (await import(url)) as {
        SHAPE_DRAWERS: Record<string, (ctx: CanvasRenderingContext2D) => void>;
      };
      const ctx = document
        .querySelector<HTMLCanvasElement>("#c")
        ?.getContext("2d");
      if (!ctx) throw new Error("no canvas context");
      ctx.scale(2 * arg.scale, 2 * arg.scale);
      mod.SHAPE_DRAWERS[arg.shape](ctx);

      const n = 24 * arg.scale * 2;
      const img = ctx.getImageData(0, 0, n, n);
      let minX = n;
      let minY = n;
      let maxX = -1;
      let maxY = -1;
      for (let py = 0; py < n; py++) {
        for (let px = 0; px < n; px++) {
          if (img.data[(py * n + px) * 4 + 3] > 0) {
            if (px < minX) minX = px;
            if (py < minY) minY = py;
            if (px > maxX) maxX = px;
            if (py > maxY) maxY = py;
          }
        }
      }
      return {
        x: Math.floor(minX / 2) - 1,
        y: Math.floor(minY / 2) - 1,
        width: Math.ceil((maxX - minX) / 2) + 2,
        height: Math.ceil((maxY - minY) / 2) + 2,
      };
    },
    { code: plotScript, shape, scale: SCALE },
  );
  const path = `${OUT}/plot-${shape}.png`;
  await plotPage.screenshot({
    path,
    omitBackground: true,
    clip: shapeBounds,
  });
  console.log(`✓ ${path}`);
}

await browser.close();
