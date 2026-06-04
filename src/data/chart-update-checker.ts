/**
 * Background update checking for downloaded chart regions.
 *
 * The ChartCachePanel checks for newer charts when opened; this module covers
 * the user who never reopens it. A periodic HEAD sweep over downloaded regions
 * surfaces those whose remote copy has been newer for more than a few days,
 * so the offer never nags about a rebuild pushed an hour ago.
 *
 * Decision logic here is pure and unit-tested; scheduling and the notice UI
 * live in ui/ChartUpdateNotifier.
 */

import { CHART_REGIONS, type ChartRegion } from "./chart-catalog";
import { chartAssetBase } from "./remote-url";
import {
  fetchRemoteChartMeta,
  isUpdateAvailable,
  listStoredCharts,
  normalizeEtag,
  type RemoteChartMeta,
  type StoredChartInfo,
} from "./tile-store";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Only offer once the newer charts have been out this long. */
export const STALE_AFTER_DAYS = 3;
/** "Later" hides the offer for this long (a newer version re-offers sooner). */
export const SNOOZE_DAYS = 7;
/** Minimum time between background sweeps. */
export const CHECK_INTERVAL_MS = DAY_MS;

const LAST_CHECK_KEY = "pelorus-nav-chart-update-check";
const SNOOZE_KEY = "pelorus-nav-chart-update-snooze";
const STREAM_VERSIONS_KEY = "pelorus-nav-chart-stream-versions";

export interface ChartUpdate {
  region: ChartRegion;
  remote: RemoteChartMeta;
}

/** Snoozed offer for one region: which remote version, and until when. */
export interface SnoozeEntry {
  token: string;
  until: number; // epoch ms
}

/**
 * Whether the stored chart is out of date and has been for a while.
 * Uses the remote publish date when available; falls back to the local
 * copy's age when the server hides Last-Modified.
 */
export function isStaleUpdate(
  stored: StoredChartInfo,
  remote: RemoteChartMeta,
  nowMs: number,
): boolean {
  if (!isUpdateAvailable(stored, remote)) return false;
  const staleMs = STALE_AFTER_DAYS * DAY_MS;
  const publishedAt = remote.lastModified
    ? Date.parse(remote.lastModified)
    : Number.NaN;
  if (!Number.isNaN(publishedAt)) return nowMs - publishedAt > staleMs;
  const downloadedAt = Date.parse(stored.downloadedAt);
  return !Number.isNaN(downloadedAt) && nowMs - downloadedAt > staleMs;
}

/** Identity of a remote version, for snoozing — best available signal. */
export function updateToken(remote: RemoteChartMeta): string {
  return remote.etag ?? remote.lastModified ?? String(remote.sizeBytes ?? "");
}

/** Whether an offer for this exact remote version is currently snoozed. */
export function isSnoozed(
  snoozes: Record<string, SnoozeEntry>,
  filename: string,
  token: string,
  nowMs: number,
): boolean {
  const entry = snoozes[filename];
  return entry !== undefined && entry.token === token && nowMs < entry.until;
}

function readSnoozes(): Record<string, SnoozeEntry> {
  try {
    const raw = localStorage.getItem(SNOOZE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, SnoozeEntry>) : {};
  } catch {
    return {};
  }
}

/** Snooze the offered updates so "Later" stays quiet for SNOOZE_DAYS. */
export function snoozeChartUpdates(
  updates: ChartUpdate[],
  nowMs = Date.now(),
): void {
  const snoozes = readSnoozes();
  for (const { region, remote } of updates) {
    snoozes[region.filename] = {
      token: updateToken(remote),
      until: nowMs + SNOOZE_DAYS * DAY_MS,
    };
  }
  try {
    localStorage.setItem(SNOOZE_KEY, JSON.stringify(snoozes));
  } catch {
    // storage full / unavailable — worst case we re-offer
  }
}

/** Whether enough time has passed since the last successful sweep. */
export function shouldCheckForUpdates(nowMs = Date.now()): boolean {
  try {
    const raw = localStorage.getItem(LAST_CHECK_KEY);
    if (!raw) return true;
    const last = Date.parse(raw);
    return Number.isNaN(last) || nowMs - last >= CHECK_INTERVAL_MS;
  } catch {
    return true;
  }
}

function recordCheck(nowMs: number): void {
  try {
    localStorage.setItem(LAST_CHECK_KEY, new Date(nowMs).toISOString());
  } catch {
    // ignore
  }
}

/**
 * HEAD every downloaded catalog region and return those with a stale,
 * un-snoozed update. Records the check time only when at least one HEAD
 * succeeds, so an offline boat retries on the next sweep.
 */
export async function checkForChartUpdates(
  nowMs = Date.now(),
): Promise<ChartUpdate[]> {
  const stored = await listStoredCharts();
  const storedByFile = new Map(stored.map((c) => [c.filename, c]));
  const downloaded = CHART_REGIONS.filter((r) => storedByFile.has(r.filename));
  if (downloaded.length === 0) {
    recordCheck(nowMs);
    return [];
  }

  const results = await Promise.all(
    downloaded.map(async (region) => ({
      region,
      remote: await fetchRemoteChartMeta(
        `${chartAssetBase()}/${region.filename}`,
      ),
    })),
  );
  if (results.some((r) => r.remote !== null)) recordCheck(nowMs);

  const snoozes = readSnoozes();
  const updates: ChartUpdate[] = [];
  for (const { region, remote } of results) {
    const info = storedByFile.get(region.filename);
    if (!remote || !info) continue;
    if (!isStaleUpdate(info, remote, nowMs)) continue;
    if (isSnoozed(snoozes, region.filename, updateToken(remote), nowMs)) {
      continue;
    }
    updates.push({ region, remote });
  }
  return updates;
}

/*
 * Streaming version pinning.
 *
 * The worker serves .pmtiles ranges with a long max-age, so the browser's
 * HTTP cache could mix day-old tile bytes with fresh ones across a rebuild.
 * Pinning each streaming region's URL to its remote version (?v=<etag>)
 * makes the cache version-coherent: a new upload gets a new URL, an
 * unchanged file keeps full-speed caching. Downloaded regions are excluded —
 * their plain URL must keep matching the OPFS-backed protocol entry.
 */

/** Cache-buster identity of a remote version, URL-friendly. */
export function streamingVersionToken(remote: RemoteChartMeta): string | null {
  if (remote.etag) return normalizeEtag(remote.etag);
  if (remote.lastModified) {
    const t = Date.parse(remote.lastModified);
    if (!Number.isNaN(t)) return String(t);
  }
  return null;
}

function readStreamingVersions(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STREAM_VERSIONS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** Last-known versions for regions that stream (not downloaded to OPFS). */
export async function getStreamingVersions(): Promise<Record<string, string>> {
  const stored = await listStoredCharts();
  const storedFiles = new Set(stored.map((c) => c.filename));
  const versions = readStreamingVersions();
  return Object.fromEntries(
    Object.entries(versions).filter(([file]) => !storedFiles.has(file)),
  );
}

/**
 * HEAD every streaming catalog region and record its current version.
 * Returns the fresh region→version map when anything changed (callers
 * should apply it and rebuild the style), or null when nothing did.
 * Unreachable regions keep their last-known version.
 */
export async function refreshStreamingVersions(): Promise<Record<
  string,
  string
> | null> {
  const stored = await listStoredCharts();
  const storedFiles = new Set(stored.map((c) => c.filename));
  const streaming = CHART_REGIONS.filter((r) => !storedFiles.has(r.filename));
  if (streaming.length === 0) return null;

  const versions = readStreamingVersions();
  let changed = false;
  await Promise.all(
    streaming.map(async (region) => {
      const remote = await fetchRemoteChartMeta(
        `${chartAssetBase()}/${region.filename}`,
      );
      const token = remote ? streamingVersionToken(remote) : null;
      if (token && versions[region.filename] !== token) {
        versions[region.filename] = token;
        changed = true;
      }
    }),
  );
  if (!changed) return null;

  try {
    localStorage.setItem(STREAM_VERSIONS_KEY, JSON.stringify(versions));
  } catch {
    // storage unavailable — the returned map still applies this session
  }
  return Object.fromEntries(
    Object.entries(versions).filter(([file]) => !storedFiles.has(file)),
  );
}
