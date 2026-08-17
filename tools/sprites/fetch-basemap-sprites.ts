#!/usr/bin/env bun
/**
 * Download the Protomaps basemap sprite sheets into public/sprites/.
 *
 * The offline street basemap underlay (src/chart/basemap-underlay.ts) renders
 * POI/shield/townspot icons from these sheets, served same-origin so they work
 * offline like the S-52 sprites and glyph fonts. The files are committed to
 * git; re-run only to pick up upstream icon additions (keep the sprite version
 * in step with the @protomaps/basemaps npm package's expected icon names).
 *
 * Usage: bun tools/sprites/fetch-basemap-sprites.ts
 */

const ASSETS_BASE = "https://protomaps.github.io/basemaps-assets/sprites/v4";
// One sheet per display theme's flavor (see flavorName in basemap-underlay.ts):
// day/eink → light, dusk → dark, night → black
const FLAVORS = ["light", "dark", "black"];

const outDir = new URL("../../public/sprites/", import.meta.url).pathname;

for (const flavor of FLAVORS) {
  for (const scale of ["", "@2x"]) {
    for (const ext of ["json", "png"]) {
      const url = `${ASSETS_BASE}/${flavor}${scale}.${ext}`;
      const dest = `${outDir}basemap-${flavor}${scale}.${ext}`;
      const resp = await fetch(url);
      if (!resp.ok) {
        console.error(`FAILED ${url}: HTTP ${resp.status}`);
        process.exit(1);
      }
      await Bun.write(dest, await resp.arrayBuffer());
      console.log(`${url} -> ${dest}`);
    }
  }
}
