/**
 * Thin NOAA CO-OPS MDAPI client for the tides-bundle crawler.
 *
 * Rate-limited, retrying, with an on-disk response cache in
 * tools/tides/.cache/ (gitignored) so interrupted crawls resume cheaply
 * and re-runs don't hammer NOAA (~9k calls for a full crawl).
 */

import { existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const BASE = "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi";
const CACHE_DIR = join(import.meta.dirname, ".cache");
const MIN_INTERVAL_MS = 150; // ~6.7 req/s
const MAX_RETRIES = 4;

mkdirSync(CACHE_DIR, { recursive: true });

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

let nextSlot = 0;
/** Serialize request start times so concurrent callers share one rate limit. */
async function rateLimit(): Promise<void> {
  const now = Date.now();
  const slot = Math.max(nextSlot, now);
  nextSlot = slot + MIN_INTERVAL_MS;
  if (slot > now) await sleep(slot - now);
}

export let fetchCount = 0;
export let cacheHits = 0;

/**
 * GET an MDAPI path (e.g. "stations/8443970/harcon.json?units=metric").
 * Returns null on HTTP 404 (missing resource is expected for some stations).
 */
export async function mdapiGet<T>(path: string): Promise<T | null> {
  const cacheFile = join(CACHE_DIR, path.replace(/[^\w.-]+/g, "_"));
  if (existsSync(cacheFile)) {
    cacheHits++;
    const text = await readFile(cacheFile, "utf8");
    return text === "404" ? null : (JSON.parse(text) as T);
  }

  for (let attempt = 0; ; attempt++) {
    await rateLimit();
    let res: Response;
    try {
      res = await fetch(`${BASE}/${path}`);
    } catch (err) {
      if (attempt >= MAX_RETRIES) throw err;
      await sleep(1000 * 2 ** attempt * (1 + Math.random()));
      continue;
    }
    if (res.ok) {
      const text = await res.text();
      fetchCount++;
      await writeFile(cacheFile, text);
      return JSON.parse(text) as T;
    }
    if (res.status === 404) {
      fetchCount++;
      await writeFile(cacheFile, "404");
      return null;
    }
    if (attempt >= MAX_RETRIES) {
      throw new Error(`MDAPI ${res.status} for ${path}`);
    }
    await sleep(1000 * 2 ** attempt * (1 + Math.random()));
  }
}

/** Map `fn` over `items` with bounded concurrency, preserving order. */
export async function pMap<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency = 4,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );
  return results;
}
