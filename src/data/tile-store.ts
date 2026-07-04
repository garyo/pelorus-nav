/**
 * OPFS-backed tile storage for offline PMTiles chart files.
 *
 * Downloads entire PMTiles files to Origin Private File System for
 * reliable offline access. Metadata stored as a JSON sidecar file.
 *
 * Gracefully degrades when OPFS is unavailable (insecure context / old browser).
 *
 * All writes are delegated to the OPFS write worker (createSyncAccessHandle),
 * since iOS WKWebView has no main-thread OPFS write API. See opfs-writer.ts.
 */

import { opfsFetchWrite, opfsWriteBlob, opfsWriteText } from "./opfs-writer";

const META_FILENAME = "_charts-meta.json";

export interface StoredChartInfo {
  filename: string; // "nautical.pmtiles"
  region: string; // "nautical" — display name / catalog key
  sizeBytes: number;
  downloadedAt: string; // ISO timestamp
  etag?: string; // for update detection
}

let sweptDownloadingFiles = false;

/**
 * Remove any `*.downloading` temp files left behind by a crash or force-quit
 * mid-download — the OPFS write worker normally cleans these up itself (see
 * opfs-write-worker.ts), but a hard kill skips that cleanup entirely. Runs at
 * most once per session, the first time the OPFS root is opened.
 */
async function sweepDownloadingFiles(
  root: FileSystemDirectoryHandle,
): Promise<void> {
  if (sweptDownloadingFiles) return;
  sweptDownloadingFiles = true;
  try {
    for await (const name of root.keys()) {
      if (!name.endsWith(".downloading")) continue;
      try {
        await root.removeEntry(name);
      } catch {
        // best-effort cleanup only
      }
    }
  } catch {
    // root.keys() unsupported or failed — skip cleanup silently
  }
}

/** Get OPFS root directory handle (returns null in insecure contexts). */
async function getRoot(): Promise<FileSystemDirectoryHandle | null> {
  if (!navigator.storage?.getDirectory) return null;
  try {
    const root = await navigator.storage.getDirectory();
    await sweepDownloadingFiles(root);
    return root;
  } catch {
    return null;
  }
}

/** Read metadata sidecar from OPFS. */
async function readMeta(): Promise<StoredChartInfo[]> {
  const root = await getRoot();
  if (!root) return [];
  try {
    const handle = await root.getFileHandle(META_FILENAME);
    const file = await handle.getFile();
    const text = await file.text();
    return JSON.parse(text) as StoredChartInfo[];
  } catch {
    return [];
  }
}

/** Write metadata sidecar to OPFS (temp-file + atomic move — see opfsWriteText). */
async function writeMeta(charts: StoredChartInfo[]): Promise<void> {
  if (!(await getRoot())) return;
  await opfsWriteText(META_FILENAME, JSON.stringify(charts, null, 2));
}

/**
 * Serializes every meta read-modify-write through a single promise chain, so
 * a download/delete/import racing another one can't read a stale snapshot
 * and clobber the other's entry on write. `metaQueue` always resolves (the
 * trailing `.then(ok, ok)` swallows a failed op so the *next* queued op
 * still runs); the failure itself still propagates to whoever queued it,
 * via the returned promise.
 */
let metaQueue: Promise<void> = Promise.resolve();

async function withMeta(
  mutate: (
    charts: StoredChartInfo[],
  ) => StoredChartInfo[] | Promise<StoredChartInfo[]>,
): Promise<void> {
  const run = metaQueue.then(async () => {
    const meta = await readMeta();
    await writeMeta(await mutate(meta));
  });
  metaQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** List all stored chart files. */
export async function listStoredCharts(): Promise<StoredChartInfo[]> {
  return readMeta();
}

/** Remote chart metadata from a HEAD request, for update detection. */
export interface RemoteChartMeta {
  etag?: string;
  lastModified?: string;
  sizeBytes?: number;
}

/** Strip the weak-validator prefix and surrounding quotes so etags compare equal. */
export function normalizeEtag(etag: string): string {
  return etag.replace(/^W\//, "").replace(/^"|"$/g, "");
}

/**
 * Fetch remote chart metadata via a cheap HEAD request, for update detection.
 * Returns null when the request fails — offline, or a server that rejects HEAD
 * or hides the headers behind CORS. Callers treat null as "can't tell".
 */
export async function fetchRemoteChartMeta(
  url: string,
  signal?: AbortSignal,
): Promise<RemoteChartMeta | null> {
  try {
    // no-store: a cached answer would defeat the point of the check
    const response = await fetch(url, {
      method: "HEAD",
      cache: "no-store",
      signal,
    });
    if (!response.ok) return null;
    const len = response.headers.get("content-length");
    return {
      etag: response.headers.get("etag") ?? undefined,
      lastModified: response.headers.get("last-modified") ?? undefined,
      sizeBytes: len ? Number(len) : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Whether the remote chart is newer than the stored copy. Prefers the etag
 * (exact), falls back to last-modified vs download time, then a size change.
 * Returns false on no reliable signal — we don't nag the user on uncertainty.
 */
export function isUpdateAvailable(
  stored: StoredChartInfo,
  remote: RemoteChartMeta,
): boolean {
  if (stored.etag && remote.etag) {
    return normalizeEtag(stored.etag) !== normalizeEtag(remote.etag);
  }
  if (remote.lastModified) {
    const remoteTime = Date.parse(remote.lastModified);
    const storedTime = Date.parse(stored.downloadedAt);
    if (!Number.isNaN(remoteTime) && !Number.isNaN(storedTime)) {
      return remoteTime > storedTime;
    }
  }
  if (remote.sizeBytes !== undefined) {
    return remote.sizeBytes !== stored.sizeBytes;
  }
  return false;
}

/**
 * Download a PMTiles file to OPFS with progress reporting.
 *
 * The actual fetch + write streams inside the OPFS write worker
 * (createSyncAccessHandle) so it works on iOS WKWebView, which has no
 * main-thread OPFS write API. The worker streams into a `${filename}.downloading`
 * temp file and only moves it over `filename` once the download completes, so a
 * failed or aborted download never disturbs an already-downloaded chart.
 */
export async function downloadChart(
  url: string,
  filename: string,
  onProgress: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (!(await getRoot())) {
    throw new Error("Offline storage is not available (OPFS)");
  }

  const { size, etag } = await opfsFetchWrite(
    url,
    filename,
    onProgress,
    signal,
  );

  // Update metadata
  const region = filename.replace(/\.pmtiles$/, "");
  const info: StoredChartInfo = {
    filename,
    region,
    sizeBytes: size,
    downloadedAt: new Date().toISOString(),
    etag,
  };

  await withMeta((meta) => {
    const idx = meta.findIndex((c) => c.filename === filename);
    if (idx >= 0) {
      meta[idx] = info;
    } else {
      meta.push(info);
    }
    return meta;
  });
}

/**
 * Import a PMTiles file from a user-selected File object.
 */
export async function importChart(file: File): Promise<void> {
  if (!(await getRoot())) {
    throw new Error("Offline storage is not available (OPFS)");
  }
  await opfsWriteBlob(file.name, file);

  const region = file.name.replace(/\.pmtiles$/, "");
  const info: StoredChartInfo = {
    filename: file.name,
    region,
    sizeBytes: file.size,
    downloadedAt: new Date().toISOString(),
  };

  await withMeta((meta) => {
    const idx = meta.findIndex((c) => c.filename === file.name);
    if (idx >= 0) {
      meta[idx] = info;
    } else {
      meta.push(info);
    }
    return meta;
  });
}

/** Get a File handle for a stored chart (for PMTiles FileSource). */
export async function getChartFile(filename: string): Promise<File | null> {
  const root = await getRoot();
  if (!root) return null;
  try {
    const handle = await root.getFileHandle(filename);
    return handle.getFile();
  } catch {
    return null;
  }
}

/** Delete a stored chart file and update metadata. */
export async function deleteChart(filename: string): Promise<void> {
  const root = await getRoot();
  if (!root) return;
  try {
    await root.removeEntry(filename);
  } catch {
    // file may not exist
  }

  await withMeta((meta) => meta.filter((c) => c.filename !== filename));
}

/**
 * Delete all stored charts. Enumerates the actual OPFS directory rather than
 * the meta sidecar — a chart whose meta entry was lost (e.g. to a crash
 * during an earlier unguarded write) would otherwise survive as an invisible
 * orphan that this could never remove.
 */
export async function deleteAllCharts(): Promise<void> {
  const root = await getRoot();
  if (!root) return;
  await withMeta(async () => {
    // Removes the meta sidecar and any leftover `.downloading` temp files
    // too — writeMeta([]) below recreates a fresh, empty sidecar.
    for await (const name of root.keys()) {
      try {
        await root.removeEntry(name);
      } catch {
        // ignore
      }
    }
    return [];
  });
}

/**
 * Download a small auxiliary file (e.g. coverage GeoJSON) to OPFS.
 * Unlike downloadChart, this doesn't use streaming or progress — it's for small files.
 */
export async function downloadAuxFile(
  url: string,
  filename: string,
  signal?: AbortSignal,
): Promise<void> {
  if (!(await getRoot())) {
    throw new Error("Offline storage is not available (OPFS)");
  }
  await opfsFetchWrite(url, filename, undefined, signal);
}

/**
 * Get a stored auxiliary file as a blob URL, or null if not stored.
 * Caller is responsible for revoking the URL when done.
 */
export async function getAuxFileURL(filename: string): Promise<string | null> {
  const root = await getRoot();
  if (!root) return null;
  try {
    const handle = await root.getFileHandle(filename);
    const file = await handle.getFile();
    return URL.createObjectURL(file);
  } catch {
    return null;
  }
}

/**
 * Delete an auxiliary file from OPFS.
 */
export async function deleteAuxFile(filename: string): Promise<void> {
  const root = await getRoot();
  if (!root) return;
  try {
    await root.removeEntry(filename);
  } catch {
    // file may not exist
  }
}

/** Get storage estimate (used/quota in bytes). */
export async function getStorageEstimate(): Promise<{
  used: number;
  quota: number;
}> {
  if (navigator.storage?.estimate) {
    const est = await navigator.storage.estimate();
    return { used: est.usage ?? 0, quota: est.quota ?? 0 };
  }
  return { used: 0, quota: 0 };
}
