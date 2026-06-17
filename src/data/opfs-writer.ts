/**
 * Main-thread client for the OPFS write worker.
 *
 * All OPFS writes go through the worker so they use `createSyncAccessHandle`,
 * the only OPFS write API available on iOS WKWebView (see opfs-write-worker.ts).
 * The same path runs on Android and desktop, so there's no per-platform branch.
 */

interface DoneResult {
  size: number;
  etag?: string;
}

interface Pending {
  resolve: (v: DoneResult) => void;
  reject: (e: unknown) => void;
  onProgress?: (loaded: number, total: number) => void;
}

let worker: Worker | null = null;
const pending = new Map<number, Pending>();
let nextId = 1;

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./opfs-write-worker.ts", import.meta.url), {
    type: "module",
  });
  worker.onmessage = (e: MessageEvent) => {
    const msg = e.data as {
      id: number;
      type: "progress" | "done" | "error";
      loaded?: number;
      total?: number;
      size?: number;
      etag?: string;
      name?: string;
      message?: string;
    };
    const p = pending.get(msg.id);
    if (!p) return;
    if (msg.type === "progress") {
      p.onProgress?.(msg.loaded ?? 0, msg.total ?? 0);
    } else if (msg.type === "done") {
      pending.delete(msg.id);
      p.resolve({ size: msg.size ?? 0, etag: msg.etag });
    } else {
      pending.delete(msg.id);
      const err = new Error(msg.message ?? "OPFS write failed");
      err.name = msg.name ?? "Error";
      p.reject(err);
    }
  };
  return worker;
}

function request(
  op: string,
  payload: Record<string, unknown>,
  onProgress?: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<DoneResult> {
  const w = getWorker();
  const id = nextId++;
  return new Promise<DoneResult>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    pending.set(id, { resolve, reject, onProgress });
    signal?.addEventListener(
      "abort",
      () => {
        const p = pending.get(id);
        if (!p) return;
        pending.delete(id);
        w.postMessage({ id, op: "abort" });
        p.reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
    w.postMessage({ id, op, ...payload });
  });
}

/** True when OPFS writes are possible (Worker + OPFS in a secure context). */
export function opfsWritable(): boolean {
  return typeof Worker !== "undefined" && !!navigator.storage?.getDirectory;
}

/** Stream `url` into OPFS file `filename`, reporting progress. */
export function opfsFetchWrite(
  url: string,
  filename: string,
  onProgress?: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<DoneResult> {
  return request("fetchWrite", { url, filename }, onProgress, signal);
}

/** Write a Blob/File to OPFS file `filename`. */
export async function opfsWriteBlob(
  filename: string,
  blob: Blob,
): Promise<void> {
  await request("writeBlob", { filename, blob });
}

/** Write a string to OPFS file `filename`. */
export async function opfsWriteText(
  filename: string,
  text: string,
): Promise<void> {
  await request("writeText", { filename, text });
}
