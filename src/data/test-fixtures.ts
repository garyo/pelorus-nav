/**
 * Test-only helpers for loading checked-in track fixtures from
 * tests/fixtures/tracks/. Production code must not import this module.
 *
 * Reads via Node's `fs` and parses with `parseGpx`, so callers must run
 * under a DOM-providing test environment (`@vitest-environment jsdom`).
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseGpx } from "./gpx";
import type { TrackPoint } from "./Track";

const HERE = dirname(fileURLToPath(import.meta.url));
// src/data/ → ../../tests/fixtures/tracks/
const FIXTURES_DIR = resolve(HERE, "..", "..", "tests", "fixtures", "tracks");

/**
 * Load a GPX fixture and return the first track's points. The fixture
 * `name` is the file name (with or without `.gpx`) under
 * tests/fixtures/tracks/.
 */
export function loadTrackFixture(name: string): TrackPoint[] {
  const file = name.endsWith(".gpx") ? name : `${name}.gpx`;
  const xml = readFileSync(resolve(FIXTURES_DIR, file), "utf8");
  const result = parseGpx(xml);
  if (result.tracks.length === 0) {
    throw new Error(`Fixture ${file} contains no tracks`);
  }
  return result.tracks[0].points;
}
