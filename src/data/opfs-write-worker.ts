/**
 * OPFS write worker.
 *
 * iOS WKWebView (through at least 17.x) exposes no main-thread OPFS write API —
 * `FileSystemFileHandle.createWritable` is undefined. The only way to write an
 * OPFS file there is `createSyncAccessHandle`, which is synchronous and only
 * available inside a Worker. Doing all writes here means one code path works on
 * iOS, Android, and desktop, instead of branching on `createWritable`.
 *
 * Every write streams into a `${filename}.downloading` temp file and only
 * moves it over the final filename once the whole payload has landed, so a
 * failed or aborted write never touches (let alone truncates) a chart the
 * user already has. The `sweep` op (triggered at startup from tile-store.ts)
 * recovers from a hard crash mid-write: it finishes any interrupted fallback
 * move — provably complete via its `.moving` marker, see moveIntoPlace — and
 * deletes partial-download temps.
 *
 * Protocol (main → worker): { id, op, ... }
 *   - fetchWrite { url, filename }  — stream a URL to an OPFS file, posting progress
 *   - writeBlob  { filename, blob } — stream a Blob (e.g. an imported chart)
 *   - writeText  { filename, text } — write a string (e.g. the metadata sidecar)
 *   - sweep      {}                 — recover leftover temp files (see sweepTemps)
 *   - abort      {}                 — cancel an in-flight fetchWrite
 * Worker → main: { id, type: "progress" | "done" | "error", ... }
 */

import { isCompleteDownload } from "./download-completeness";

// In a module worker the global scope has Worker's postMessage/onmessage shape.
const ctx = self as unknown as Worker;

interface InMsg {
  id: number;
  op: "fetchWrite" | "writeBlob" | "writeText" | "sweep" | "abort";
  url?: string;
  filename?: string;
  blob?: Blob;
  text?: string;
}

/** In-flight fetchWrite aborts, keyed by request id. */
const controllers = new Map<number, AbortController>();

function getRoot(): Promise<FileSystemDirectoryHandle> {
  return navigator.storage.getDirectory();
}

async function openAccess(
  filename: string,
): Promise<FileSystemSyncAccessHandle> {
  const root = await getRoot();
  const handle = await root.getFileHandle(filename, { create: true });
  return handle.createSyncAccessHandle();
}

async function removeQuietly(filename: string): Promise<void> {
  try {
    const root = await getRoot();
    await root.removeEntry(filename);
  } catch {
    // already gone / never created
  }
}

/** Suffix of the in-progress copy of a streamed download. */
const TEMP_SUFFIX = ".downloading";

/** Suffix of the fallback-move marker file — see moveIntoPlace. */
const MOVING_SUFFIX = ".moving";

function tempName(filename: string): string {
  return `${filename}${TEMP_SUFFIX}`;
}

function markerName(filename: string): string {
  return `${filename}${MOVING_SUFFIX}`;
}

/**
 * Promote a completed temp file over `filename`. Prefers the native rename
 * (`FileSystemFileHandle.move`), which is atomic and doesn't re-copy bytes.
 *
 * The copy fallback below is a legacy path: every post-~2023 WebView/browser
 * supports `move` (verified 2026-08 on Fire tablet Silk 138 and Amazon
 * WebView 138). It exists only for very old devices that never update their
 * system WebView (roughly pre-2023 Chromium, e.g. stale e-ink readers),
 * where `move` is missing or throws NotAllowedError even though sync-access
 * writes work fine.
 *
 * The copy is not atomic — it truncates the destination before writing — so
 * it guards both ends:
 * - Before copying it creates a `${filename}.moving` marker file. The marker
 *   is created only here, after the temp has been fully written, flushed,
 *   and closed, so its presence proves the temp is complete; the startup
 *   sweep (sweepTemps) uses that proof to finish an interrupted move rather
 *   than discarding the temp as a partial download. (A marker file instead
 *   of renaming the temp itself: a rename needs `move`, which is exactly
 *   what's broken when this path runs.)
 * - After copying it verifies the destination's size before deleting the
 *   temp; on a mismatch it removes the corrupt destination, keeps the temp
 *   and marker, and throws.
 */
async function moveIntoPlace(from: string, filename: string): Promise<void> {
  const root = await getRoot();
  const tempHandle = await root.getFileHandle(from);
  if (typeof tempHandle.move === "function") {
    try {
      await tempHandle.move(filename);
      return;
    } catch {
      // fall through to the copy path
    }
  }
  const marker = markerName(filename);
  await root.getFileHandle(marker, { create: true });
  const finalHandle = await root.getFileHandle(filename, { create: true });
  const src = await tempHandle.createSyncAccessHandle();
  const dst = await finalHandle.createSyncAccessHandle();
  let size = 0;
  let copied = 0;
  try {
    dst.truncate(0);
    size = src.getSize();
    const chunk = new Uint8Array(4 * 1024 * 1024);
    for (let at = 0; at < size; ) {
      const n = src.read(chunk, { at });
      if (n === 0) break;
      dst.write(n === chunk.length ? chunk : chunk.subarray(0, n), { at });
      at += n;
    }
    dst.flush();
    copied = dst.getSize();
  } finally {
    src.close();
    dst.close();
  }
  if (copied !== size) {
    await removeQuietly(filename);
    throw new Error(
      `move fallback: copy verification failed (${copied} of ${size} bytes); temp kept`,
    );
  }
  await root.removeEntry(from);
  await removeQuietly(marker);
}

/**
 * Startup sweep of temp files left behind by a hard crash or force-quit
 * (a clean failure removes its own temp — see the catch blocks below).
 *
 * The rule: a `.downloading` temp is promoted over its final filename only
 * when its `.moving` marker exists — the marker is created solely by
 * moveIntoPlace's copy fallback, after the temp was fully written and
 * closed, so it proves the temp holds a complete payload. A markerless
 * temp may be a download that died mid-stream, and promoting it could
 * install a truncated chart, so it is always deleted. A marker without a
 * temp means the move finished but the crash hit before the marker was
 * removed; the final file is already good, so only the marker is dropped.
 */
async function sweepTemps(): Promise<void> {
  const root = await getRoot();
  const names: string[] = [];
  for await (const name of root.keys()) names.push(name);
  const present = new Set(names);
  for (const name of names) {
    try {
      if (name.endsWith(TEMP_SUFFIX)) {
        const filename = name.slice(0, -TEMP_SUFFIX.length);
        if (present.has(markerName(filename))) {
          await moveIntoPlace(name, filename);
          await removeQuietly(markerName(filename));
        } else {
          await removeQuietly(name);
        }
      } else if (
        name.endsWith(MOVING_SUFFIX) &&
        !present.has(tempName(name.slice(0, -MOVING_SUFFIX.length)))
      ) {
        await removeQuietly(name);
      }
    } catch {
      // per-file best effort — keep sweeping the rest
    }
  }
}

async function fetchWrite(
  id: number,
  url: string,
  filename: string,
): Promise<void> {
  const ac = new AbortController();
  controllers.set(id, ac);
  const temp = tempName(filename);
  let access: FileSystemSyncAccessHandle | null = null;
  try {
    const resp = await fetch(url, { cache: "no-store", signal: ac.signal });
    if (!resp.ok || !resp.body) {
      throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
    }
    // Guard against an HTML response masquerading as a chart — a captive
    // portal, an error page, or a dev-server SPA fallback for a missing file.
    // Real charts/aux files are octet-stream or JSON, never text/html.
    if ((resp.headers.get("content-type") ?? "").includes("text/html")) {
      throw new Error(
        "server returned a web page, not a chart file (offline or captive portal?)",
      );
    }
    const total = Number(resp.headers.get("content-length") || 0);
    const etag = resp.headers.get("etag") ?? undefined;
    // A stale `.moving` marker from an earlier failed attempt must not pair
    // with this fresh temp — the sweep would take it as proof the temp is
    // complete (see moveIntoPlace).
    await removeQuietly(markerName(filename));
    access = await openAccess(temp);
    access.truncate(0);
    let offset = 0;
    const reader = resp.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      access.write(value, { at: offset });
      offset += value.byteLength;
      ctx.postMessage({ id, type: "progress", loaded: offset, total });
    }
    if (!isCompleteDownload(offset, total)) {
      throw new Error(`incomplete download: got ${offset} of ${total} bytes`);
    }
    access.flush();
    access.close();
    access = null;
    await moveIntoPlace(temp, filename);
    ctx.postMessage({ id, type: "done", size: offset, etag });
  } catch (err) {
    // Close the handle before removal — an open sync access handle holds an
    // exclusive lock, so removeEntry silently no-ops while it's held and a
    // truncated temp file survives.
    access?.close();
    access = null;
    await removeQuietly(temp);
    throw err;
  } finally {
    access?.close();
    controllers.delete(id);
  }
}

/**
 * Stream a Blob into `filename` via a temp file + atomic move, so a crash
 * (or tab kill) mid-write can never leave `filename` truncated or empty —
 * an existing file is untouched until the replacement is fully flushed.
 * Chunked streaming (`blob.stream()`, never `blob.arrayBuffer()`) keeps
 * memory bounded: an imported chart can be hundreds of MB, more than a
 * low-RAM device's WebView can hold as one buffer. Used for chart imports
 * and the chart-metadata sidecar.
 */
async function writeBlobAtomic(
  id: number,
  filename: string,
  blob: Blob,
): Promise<void> {
  const temp = tempName(filename);
  let access: FileSystemSyncAccessHandle | null = null;
  try {
    // Same stale-marker guard as fetchWrite — see the comment there.
    await removeQuietly(markerName(filename));
    access = await openAccess(temp);
    access.truncate(0);
    let offset = 0;
    const reader = blob.stream().getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      access.write(value, { at: offset });
      offset += value.byteLength;
    }
    access.flush();
    access.close();
    access = null;
    await moveIntoPlace(temp, filename);
    ctx.postMessage({ id, type: "done", size: offset });
  } catch (err) {
    // Same lock-before-remove ordering as fetchWrite: close before removing.
    access?.close();
    access = null;
    await removeQuietly(temp);
    throw err;
  } finally {
    access?.close();
  }
}

ctx.onmessage = (e: MessageEvent) => {
  const msg = e.data as InMsg;
  if (msg.op === "abort") {
    controllers.get(msg.id)?.abort();
    controllers.delete(msg.id);
    return;
  }
  const run = async (): Promise<void> => {
    if (msg.op === "fetchWrite") {
      await fetchWrite(msg.id, msg.url ?? "", msg.filename ?? "");
    } else if (msg.op === "writeBlob") {
      await writeBlobAtomic(msg.id, msg.filename ?? "", msg.blob as Blob);
    } else if (msg.op === "writeText") {
      await writeBlobAtomic(
        msg.id,
        msg.filename ?? "",
        new Blob([msg.text ?? ""]),
      );
    } else if (msg.op === "sweep") {
      await sweepTemps();
      ctx.postMessage({ id: msg.id, type: "done" });
    }
  };
  run().catch((err: unknown) => {
    ctx.postMessage({
      id: msg.id,
      type: "error",
      name: err instanceof Error ? err.name : "Error",
      message: err instanceof Error ? err.message : String(err),
    });
  });
};
