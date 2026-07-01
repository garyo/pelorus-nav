/**
 * OPFS write worker.
 *
 * iOS WKWebView (through at least 17.x) exposes no main-thread OPFS write API —
 * `FileSystemFileHandle.createWritable` is undefined. The only way to write an
 * OPFS file there is `createSyncAccessHandle`, which is synchronous and only
 * available inside a Worker. Doing all writes here means one code path works on
 * iOS, Android, and desktop, instead of branching on `createWritable`.
 *
 * `fetchWrite` streams into a `${filename}.downloading` temp file and only
 * moves it over the final filename once the whole response has landed, so a
 * failed or aborted download never touches (let alone truncates) a chart the
 * user already has. See tile-store.ts for the startup sweep that clears any
 * `.downloading` leftovers from a hard crash mid-download.
 *
 * Protocol (main → worker): { id, op, ... }
 *   - fetchWrite { url, filename }  — stream a URL to an OPFS file, posting progress
 *   - writeBlob  { filename, blob } — write a Blob (e.g. an imported file)
 *   - writeText  { filename, text } — write a string (e.g. the metadata sidecar)
 *   - abort      {}                 — cancel an in-flight fetchWrite
 * Worker → main: { id, type: "progress" | "done" | "error", ... }
 */

import { isCompleteDownload } from "./download-completeness";

// In a module worker the global scope has Worker's postMessage/onmessage shape.
const ctx = self as unknown as Worker;

interface InMsg {
  id: number;
  op: "fetchWrite" | "writeBlob" | "writeText" | "abort";
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

/** Suffix for the in-progress copy of a streamed download. */
function tempName(filename: string): string {
  return `${filename}.downloading`;
}

/**
 * Promote a completed temp file over `filename`. Prefers the native rename
 * (`FileSystemFileHandle.move`), which is atomic and doesn't re-copy bytes;
 * falls back to a chunked sync-access copy + delete on browsers that don't
 * yet implement `move`.
 */
async function moveIntoPlace(from: string, filename: string): Promise<void> {
  const root = await getRoot();
  const tempHandle = await root.getFileHandle(from);
  if (typeof tempHandle.move === "function") {
    await tempHandle.move(filename);
    return;
  }
  const finalHandle = await root.getFileHandle(filename, { create: true });
  const src = await tempHandle.createSyncAccessHandle();
  const dst = await finalHandle.createSyncAccessHandle();
  try {
    dst.truncate(0);
    const size = src.getSize();
    const chunk = new Uint8Array(4 * 1024 * 1024);
    for (let at = 0; at < size; ) {
      const n = src.read(chunk, { at });
      if (n === 0) break;
      dst.write(n === chunk.length ? chunk : chunk.subarray(0, n), { at });
      at += n;
    }
    dst.flush();
  } finally {
    src.close();
    dst.close();
  }
  await root.removeEntry(from);
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

async function writeBytes(
  id: number,
  filename: string,
  bytes: Uint8Array,
): Promise<void> {
  let access: FileSystemSyncAccessHandle | null = null;
  try {
    access = await openAccess(filename);
    access.truncate(0);
    access.write(bytes, { at: 0 });
    access.flush();
    ctx.postMessage({ id, type: "done", size: bytes.byteLength });
  } catch (err) {
    // Same lock-before-remove ordering as fetchWrite: close before removing.
    access?.close();
    access = null;
    await removeQuietly(filename);
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
      const buf = new Uint8Array(await (msg.blob as Blob).arrayBuffer());
      await writeBytes(msg.id, msg.filename ?? "", buf);
    } else if (msg.op === "writeText") {
      await writeBytes(
        msg.id,
        msg.filename ?? "",
        new TextEncoder().encode(msg.text ?? ""),
      );
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
