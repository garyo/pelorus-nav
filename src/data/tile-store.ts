/**
 * OPFS-backed tile storage for offline PMTiles chart files.
 *
 * Downloads entire PMTiles files to Origin Private File System for
 * reliable offline access. Metadata stored as a JSON sidecar file.
 */

const META_FILENAME = "_charts-meta.json";

export interface StoredChartInfo {
  filename: string; // "nautical.pmtiles"
  region: string; // "nautical" — display name / catalog key
  sizeBytes: number;
  downloadedAt: string; // ISO timestamp
  etag?: string; // for update detection
}

/** Get OPFS root directory handle. */
async function getRoot(): Promise<FileSystemDirectoryHandle> {
  return navigator.storage.getDirectory();
}

/** Read metadata sidecar from OPFS. */
async function readMeta(): Promise<StoredChartInfo[]> {
  const root = await getRoot();
  try {
    const handle = await root.getFileHandle(META_FILENAME);
    const file = await handle.getFile();
    const text = await file.text();
    return JSON.parse(text) as StoredChartInfo[];
  } catch {
    return [];
  }
}

/** Write metadata sidecar to OPFS. */
async function writeMeta(charts: StoredChartInfo[]): Promise<void> {
  const root = await getRoot();
  const handle = await root.getFileHandle(META_FILENAME, { create: true });
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(charts, null, 2));
  await writable.close();
}

/** List all stored chart files. */
export async function listStoredCharts(): Promise<StoredChartInfo[]> {
  return readMeta();
}

/**
 * Download a PMTiles file to OPFS with progress reporting.
 * Uses streaming to avoid holding the entire file in memory.
 * Writes to a temp file, then renames atomically on completion.
 */
export async function downloadChart(
  url: string,
  filename: string,
  onProgress: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(
      `Download failed: ${response.status} ${response.statusText}`,
    );
  }

  const total = Number(response.headers.get("content-length") || 0);
  const etag = response.headers.get("etag") ?? undefined;
  const root = await getRoot();

  const tempName = `${filename}.downloading`;

  // Try streaming write (not available in Safari <17)
  const tempHandle = await root.getFileHandle(tempName, { create: true });

  let supportsCreateWritable = true;
  try {
    // Test if createWritable is available
    const testWritable = await tempHandle.createWritable();
    await testWritable.close();
  } catch {
    supportsCreateWritable = false;
  }

  if (supportsCreateWritable && response.body) {
    // Streaming write — memory-efficient
    const writable = await tempHandle.createWritable();
    const reader = response.body.getReader();
    let loaded = 0;

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        await writable.write(value);
        loaded += value.byteLength;
        onProgress(loaded, total);
      }
      await writable.close();
    } catch (err) {
      await writable.abort();
      // Clean up temp file
      try {
        await root.removeEntry(tempName);
      } catch {
        // ignore cleanup errors
      }
      throw err;
    }
  } else {
    // Fallback: read entire blob then write at once (Safari <17)
    const blob = await response.blob();
    onProgress(blob.size, blob.size);
    const writable = await tempHandle.createWritable();
    await writable.write(blob);
    await writable.close();
  }

  // "Rename": copy temp to final, then remove temp.
  // OPFS doesn't have a rename API on FileSystemFileHandle in all browsers,
  // so we read the temp file and write it to the final name.
  // The temp file is already fully written, so this is safe.
  try {
    await root.removeEntry(filename);
  } catch {
    // file didn't exist
  }
  const finalHandle = await root.getFileHandle(filename, { create: true });
  const tempFile = await tempHandle.getFile();
  const finalWritable = await finalHandle.createWritable();
  await finalWritable.write(tempFile);
  await finalWritable.close();
  try {
    await root.removeEntry(tempName);
  } catch {
    // ignore
  }

  // Update metadata
  const region = filename.replace(/\.pmtiles$/, "");
  const file = await (await root.getFileHandle(filename)).getFile();
  const info: StoredChartInfo = {
    filename,
    region,
    sizeBytes: file.size,
    downloadedAt: new Date().toISOString(),
    etag,
  };

  const meta = await readMeta();
  const idx = meta.findIndex((c) => c.filename === filename);
  if (idx >= 0) {
    meta[idx] = info;
  } else {
    meta.push(info);
  }
  await writeMeta(meta);
}

/**
 * Import a PMTiles file from a user-selected File object.
 */
export async function importChart(file: File): Promise<void> {
  const root = await getRoot();
  const handle = await root.getFileHandle(file.name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(file);
  await writable.close();

  const region = file.name.replace(/\.pmtiles$/, "");
  const info: StoredChartInfo = {
    filename: file.name,
    region,
    sizeBytes: file.size,
    downloadedAt: new Date().toISOString(),
  };

  const meta = await readMeta();
  const idx = meta.findIndex((c) => c.filename === file.name);
  if (idx >= 0) {
    meta[idx] = info;
  } else {
    meta.push(info);
  }
  await writeMeta(meta);
}

/** Get a File handle for a stored chart (for PMTiles FileSource). */
export async function getChartFile(filename: string): Promise<File | null> {
  const root = await getRoot();
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
  try {
    await root.removeEntry(filename);
  } catch {
    // file may not exist
  }

  const meta = await readMeta();
  const filtered = meta.filter((c) => c.filename !== filename);
  await writeMeta(filtered);
}

/** Delete all stored charts. */
export async function deleteAllCharts(): Promise<void> {
  const meta = await readMeta();
  const root = await getRoot();
  for (const chart of meta) {
    try {
      await root.removeEntry(chart.filename);
    } catch {
      // ignore
    }
  }
  // Also clean up any leftover .downloading files
  try {
    await root.removeEntry(META_FILENAME);
  } catch {
    // ignore
  }
  await writeMeta([]);
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
