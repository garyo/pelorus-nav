/**
 * Create stub chart artifacts for environments without built tiles (CI).
 *
 * The chart-load monitor (rightly) raises a failure banner when chart
 * archives 404 — on CI, where real PMTiles are absent (gitignored, served
 * from R2 in production), that banner appears in every E2E test and can
 * intercept unrelated clicks. This copies the tiny committed e2e PMTiles
 * fixture over every missing catalog archive (its mid-Pacific bounds mean
 * sources load cleanly and no tile data is ever requested) and writes empty
 * coverage GeoJSONs. Existing files are never touched, so it's a no-op on a
 * dev machine with real tiles built.
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.env.STUB_DIR ?? "public";
const fixture = "tests/e2e/fixtures/import-fixture.pmtiles";
const regions = JSON.parse(readFileSync("tools/regions.json", "utf8")) as {
  id: string;
}[];

const pmtiles = [
  ...regions.map((r) => `nautical-${r.id}.pmtiles`),
  "rnc-bvi.pmtiles",
];
const geojsons = [
  ...regions.map((r) => `nautical-${r.id}.coverage.geojson`),
  "nautical-unified.coverage.geojson",
  "rnc-bvi.coverage.geojson",
];

let stubbed = 0;
for (const name of pmtiles) {
  const path = join(dir, name);
  if (!existsSync(path)) {
    copyFileSync(fixture, path);
    stubbed++;
  }
}
const emptyFC = JSON.stringify({ type: "FeatureCollection", features: [] });
for (const name of geojsons) {
  const path = join(dir, name);
  if (!existsSync(path)) {
    writeFileSync(path, emptyFC);
    stubbed++;
  }
}
console.log(
  stubbed === 0
    ? "e2e-stub-charts: all chart artifacts present — nothing to do"
    : `e2e-stub-charts: stubbed ${stubbed} missing chart artifact(s) in ${dir}/`,
);
