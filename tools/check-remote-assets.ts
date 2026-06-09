#!/usr/bin/env bun

/**
 * Post-upload / post-deploy asset check.
 *
 * Derives the expected list of remote chart assets from the catalog
 * (src/data/chart-catalog.ts — the same source the app uses) and HEADs each one
 * against the production origin, flagging anything missing. Catches the failure
 * mode where a region/basemap/raster chart is built but never uploaded to R2, so
 * the app silently 404s ("failed to fetch") for that asset.
 *
 * Usage:
 *   bun tools/check-remote-assets.ts [baseUrl]
 *   bun tools/check-remote-assets.ts https://pelorus-nav.com   (default)
 *
 * Exit code is non-zero if any REQUIRED asset is missing, so it can gate a
 * deploy/upload flow. Missing OPTIONAL assets (search indices, raster coverage)
 * are reported as warnings only.
 */

import { CHART_REGIONS, RASTER_CHARTS } from "../src/data/chart-catalog";

const DEFAULT_ORIGIN = "https://pelorus-nav.com";
// Kept in sync with VectorChartProvider.UNIFIED_COVERAGE_FILENAME (not imported
// to avoid pulling MapLibre into this Node-side script).
const UNIFIED_COVERAGE = "nautical-unified.coverage.geojson";

interface Asset {
  name: string;
  required: boolean;
  note: string;
}

function expectedAssets(): Asset[] {
  const assets: Asset[] = [
    { name: UNIFIED_COVERAGE, required: true, note: "unified coverage" },
  ];

  for (const r of CHART_REGIONS) {
    assets.push({ name: r.filename, required: true, note: `${r.id} tiles` });
    assets.push({
      name: r.coverageFilename,
      required: true,
      note: `${r.id} coverage`,
    });
    assets.push({
      name: r.filename.replace(".pmtiles", ".search.json"),
      required: false,
      note: `${r.id} search index`,
    });
    if (r.basemapFilename) {
      assets.push({
        name: r.basemapFilename,
        required: true,
        note: `${r.id} street basemap`,
      });
    }
  }

  for (const c of RASTER_CHARTS) {
    assets.push({
      name: c.filename,
      required: true,
      note: `${c.id} raster tiles`,
    });
    assets.push({
      name: c.coverageFilename,
      required: false,
      note: `${c.id} raster coverage`,
    });
  }

  return assets;
}

type Result = Asset & { status: number; ok: boolean };

async function check(origin: string, asset: Asset): Promise<Result> {
  const url = `${origin}/${asset.name}`;
  let status = 0;
  try {
    const res = await fetch(url, { method: "HEAD" });
    status = res.status;
  } catch {
    status = 0; // network error / DNS / connection refused
  }
  return { ...asset, status, ok: status === 200 };
}

async function main(): Promise<void> {
  const origin = (process.argv[2] ?? DEFAULT_ORIGIN).replace(/\/$/, "");
  const assets = expectedAssets();
  console.log(
    `Checking ${assets.length} catalog assets against ${origin} ...\n`,
  );

  // Bounded concurrency so we don't open dozens of sockets at once.
  const results: Result[] = [];
  const queue = [...assets];
  const workers = Array.from({ length: 8 }, async () => {
    for (let a = queue.shift(); a; a = queue.shift()) {
      results.push(await check(origin, a));
    }
  });
  await Promise.all(workers);
  results.sort((x, y) => x.name.localeCompare(y.name));

  const missingRequired = results.filter((r) => !r.ok && r.required);
  const missingOptional = results.filter((r) => !r.ok && !r.required);
  const present = results.filter((r) => r.ok);

  for (const r of missingRequired) {
    console.log(
      `  ✗ MISSING   ${r.name}  (${r.note}) — HTTP ${r.status || "no response"}`,
    );
  }
  for (const r of missingOptional) {
    console.log(
      `  ⚠ optional  ${r.name}  (${r.note}) — HTTP ${r.status || "no response"}`,
    );
  }
  console.log(
    `\n${present.length}/${results.length} present · ` +
      `${missingRequired.length} required missing · ` +
      `${missingOptional.length} optional missing`,
  );

  if (missingRequired.length > 0) {
    console.log(
      "\nFix: build + upload the missing files (tools/build-tiles.sh).",
    );
    process.exit(1);
  }
  console.log("All required assets are present. ✓");
}

main();
