/**
 * Enlarged chart-symbol PNGs for inline use in the user guide, rendered
 * from the color-applied day-theme sprite SVGs. Those are generated files:
 * run `bun run sprites` first if tools/sprites/s52/day/ is missing.
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
await browser.close();
