/**
 * True coverage footprint of a raster PMTiles archive.
 *
 * Imported charts (Sat2Chart-style) are usually stitched from several
 * rectangles, so the tile set at a given zoom is an irregular blob — the
 * bbox alone overstates coverage. The archive's directory lists exactly
 * which tiles exist; the union of those tile squares, traced along its
 * boundary, is the real footprint. Used for the dashed outline drawn
 * below a chart's minZoom (see raster-charts.ts).
 */

import { type Entry, type PMTiles, tileIdToZxy } from "pmtiles";

/** Give up and fall back to the bbox above this many directory entries. */
const ENUMERATION_CAP = 100_000;
/** Trace the footprint at the deepest zoom with at most this many tiles. */
const CELL_BUDGET = 4096;

/** Tile-corner (x, y) at zoom z → [lon, lat]. */
function cornerToLonLat(x: number, y: number, z: number): [number, number] {
  const n = 2 ** z;
  const lon = (x / n) * 360 - 180;
  const lat =
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  return [lon, lat];
}

/** [lon, lat] → containing tile (x, y) at zoom z (slippy scheme). */
export function lonLatToCell(
  lon: number,
  lat: number,
  z: number,
): [number, number] {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  );
  const clamp = (v: number) => Math.min(n - 1, Math.max(0, v));
  return [clamp(x), clamp(y)];
}

/** Drop intermediate points along straight runs of a closed corner path. */
function dropCollinear(corners: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < corners.length; i++) {
    const prev = corners[(i - 1 + corners.length) % corners.length];
    const cur = corners[i];
    const next = corners[(i + 1) % corners.length];
    const straight =
      (prev[0] === cur[0] && cur[0] === next[0]) ||
      (prev[1] === cur[1] && cur[1] === next[1]);
    if (!straight) out.push(cur);
  }
  return out;
}

/**
 * Trace the boundary of a set of grid cells ("x,y" keys) into closed rings
 * of [lon, lat] points. Disjoint areas and holes each yield their own ring.
 */
export function cellsToRings(
  cells: Set<string>,
  z: number,
): [number, number][][] {
  // Directed boundary edges (start corner → end corners). Directions are
  // chosen consistently (clockwise around each cell in tile space) so that
  // every boundary vertex has equal in- and out-degree and rings must close.
  const edges = new Map<string, string[]>();
  const addEdge = (from: string, to: string) => {
    const list = edges.get(from);
    if (list) list.push(to);
    else edges.set(from, [to]);
  };
  for (const cell of cells) {
    const [x, y] = cell.split(",").map(Number);
    if (!cells.has(`${x},${y - 1}`)) addEdge(`${x},${y}`, `${x + 1},${y}`);
    if (!cells.has(`${x + 1},${y}`))
      addEdge(`${x + 1},${y}`, `${x + 1},${y + 1}`);
    if (!cells.has(`${x},${y + 1}`))
      addEdge(`${x + 1},${y + 1}`, `${x},${y + 1}`);
    if (!cells.has(`${x - 1},${y}`)) addEdge(`${x},${y + 1}`, `${x},${y}`);
  }

  const rings: [number, number][][] = [];
  while (edges.size > 0) {
    const start = edges.keys().next().value as string;
    const corners: [number, number][] = [];
    let cur = start;
    do {
      const outs = edges.get(cur);
      if (!outs) break; // defensive: malformed edge set
      const next = outs.pop() as string;
      if (outs.length === 0) edges.delete(cur);
      const [cx, cy] = cur.split(",").map(Number);
      corners.push([cx, cy]);
      cur = next;
    } while (cur !== start);
    const ring = dropCollinear(corners).map(([x, y]) =>
      cornerToLonLat(x, y, z),
    );
    ring.push(ring[0]); // close
    rings.push(ring);
  }
  return rings;
}

/**
 * Enumerate the archive's tile directory into per-zoom cell sets ("x,y"
 * keys). Returns null when the archive is too large to enumerate cheaply.
 */
export async function enumerateCellsByZoom(
  archive: PMTiles,
): Promise<Map<number, Set<string>> | null> {
  const header = await archive.getHeader();
  const byZoom = new Map<number, Set<string>>();
  let total = 0;
  const addRun = (entry: Entry): boolean => {
    for (let i = 0; i < entry.runLength; i++) {
      if (++total > ENUMERATION_CAP) return false;
      const [z, x, y] = tileIdToZxy(entry.tileId + i);
      let cells = byZoom.get(z);
      if (!cells) {
        cells = new Set();
        byZoom.set(z, cells);
      }
      cells.add(`${x},${y}`);
    }
    return true;
  };

  const root = await archive.cache.getDirectory(
    archive.source,
    header.rootDirectoryOffset,
    header.rootDirectoryLength,
    header,
  );
  for (const entry of root) {
    if (entry.runLength === 0) {
      // Leaf-directory pointer
      const leaf = await archive.cache.getDirectory(
        archive.source,
        header.leafDirectoryOffset + entry.offset,
        entry.length,
        header,
      );
      for (const leafEntry of leaf) {
        if (!addRun(leafEntry)) return null;
      }
    } else if (!addRun(entry)) {
      return null;
    }
  }
  return byZoom;
}

/**
 * Trace the archive's coverage boundary. Coverage is the UNION across all
 * zoom levels — in a packed multi-chart archive each zoom exists only where
 * some chart has tiles (one chart's native z18, another's z14), so no single
 * level sees the whole collection. Cells are normalized to the finest
 * working zoom whose expanded union fits the cell budget. Returns null when
 * the archive is too large to enumerate cheaply (caller falls back to bbox).
 */
export async function computeFootprint(
  archive: PMTiles,
): Promise<[number, number][][] | null> {
  const byZoom = await enumerateCellsByZoom(archive);
  return byZoom ? footprintFromCells(byZoom) : null;
}

/** Pure core of computeFootprint (unit-tested separately). */
export function footprintFromCells(
  byZoom: Map<number, Set<string>>,
): [number, number][][] | null {
  if (byZoom.size === 0) return null;
  const zooms = [...byZoom.keys()].sort((a, b) => a - b);
  const minZ = zooms[0];
  const maxZ = zooms[zooms.length - 1];

  // Finest working zoom W whose union fits the budget, using the no-dedup
  // upper bound (cells coarser than W expand 4x per level; deeper shrink).
  let w = maxZ;
  while (w > minZ) {
    let bound = 0;
    for (const z of zooms) {
      bound += (byZoom.get(z) as Set<string>).size * 4 ** Math.max(0, w - z);
    }
    if (bound <= CELL_BUDGET) break;
    w--;
  }

  const cells = new Set<string>();
  for (const z of zooms) {
    for (const key of byZoom.get(z) as Set<string>) {
      const [x, y] = key.split(",").map(Number);
      if (z >= w) {
        cells.add(`${x >> (z - w)},${y >> (z - w)}`);
      } else {
        const f = 2 ** (w - z);
        for (let dx = 0; dx < f; dx++) {
          for (let dy = 0; dy < f; dy++) {
            cells.add(`${x * f + dx},${y * f + dy}`);
          }
        }
      }
    }
  }
  return cellsToRings(cells, w);
}
