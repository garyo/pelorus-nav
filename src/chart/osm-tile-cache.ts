/**
 * Cached OSM tile protocol: serves OSM raster tiles through the Cache API so
 * tiles browsed while online stay available offline (airplane mode on the
 * water). Cache-first while fresh; stale tiles are refreshed when online and
 * served as-is when the network is unavailable.
 *
 * Registered as the "osmtiles://" MapLibre protocol; tile URL template is
 * OSM_TILE_URL_TEMPLATE.
 */

import type { GetResourceResponse, RequestParameters } from "maplibre-gl";
import { addProtocol } from "maplibre-gl";

export const OSM_TILE_URL_TEMPLATE = "osmtiles://{z}/{x}/{y}";

const UPSTREAM = "https://tile.openstreetmap.org";
const CACHE_NAME = "osm-tiles-v1";
/** Tiles older than this are refreshed when online (served stale when not). */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Cap on cached tile count (~15–25 KB each → roughly 60–100 MB). */
const MAX_TILES = 4000;
/** Check the cap once per this many stores, not on every tile. */
const TRIM_EVERY = 64;
const CACHED_AT_HEADER = "x-pelorus-cached-at";

/** Convert an osmtiles:// request URL to the upstream OSM tile URL. */
export function osmTileURL(requestURL: string): string | null {
  const m = requestURL.match(/^osmtiles:\/\/(\d+)\/(\d+)\/(\d+)$/);
  return m ? `${UPSTREAM}/${m[1]}/${m[2]}/${m[3]}.png` : null;
}

async function openTileCache(): Promise<Cache | null> {
  try {
    if (typeof caches === "undefined") return null;
    return await caches.open(CACHE_NAME);
  } catch {
    return null; // insecure context or storage failure — plain fetch still works
  }
}

function isFresh(cached: Response): boolean {
  const at = Number(cached.headers.get(CACHED_AT_HEADER));
  return Number.isFinite(at) && Date.now() - at < MAX_AGE_MS;
}

let storesSinceTrim = 0;

async function storeTile(
  cache: Cache,
  url: string,
  data: ArrayBuffer,
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
      await trimCache(cache);
    }
  } catch {
    // Quota exceeded or storage failure — the tile still renders this session
  }
}

async function trimCache(cache: Cache): Promise<void> {
  const keys = await cache.keys();
  // keys() preserves insertion order in Chromium, so this is FIFO eviction —
  // approximate, but plenty for a browse cache.
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_TILES))) {
    await cache.delete(key);
  }
}

async function loadTile(
  params: RequestParameters,
  abort: AbortController,
): Promise<GetResourceResponse<ArrayBuffer>> {
  const url = osmTileURL(params.url);
  if (!url) throw new Error(`Bad OSM tile URL: ${params.url}`);

  const cache = await openTileCache();
  const cached = (await cache?.match(url)) ?? null;
  if (cached && isFresh(cached)) {
    return { data: await cached.arrayBuffer() };
  }

  try {
    const resp = await fetch(url, { signal: abort.signal });
    if (!resp.ok) throw new Error(`OSM tile fetch failed: ${resp.status}`);
    const data = await resp.arrayBuffer();
    if (cache) void storeTile(cache, url, data);
    return { data };
  } catch (err) {
    // Offline or upstream failure — serve a stale tile if we have one
    if (cached) return { data: await cached.arrayBuffer() };
    throw err;
  }
}

/** Register the osmtiles:// protocol. Call once before creating the map. */
export function registerOSMTileProtocol(): void {
  addProtocol("osmtiles", loadTile);
}
