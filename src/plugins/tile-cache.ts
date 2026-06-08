/**
 * Reusable cached XYZ-tile MapLibre protocol for plugins.
 *
 * Generalizes the OSM tile cache (`src/chart/osm-tile-cache.ts`): a custom
 * `scheme://` protocol that fetches raster tiles, caches them in the Cache API
 * (so tiles browsed online stay available offline), and serves stale tiles when
 * the network is down. The upstream URL is built from a plugin-supplied
 * function that may read live plugin state (API key, selected layer); returning
 * `null` yields a transparent tile (e.g. when no API key is set yet) instead of
 * an error.
 *
 * Exposed to plugins as `host.data.registerTileCache(...)`.
 */

import type { GetResourceResponse, RequestParameters } from "maplibre-gl";
import { addProtocol, removeProtocol } from "maplibre-gl";

const CACHED_AT_HEADER = "x-pelorus-cached-at";
const DEFAULT_MAX_TILES = 2000;
const TRIM_EVERY = 64;

/** 1×1 transparent PNG, served when there is no upstream URL (e.g. no key). */
const BLANK_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function blankTile(): ArrayBuffer {
  const bin = atob(BLANK_PNG_BASE64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export interface TileCacheOptions {
  /** URL scheme, e.g. "owmtiles". Must be unique across plugins. */
  scheme: string;
  /**
   * Build the upstream tile URL from z/x/y and the `rest` path segment (e.g. the
   * layer name). Return `null` to serve a transparent tile (no error).
   */
  upstream: (z: number, x: number, y: number, rest: string) => string | null;
  /** Cache API bucket name. */
  cacheName: string;
  /** Tiles older than this are refreshed when online (served stale offline). */
  maxAgeMs: number;
  /** Cap on cached tiles (FIFO eviction). */
  maxTiles?: number;
}

export interface TileCacheHandle {
  /** Build a source `tiles` template for a given `rest` segment. */
  template(rest: string): string;
  /** Unregister the protocol (on plugin deactivate). */
  dispose(): void;
}

/** Parse a `scheme://<rest>/<z>/<x>/<y>` request URL. Exported for tests. */
export function parseTileRequest(
  scheme: string,
  url: string,
): { rest: string; z: number; x: number; y: number } | null {
  const m = url.match(new RegExp(`^${scheme}://(.+)/(\\d+)/(\\d+)/(\\d+)$`));
  if (!m) return null;
  return { rest: m[1], z: Number(m[2]), x: Number(m[3]), y: Number(m[4]) };
}

async function openCache(name: string): Promise<Cache | null> {
  try {
    if (typeof caches === "undefined") return null;
    return await caches.open(name);
  } catch {
    return null; // insecure context — plain fetch still works
  }
}

function isFresh(cached: Response, maxAgeMs: number): boolean {
  const at = Number(cached.headers.get(CACHED_AT_HEADER));
  return Number.isFinite(at) && Date.now() - at < maxAgeMs;
}

let storesSinceTrim = 0;

async function storeTile(
  cache: Cache,
  url: string,
  data: ArrayBuffer,
  maxTiles: number,
): Promise<void> {
  try {
    await cache.put(
      url,
      new Response(data, {
        headers: {
          "content-type": "image/png",
          [CACHED_AT_HEADER]: String(Date.now()),
        },
      }),
    );
    if (++storesSinceTrim >= TRIM_EVERY) {
      storesSinceTrim = 0;
      const keys = await cache.keys();
      // keys() is insertion-ordered in Chromium → approximate FIFO eviction.
      for (const key of keys.slice(0, Math.max(0, keys.length - maxTiles))) {
        await cache.delete(key);
      }
    }
  } catch {
    // Quota exceeded — the tile still renders this session.
  }
}

/** Register a cached-tile protocol. Returns a template builder + disposer. */
export function createTileCacheProtocol(
  opts: TileCacheOptions,
): TileCacheHandle {
  const maxTiles = opts.maxTiles ?? DEFAULT_MAX_TILES;

  const loadTile = async (
    params: RequestParameters,
    abort: AbortController,
  ): Promise<GetResourceResponse<ArrayBuffer>> => {
    const parsed = parseTileRequest(opts.scheme, params.url);
    if (!parsed) throw new Error(`Bad ${opts.scheme} URL: ${params.url}`);
    const url = opts.upstream(parsed.z, parsed.x, parsed.y, parsed.rest);
    if (!url) return { data: blankTile() };

    const cache = await openCache(opts.cacheName);
    const cached = (await cache?.match(url)) ?? null;
    if (cached && isFresh(cached, opts.maxAgeMs)) {
      return { data: await cached.arrayBuffer() };
    }
    try {
      const resp = await fetch(url, { signal: abort.signal });
      if (!resp.ok)
        throw new Error(`${opts.scheme} fetch failed: ${resp.status}`);
      const data = await resp.arrayBuffer();
      if (cache) void storeTile(cache, url, data, maxTiles);
      return { data };
    } catch (err) {
      if (cached) return { data: await cached.arrayBuffer() }; // stale offline
      throw err;
    }
  };

  addProtocol(opts.scheme, loadTile);
  return {
    template: (rest: string) => `${opts.scheme}://${rest}/{z}/{x}/{y}`,
    dispose: () => removeProtocol(opts.scheme),
  };
}
