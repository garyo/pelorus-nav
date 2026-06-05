#!/usr/bin/env bun
/**
 * Extract a mini bundle from public/tides-stations.json for unit tests
 * (src/tides/__fixtures__/mini-bundle.json). Re-run after regenerating
 * the bundle so the fixture stays in the production format.
 *
 * Usage: bun tools/tides/make-fixture.ts
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TidesBundle } from "../../src/tides/schema.ts";

const root = join(import.meta.dirname, "../..");
const bundle = JSON.parse(
  await readFile(join(root, "public/tides-stations.json"), "utf8"),
) as TidesBundle;

const TIDE_REF = ["8443970"]; // Boston
const TIDE_SUB = ["8444351"]; // Hull (ref Boston)
const CURRENT_REF = ["BOS1111"]; // Boston Harbor (Deer Island Light)
const CURRENT_SUB = ["ACT0926"]; // Bass Point (ref BOS1111 bin 14)

const mini: TidesBundle = {
  version: bundle.version,
  generated: bundle.generated,
  constituents: bundle.constituents,
  tideRef: bundle.tideRef.filter((s) => TIDE_REF.includes(s.id)),
  tideSub: bundle.tideSub.filter((s) => TIDE_SUB.includes(s.id)),
  currentRef: bundle.currentRef.filter((s) => CURRENT_REF.includes(s.id)),
  currentSub: bundle.currentSub.filter((s) => CURRENT_SUB.includes(s.id)),
};

for (const [kind, want, got] of [
  ["tideRef", TIDE_REF.length, mini.tideRef.length],
  ["tideSub", TIDE_SUB.length, mini.tideSub.length],
  ["currentRef", CURRENT_REF.length, mini.currentRef.length],
  ["currentSub", CURRENT_SUB.length, mini.currentSub.length],
] as const) {
  if (got < want) throw new Error(`fixture: missing ${kind} station`);
}

const out = join(root, "src/tides/__fixtures__/mini-bundle.json");
await writeFile(out, JSON.stringify(mini, null, 1));
console.log(`Wrote ${out}`);
