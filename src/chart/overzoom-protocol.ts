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

/**
 * Cheap opacity check from the image container header, without decoding:
 * JPEG can't carry alpha; PNG colour types 0 (grey) and 2 (RGB) have no
 * alpha channel (a rare tRNS chunk is ignored). Returns null for "might
 * be transparent — decode and look".
 */
export function opaqueByHeader(bytes: Uint8Array): boolean | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return true;
  if (bytes.length > 25 && bytes[0] === 0x89 && bytes[1] === 0x50) {
    const colorType = bytes[25];
    if (colorType === 0 || colorType === 2) return true;
  }
  return null;
}

function fullyOpaque(ctx: OffscreenCanvasRenderingContext2D): boolean {
  const { width, height } = ctx.canvas;
  const px = ctx.getImageData(0, 0, width, height).data;
  for (let i = 3; i < px.length; i += 4) {
    if (px[i] !== 255) return false;
  }
  return true;
}

/**
 * Build the maplibre protocol handler. Shares the given Protocol's PMTiles
 * instances so OPFS-registered (offline) archives are reused as-is.
 */
export function makeOverzoomHandler(protocol: Protocol) {
  // Dev-only visibility into how tiles are being served (probes read this).
  const stats = { exact: 0, composited: 0, synthesized: 0, empty: 0 };
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
    // Fast path: a tile with no alpha channel can't need an underlay.
    if (exact && opaqueByHeader(new Uint8Array(exact.data))) {
      stats.exact++;
      return { data: new Uint8Array(exact.data) };
    }

    const cached = cache.get(params.url);
    if (cached) return { data: cached };

    // A present tile can still be transparent where a NEIGHBOURING chart's
    // sliver owns the tile address — the coarser chart underneath must show
    // through. Composite: upscaled ancestors (coarsest first), exact on top.
    const exactBmp = exact
      ? await createImageBitmap(new Blob([exact.data]))
      : null;
    const size = exactBmp?.width ?? 256;
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    if (exactBmp) {
      // Decoded alpha check: fully opaque → serve the original bytes
      // untouched (no re-encode).
      ctx.drawImage(exactBmp, 0, 0, size, size);
      if (fullyOpaque(ctx)) {
        exactBmp.close();
        stats.exact++;
        return { data: new Uint8Array((exact as { data: ArrayBuffer }).data) };
      }
      ctx.clearRect(0, 0, size, size);
    }

    const header = await archive.getHeader();
    const ancestors: { bmp: ImageBitmap; dz: number }[] = [];
    for (let dz = 1; dz <= MAX_PARENT_LEVELS; dz++) {
      const pz = z - dz;
      if (pz < header.minZoom) break;
      const parent = await archive.getZxy(pz, x >> dz, y >> dz);
      if (parent) {
        ancestors.push({
          bmp: await createImageBitmap(new Blob([parent.data])),
          dz,
        });
      }
    }

    if (ancestors.length === 0 && !exactBmp) {
      stats.empty++;
      return { data: null };
    }

    for (const { bmp, dz } of ancestors.reverse()) {
      // coarsest first, finer detail over it
      const q = parentQuadrant(dz, x, y, bmp.width);
      ctx.drawImage(bmp, q.sx, q.sy, q.size, q.size, 0, 0, size, size);
      bmp.close();
    }
    if (exactBmp) {
      ctx.drawImage(exactBmp, 0, 0, size, size);
      exactBmp.close();
      stats.composited++;
    } else {
      stats.synthesized++;
    }
    const blob = await canvas.convertToBlob({ type: "image/png" });
    return { data: remember(params.url, await blob.arrayBuffer()) };
  };
}
