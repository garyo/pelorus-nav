/**
 * Mid-pyramid overzoom for imported raster charts.
 *
 * A packed multi-chart archive (tools/pack-charts.ts) spans the union of its
 * charts' zoom ranges, but each chart only has tiles in its own range — a
 * z14-native chart has nothing at z15 even though the archive's maxzoom is
 * 18. MapLibre raster sources only overzoom past the SOURCE's maxzoom, never
 * for missing tiles mid-pyramid, so such charts vanish as you zoom in while
 * their deeper-natived neighbours appear.
 *
 * This protocol wraps the normal PMTiles lookup: on a missing tile it walks
 * up to the nearest present ancestor (a few levels), crops the requested
 * quadrant, and upscales it — per-tile overzoom, so every chart stays
 * visible at its best available resolution. Ocean tiles cost only cached
 * directory lookups; pixels are synthesized (and LRU-cached) solely for
 * tiles that actually have an ancestor.
 */

import { PMTiles, type Protocol } from "pmtiles";

/** Scheme used by imported raster chart sources (see raster-charts.ts). */
export const OVERZOOM_SCHEME = "pmtiles-oz";

/** Walk at most this many levels up; beyond it the upscale is mush. */
const MAX_PARENT_LEVELS = 4;

/** Synthesized tiles kept for pan-back (≈128 × ~40 KB ≈ 5 MB). */
const CACHE_MAX = 128;

/** Source rectangle of tile (z,x,y) within its ancestor dz levels up. */
export function parentQuadrant(
  dz: number,
  x: number,
  y: number,
  parentSize: number,
): { sx: number; sy: number; size: number } {
  const f = 1 << dz;
  const size = parentSize / f;
  return { sx: (x % f) * size, sy: (y % f) * size, size };
}

async function synthesize(
  parentData: ArrayBuffer,
  dz: number,
  x: number,
  y: number,
): Promise<ArrayBuffer> {
  const bmp = await createImageBitmap(new Blob([parentData]));
  const { sx, sy, size } = parentQuadrant(dz, x, y, bmp.width);
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    bmp,
    sx,
    sy,
    size,
    (size * bmp.height) / bmp.width,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  bmp.close();
  const blob = await canvas.convertToBlob({ type: "image/png" });
  return blob.arrayBuffer();
}

/**
 * Build the maplibre protocol handler. Shares the given Protocol's PMTiles
 * instances so OPFS-registered (offline) archives are reused as-is.
 */
export function makeOverzoomHandler(protocol: Protocol) {
  // Dev-only visibility into how tiles are being served (probes read this).
  const stats = { exact: 0, synthesized: 0, empty: 0 };
  if (import.meta.env.DEV) {
    (globalThis as { __ozStats?: typeof stats }).__ozStats = stats;
  }
  const cache = new Map<string, ArrayBuffer>();
  const remember = (key: string, data: ArrayBuffer): ArrayBuffer => {
    cache.set(key, data);
    if (cache.size > CACHE_MAX) {
      const oldest = cache.keys().next().value as string;
      cache.delete(oldest);
    }
    return data;
  };

  return async (params: {
    url: string;
  }): Promise<{ data: ArrayBuffer | Uint8Array | null }> => {
    const m = new RegExp(
      `^${OVERZOOM_SCHEME}://(.+)/(\\d+)/(\\d+)/(\\d+)$`,
    ).exec(params.url);
    if (!m) throw new Error(`Invalid ${OVERZOOM_SCHEME} URL: ${params.url}`);
    const key = m[1];
    const z = +m[2];
    const x = +m[3];
    const y = +m[4];

    let archive = protocol.tiles.get(key);
    if (!archive) {
      archive = new PMTiles(key);
      protocol.tiles.set(key, archive);
    }

    const exact = await archive.getZxy(z, x, y);
    if (exact) {
      stats.exact++;
      return { data: new Uint8Array(exact.data) };
    }

    const cached = cache.get(params.url);
    if (cached) return { data: cached };

    const header = await archive.getHeader();
    for (let dz = 1; dz <= MAX_PARENT_LEVELS; dz++) {
      const pz = z - dz;
      if (pz < header.minZoom) break;
      const parent = await archive.getZxy(pz, x >> dz, y >> dz);
      if (parent) {
        const data = await synthesize(parent.data, dz, x, y);
        stats.synthesized++;
        return { data: remember(params.url, data) };
      }
    }
    stats.empty++;
    return { data: null };
  };
}
