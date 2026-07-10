#!/usr/bin/env bun
/**
 * Pack a folder of raster .mbtiles charts (Sat2Chart / Soggy Paws / sv Ocelot
 * style collections) into a single .pmtiles for one-shot import into
 * Pelorus Nav (Chart Regions → Load from File…).
 *
 *   bun tools/pack-charts.ts <dir|file>... --list
 *   bun tools/pack-charts.ts <dir|file>... [options] -o <output.pmtiles>
 *
 * Options:
 *   --list             List discovered charts (name, bounds, zooms, tiles) and exit
 *   --bounds W,S,E,N   Only include charts whose bounds intersect this box
 *   --name <name>      Chart name shown in the app (default: output filename)
 *   --overviews <Z>    Build downsampled overview levels per chart down to
 *                      zoom Z before merging (requires gdal; recommended: 12 —
 *                      single-zoom z16/z17 charts are otherwise invisible
 *                      until you zoom all the way in)
 *   -o <file>          Output .pmtiles path
 *
 * Charts are merged tile-by-tile; where two charts provide the same tile
 * (overlapping coverage at the same zoom) the later file in sort order wins.
 * Requires the `pmtiles` CLI (brew install pmtiles); --overviews needs gdal.
 */

import { Database } from "bun:sqlite";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

interface ChartInfo {
  path: string;
  name: string;
  bounds: [number, number, number, number] | null;
  minzoom: number;
  maxzoom: number;
  tiles: number;
  bytes: number;
}

function usage(msg?: string): never {
  if (msg) console.error(`error: ${msg}\n`);
  console.error(
    "usage: bun tools/pack-charts.ts <dir|file>... [--list] [--bounds W,S,E,N]\n" +
      "         [--name <name>] [--overviews <Z>] -o <output.pmtiles>",
  );
  process.exit(1);
}

/** Recursively find .mbtiles under the given paths. */
function discover(paths: string[]): string[] {
  const found: string[] = [];
  const walk = (p: string) => {
    const st = statSync(p);
    if (st.isDirectory()) {
      for (const entry of readdirSync(p)) walk(join(p, entry));
    } else if (p.endsWith(".mbtiles")) {
      found.push(p);
    }
  };
  for (const p of paths) {
    if (!existsSync(p)) usage(`not found: ${p}`);
    walk(resolve(p));
  }
  return found.sort();
}

function readInfo(path: string): ChartInfo {
  const db = new Database(path, { readonly: true });
  try {
    const meta = new Map<string, string>();
    for (const row of db
      .query<{ name: string; value: string }, []>(
        "SELECT name, value FROM metadata",
      )
      .all()) {
      meta.set(row.name, row.value);
    }
    const zooms = db
      .query<{ minz: number; maxz: number; n: number }, []>(
        "SELECT MIN(zoom_level) minz, MAX(zoom_level) maxz, COUNT(*) n FROM tiles",
      )
      .get();
    if (!zooms || zooms.n === 0) usage(`no tiles in ${path}`);
    let bounds: ChartInfo["bounds"] = null;
    const b = meta.get("bounds")?.split(",").map(Number);
    if (b?.length === 4 && b.every((v) => Number.isFinite(v))) {
      bounds = b as [number, number, number, number];
    } else {
      // Compute from the tile grid at max zoom (TMS rows)
      const ext = db
        .query<{ x0: number; x1: number; y0: number; y1: number }, [number]>(
          "SELECT MIN(tile_column) x0, MAX(tile_column) x1, MIN(tile_row) y0, MAX(tile_row) y1 FROM tiles WHERE zoom_level = ?",
        )
        .get(zooms.maxz);
      if (ext) {
        const n = 2 ** zooms.maxz;
        const lon = (x: number) => (x / n) * 360 - 180;
        const lat = (yXyz: number) =>
          (Math.atan(Math.sinh(Math.PI * (1 - (2 * yXyz) / n))) * 180) /
          Math.PI;
        // TMS row → XYZ row: y = n - 1 - tms
        bounds = [
          lon(ext.x0),
          lat(n - ext.y0), // southernmost TMS row's bottom edge
          lon(ext.x1 + 1),
          lat(n - 1 - ext.y1), // northernmost row's top edge
        ];
      }
    }
    return {
      path,
      name: meta.get("name") ?? basename(path, ".mbtiles"),
      bounds,
      minzoom: zooms.minz,
      maxzoom: zooms.maxz,
      tiles: zooms.n,
      bytes: statSync(path).size,
    };
  } finally {
    db.close();
  }
}

function intersects(
  a: [number, number, number, number],
  b: [number, number, number, number],
): boolean {
  return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
}

function run(cmd: string[]): void {
  const proc = Bun.spawnSync(cmd, { stdout: "inherit", stderr: "inherit" });
  if (proc.exitCode !== 0) usage(`command failed: ${cmd.join(" ")}`);
}

// ---- argument parsing -------------------------------------------------
const inputs: string[] = [];
let list = false;
let filterBounds: [number, number, number, number] | null = null;
let outName: string | null = null;
let overviewZoom: number | null = null;
let output: string | null = null;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--list") list = true;
  else if (a === "--bounds") {
    const v = argv[++i]?.split(",").map(Number);
    if (v?.length !== 4 || v.some((x) => !Number.isFinite(x)))
      usage("--bounds needs W,S,E,N");
    filterBounds = v as [number, number, number, number];
  } else if (a === "--name")
    outName = argv[++i] ?? usage("--name needs a value");
  else if (a === "--overviews") {
    overviewZoom = Number(argv[++i]);
    if (!Number.isInteger(overviewZoom)) usage("--overviews needs a zoom");
  } else if (a === "-o") output = argv[++i] ?? usage("-o needs a path");
  else if (a.startsWith("-")) usage(`unknown option ${a}`);
  else inputs.push(a);
}
if (inputs.length === 0) usage("no input files or directories");
if (!list && !output) usage("need -o <output.pmtiles> (or --list)");

// ---- discover + filter -------------------------------------------------
const all = discover(inputs).map(readInfo);
const charts = filterBounds
  ? all.filter((c) => c.bounds && intersects(c.bounds, filterBounds))
  : all;
const skipped = all.length - charts.length;

if (list || charts.length === 0) {
  for (const c of charts) {
    const bb = c.bounds
      ? c.bounds.map((v) => v.toFixed(3)).join(",")
      : "unknown bounds";
    const z =
      c.minzoom === c.maxzoom ? `z${c.minzoom}` : `z${c.minzoom}-${c.maxzoom}`;
    console.log(
      `${c.name.padEnd(32)} ${z.padEnd(7)} ${String(c.tiles).padStart(5)} tiles ` +
        `${(c.bytes / 1e6).toFixed(1).padStart(6)} MB  [${bb}]`,
    );
  }
  console.log(
    `\n${charts.length} charts` +
      (skipped ? ` (${skipped} outside --bounds)` : "") +
      `, ${(charts.reduce((s, c) => s + c.bytes, 0) / 1e6).toFixed(0)} MB total`,
  );
  process.exit(charts.length === 0 ? 1 : 0);
}

// ---- merge --------------------------------------------------------------
const out = output as string;
const work = mkdtempSync(join(tmpdir(), "pack-charts-"));
try {
  const mergedPath = join(work, "merged.mbtiles");
  const merged = new Database(mergedPath, { create: true });
  merged.run(
    "CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB, PRIMARY KEY (zoom_level, tile_column, tile_row)) WITHOUT ROWID",
  );
  merged.run("CREATE TABLE metadata (name TEXT, value TEXT)");

  let minz = Number.POSITIVE_INFINITY;
  let maxz = Number.NEGATIVE_INFINITY;
  const union: [number, number, number, number] = [180, 90, -180, -90];
  for (const chart of charts) {
    let src = chart.path;
    if (overviewZoom !== null && chart.minzoom > overviewZoom) {
      // Per-chart overviews BEFORE merging: each chart's extent is tiny, so
      // gdaladdo is seconds; on the merged file it would scan a region-wide
      // virtual raster at max zoom.
      src = join(work, `ov-${basename(chart.path)}`);
      run(["cp", chart.path, src]);
      const levels: string[] = [];
      for (let z = chart.minzoom - 1; z >= overviewZoom; z--) {
        levels.push(String(2 ** (chart.minzoom - z)));
      }
      console.log(
        `overviews ${chart.name} (z${chart.minzoom} → z${overviewZoom})`,
      );
      run(["gdaladdo", "-q", "-r", "average", src, ...levels]);
    }
    const info = src === chart.path ? chart : readInfo(src);
    minz = Math.min(minz, info.minzoom);
    maxz = Math.max(maxz, info.maxzoom);
    if (chart.bounds) {
      union[0] = Math.min(union[0], chart.bounds[0]);
      union[1] = Math.min(union[1], chart.bounds[1]);
      union[2] = Math.max(union[2], chart.bounds[2]);
      union[3] = Math.max(union[3], chart.bounds[3]);
    }
    merged.run("ATTACH DATABASE ?1 AS src", [src]);
    merged.run(
      "INSERT OR REPLACE INTO tiles SELECT zoom_level, tile_column, tile_row, tile_data FROM src.tiles",
    );
    merged.run("DETACH DATABASE src");
    console.log(`merged   ${chart.name} (${info.tiles} tiles)`);
  }

  const name = outName ?? basename(out, ".pmtiles");
  const metadata: [string, string][] = [
    ["name", name],
    ["format", "png"],
    ["type", "overlay"],
    ["version", "1.0"],
    ["bounds", union.join(",")],
    ["minzoom", String(minz)],
    ["maxzoom", String(maxz)],
  ];
  for (const [k, v] of metadata) {
    merged.run("INSERT INTO metadata VALUES (?1, ?2)", [k, v]);
  }
  merged.close();

  run(["pmtiles", "convert", mergedPath, out]);
  const total = merged ? charts.reduce((s, c) => s + c.tiles, 0) : 0;
  console.log(
    `\nwrote ${out} (${(statSync(out).size / 1e6).toFixed(1)} MB, ` +
      `${charts.length} charts, ~${total} source tiles, z${minz}-${maxz})`,
  );
  console.log("Import it in the app: Chart Regions → Load from File…");
} finally {
  rmSync(work, { recursive: true, force: true });
}
