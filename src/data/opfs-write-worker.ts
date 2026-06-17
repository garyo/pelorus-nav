/**
 * OPFS write worker.
 *
 * iOS WKWebView (through at least 17.x) exposes no main-thread OPFS write API —
 * `FileSystemFileHandle.createWritable` is undefined. The only way to write an
 * OPFS file there is `createSyncAccessHandle`, which is synchronous and only
 * available inside a Worker. Doing all writes here means one code path works on
 * iOS, Android, and desktop, instead of branching on `createWritable`.
 *
 * Protocol (main → worker): { id, op, ... }
 *   - fetchWrite { url, filename }  — stream a URL to an OPFS file, posting progress
 *   - writeBlob  { filename, blob } — write a Blob (e.g. an imported file)
 *   - writeText  { filename, text } — write a string (e.g. the metadata sidecar)
 *   - abort      {}                 — cancel an in-flight fetchWrite
 * Worker → main: { id, type: "progress" | "done" | "error", ... }
 */

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

async function fetchWrite(
  id: number,
  url: string,
  filename: string,
): Promise<void> {
  const ac = new AbortController();
  controllers.set(id, ac);
  let access: FileSystemSyncAccessHandle | null = null;
  try {
    const resp = await fetch(url, { cache: "no-store", signal: ac.signal });
    if (!resp.ok || !resp.body) {
      throw new Error(`Download failed: ${resp.status} ${resp.statusText}`);
    }
    const total = Number(resp.headers.get("content-length") || 0);
    const etag = resp.headers.get("etag") ?? undefined;
    access = await openAccess(filename);
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
    access.flush();
    ctx.postMessage({ id, type: "done", size: offset, etag });
  } catch (err) {
    // Leave no partial/corrupt file behind.
    await removeQuietly(filename);
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
