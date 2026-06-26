/**
 * Generate the S-57 test chart from catalog.ts:
 *   - out/geojson/{CLASS}.geojson  — one FeatureCollection per S-57 class
 *   - out/manifest.json            — every variant + its grid position
 *   - out/test-chart.pmtiles       — built via tippecanoe (one layer per class),
 *                                    also copied to public/ for the dev server
 *
 * Each variant is placed in its own grid cell so features never overlap, which
 * keeps renders and click-tests unambiguous. Run: `bun tools/s57-test-chart/generate.ts`
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { $ } from "bun";
import { buildVariants, type Geom, type Variant } from "./catalog";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
const GEOJSON_DIR = join(OUT, "geojson");
const PUBLIC = join(HERE, "..", "..", "public");

// Grid layout (near Boston so it sits inside a real chart region's lat band).
const ORIGIN_LNG = -71.0;
const ORIGIN_LAT = 42.0;
const SPACING = 0.012; // degrees between cell centers
const HALF = 0.0035; // half-size of line/polygon geometry within a cell

interface ManifestEntry extends Variant {
  lng: number;
  lat: number;
}

function geometryFor(geom: Geom, lng: number, lat: number) {
  switch (geom) {
    case "Point":
      return { type: "Point", coordinates: [lng, lat] };
    case "LineString":
      return {
        type: "LineString",
        coordinates: [
          [lng - HALF, lat],
          [lng + HALF, lat],
        ],
      };
    case "Polygon":
      return {
        type: "Polygon",
        coordinates: [
          [
            [lng - HALF, lat - HALF],
            [lng + HALF, lat - HALF],
            [lng + HALF, lat + HALF],
            [lng - HALF, lat + HALF],
            [lng - HALF, lat - HALF],
          ],
        ],
      };
  }
}

function main() {
  const variants = buildVariants();
  const cols = Math.ceil(Math.sqrt(variants.length));

  // Reset output dir
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(GEOJSON_DIR, { recursive: true });

  const manifest: ManifestEntry[] = [];
  const byClass = new Map<string, object[]>();

  variants.forEach((v, i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const lng = ORIGIN_LNG + col * SPACING;
    const lat = ORIGIN_LAT + row * SPACING;

    const feature = {
      type: "Feature",
      // _scale_band keeps the pipeline's render-order field present; harmless.
      properties: { ...v.properties, _scale_band: 4, _variant_id: v.id },
      geometry: geometryFor(v.geometry, lng, lat),
    };

    if (!byClass.has(v.cls)) byClass.set(v.cls, []);
    byClass.get(v.cls)?.push(feature);
    manifest.push({ ...v, lng, lat });
  });

  // Write one GeoJSON file per class (filename == layer name, pipeline convention)
  const namedLayers: string[] = [];
  for (const [cls, features] of byClass) {
    const path = join(GEOJSON_DIR, `${cls}.geojson`);
    writeFileSync(
      path,
      JSON.stringify({ type: "FeatureCollection", features }),
    );
    namedLayers.push(`-L{"file":"${path}","layer":"${cls}"}`);
  }

  const bbox = {
    minLng: ORIGIN_LNG - HALF,
    minLat: ORIGIN_LAT - HALF,
    maxLng: ORIGIN_LNG + (cols - 1) * SPACING + HALF,
    maxLat: ORIGIN_LAT + Math.floor(variants.length / cols) * SPACING + HALF,
  };
  writeFileSync(
    join(OUT, "manifest.json"),
    JSON.stringify(
      {
        count: variants.length,
        cols,
        spacing: SPACING,
        bbox,
        variants: manifest,
      },
      null,
      2,
    ),
  );

  console.log(
    `Generated ${variants.length} variants across ${byClass.size} S-57 classes.`,
  );
  console.log(`  GeoJSON: ${GEOJSON_DIR}`);
  console.log(`  Manifest: ${join(OUT, "manifest.json")}`);

  // Build PMTiles via tippecanoe (one named layer per class).
  buildPmtiles(namedLayers);
}

async function buildPmtiles(namedLayers: string[]) {
  const out = join(OUT, "test-chart.pmtiles");
  const hasTippecanoe =
    (await $`which tippecanoe`.nothrow().quiet()).exitCode === 0;
  if (!hasTippecanoe) {
    console.warn("\n⚠ tippecanoe not found — skipped PMTiles build.");
    console.warn("  Install with `brew install tippecanoe`, then re-run.");
    console.warn(
      "  (GeoJSON + manifest are still written; renderer needs the PMTiles.)",
    );
    return;
  }
  // -r1/-pf/-pk: keep every feature at every zoom (no dropping) so the test
  // chart is dense-but-complete; -Z0 -z16 for full zoom coverage.
  const args = [
    "-o",
    out,
    "-Z0",
    "-z16",
    "-r1",
    "-pf",
    "-pk",
    "--force",
    ...namedLayers,
  ];
  console.log(`\nBuilding PMTiles: tippecanoe ${args.join(" ")}`);
  const res = await $`tippecanoe ${args}`.nothrow();
  if (res.exitCode !== 0) {
    console.error("tippecanoe failed:", res.stderr.toString());
    return;
  }
  if (existsSync(out)) {
    writeFileSync(
      join(PUBLIC, "test-chart.pmtiles"),
      await Bun.file(out).bytes(),
    );
    console.log(`✓ PMTiles: ${out}`);
    console.log(`✓ Copied to public/test-chart.pmtiles (served by dev server)`);
  }
}

main();
