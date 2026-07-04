/**
 * Protocol-seam tests for the OPFS write client (./opfs-writer.ts).
 *
 * These fake the `Worker` global entirely — no real OPFS, no real worker
 * thread — and drive opfs-writer's message protocol (start/progress/
 * done/error/abort) by hand, verifying the client's request bookkeeping,
 * progress plumbing, completion resolution, error propagation, and abort
 * handling. opfs-write-worker.ts itself has no independently-testable
 * pure helpers (its logic is entirely OPFS/fetch calls behind `self`),
 * so that side of the protocol isn't covered here — see the module
 * comment on that file.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface PostedMessage {
  id: number;
  op: string;
  [key: string]: unknown;
}

/** Minimal stand-in for the Worker constructed by opfs-writer's getWorker(). */
class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  posted: PostedMessage[] = [];
  terminated = false;

  readonly url: URL | string;
  readonly options?: WorkerOptions;

  constructor(url: URL | string, options?: WorkerOptions) {
    this.url = url;
    this.options = options;
    FakeWorker.instances.push(this);
  }

  postMessage(msg: PostedMessage): void {
    this.posted.push(msg);
  }

  terminate(): void {
    this.terminated = true;
  }

  /** Test helper: simulate a message arriving from the worker thread. */
  emit(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent);
  }
}

beforeEach(() => {
  FakeWorker.instances.length = 0;
  vi.stubGlobal("Worker", FakeWorker);
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function loadWriter() {
  return import("./opfs-writer");
}

/** The single worker opfs-writer lazily creates on its first request. */
function theWorker(): FakeWorker {
  expect(FakeWorker.instances).toHaveLength(1);
  return FakeWorker.instances[0];
}

describe("opfsWritable", () => {
  it("is false when navigator.storage.getDirectory is unavailable", async () => {
    vi.stubGlobal("navigator", {});
    const { opfsWritable } = await loadWriter();
    expect(opfsWritable()).toBe(false);
  });

  it("is true when Worker exists and OPFS getDirectory is available", async () => {
    vi.stubGlobal("navigator", { storage: { getDirectory: () => {} } });
    const { opfsWritable } = await loadWriter();
    expect(opfsWritable()).toBe(true);
  });

  it("is false when Worker is unavailable, even with OPFS present", async () => {
    vi.stubGlobal("navigator", { storage: { getDirectory: () => {} } });
    vi.stubGlobal("Worker", undefined);
    const { opfsWritable } = await loadWriter();
    expect(opfsWritable()).toBe(false);
  });
});

describe("opfsFetchWrite protocol", () => {
  it("posts a fetchWrite request with an incrementing id", async () => {
    const { opfsFetchWrite } = await loadWriter();
    const p1 = opfsFetchWrite("https://x/a.pmtiles", "a.pmtiles");
    const w = theWorker();
    expect(w.posted[0]).toMatchObject({
      op: "fetchWrite",
      url: "https://x/a.pmtiles",
      filename: "a.pmtiles",
    });
    const id1 = w.posted[0].id;
    w.emit({ id: id1, type: "done", size: 10 });
    await expect(p1).resolves.toEqual({ size: 10, etag: undefined });

    const p2 = opfsFetchWrite("https://x/b.pmtiles", "b.pmtiles");
    const id2 = w.posted[1].id;
    expect(id2).not.toBe(id1);
    w.emit({ id: id2, type: "done", size: 20, etag: '"abc"' });
    await expect(p2).resolves.toEqual({ size: 20, etag: '"abc"' });
  });

  it("routes progress events to onProgress before resolving on done", async () => {
    const { opfsFetchWrite } = await loadWriter();
    const seen: [number, number][] = [];
    const p = opfsFetchWrite("https://x/a.pmtiles", "a.pmtiles", (l, t) =>
      seen.push([l, t]),
    );
    const w = theWorker();
    const { id } = w.posted[0];
    w.emit({ id, type: "progress", loaded: 100, total: 1000 });
    w.emit({ id, type: "progress", loaded: 500, total: 1000 });
    // Not yet resolved — only progress so far.
    let resolved = false;
    p.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);
    w.emit({ id, type: "done", size: 1000 });
    await expect(p).resolves.toEqual({ size: 1000, etag: undefined });
    expect(seen).toEqual([
      [100, 1000],
      [500, 1000],
    ]);
  });

  it("rejects with a named Error on an error message", async () => {
    const { opfsFetchWrite } = await loadWriter();
    const p = opfsFetchWrite("https://x/a.pmtiles", "a.pmtiles");
    const w = theWorker();
    const { id } = w.posted[0];
    w.emit({ id, type: "error", name: "AbortError", message: "boom" });
    await expect(p).rejects.toMatchObject({
      name: "AbortError",
      message: "boom",
    });
  });

  it("defaults the error name to 'Error' when the worker omits it", async () => {
    const { opfsFetchWrite } = await loadWriter();
    const p = opfsFetchWrite("https://x/a.pmtiles", "a.pmtiles");
    const w = theWorker();
    const { id } = w.posted[0];
    w.emit({ id, type: "error", message: "incomplete download" });
    await expect(p).rejects.toMatchObject({
      name: "Error",
      message: "incomplete download",
    });
  });

  it("ignores a message for an id it doesn't recognize (stale/duplicate)", async () => {
    const { opfsFetchWrite } = await loadWriter();
    const p = opfsFetchWrite("https://x/a.pmtiles", "a.pmtiles");
    const w = theWorker();
    const { id } = w.posted[0];
    // Unknown id — must not throw and must not affect the pending request.
    expect(() => w.emit({ id: id + 999, type: "done", size: 1 })).not.toThrow();
    w.emit({ id, type: "done", size: 42 });
    await expect(p).resolves.toEqual({ size: 42, etag: undefined });
  });

  it("ignores a duplicate done/error for an already-settled id", async () => {
    const { opfsFetchWrite } = await loadWriter();
    const p = opfsFetchWrite("https://x/a.pmtiles", "a.pmtiles");
    const w = theWorker();
    const { id } = w.posted[0];
    w.emit({ id, type: "done", size: 42 });
    // A second message for the same (now-deleted) id must be a no-op.
    expect(() =>
      w.emit({ id, type: "error", name: "Error", message: "late" }),
    ).not.toThrow();
    await expect(p).resolves.toEqual({ size: 42, etag: undefined });
  });
});

describe("abort handling", () => {
  it("rejects immediately without posting when the signal is already aborted", async () => {
    const { opfsFetchWrite } = await loadWriter();
    const ac = new AbortController();
    ac.abort();
    const p = opfsFetchWrite(
      "https://x/a.pmtiles",
      "a.pmtiles",
      undefined,
      ac.signal,
    );
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    // The worker is still lazily created, but no message is ever posted
    // to it for an already-aborted request.
    expect(theWorker().posted).toHaveLength(0);
  });

  it("posts an abort op and rejects when the signal aborts mid-flight", async () => {
    const { opfsFetchWrite } = await loadWriter();
    const ac = new AbortController();
    const p = opfsFetchWrite(
      "https://x/a.pmtiles",
      "a.pmtiles",
      undefined,
      ac.signal,
    );
    const w = theWorker();
    const { id } = w.posted[0];
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    expect(w.posted[1]).toEqual({ id, op: "abort" });
  });

  it("a done/error arriving after abort is ignored (pending entry already removed)", async () => {
    const { opfsFetchWrite } = await loadWriter();
    const ac = new AbortController();
    const p = opfsFetchWrite(
      "https://x/a.pmtiles",
      "a.pmtiles",
      undefined,
      ac.signal,
    );
    const w = theWorker();
    const { id } = w.posted[0];
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    // A late "done" from the worker (which hasn't seen the abort yet)
    // must not resolve or throw.
    expect(() => w.emit({ id, type: "done", size: 1 })).not.toThrow();
  });
});

describe("opfsWriteBlob / opfsWriteText", () => {
  it("writeBlob posts writeBlob with the filename and blob, resolves on done", async () => {
    const { opfsWriteBlob } = await loadWriter();
    const blob = new Blob(["hello"]);
    const p = opfsWriteBlob("note.txt", blob);
    const w = theWorker();
    expect(w.posted[0]).toMatchObject({
      op: "writeBlob",
      filename: "note.txt",
    });
    expect(w.posted[0].blob).toBe(blob);
    w.emit({ id: w.posted[0].id, type: "done", size: 5 });
    await expect(p).resolves.toBeUndefined();
  });

  it("writeText posts writeText with the filename and text, resolves on done", async () => {
    const { opfsWriteText } = await loadWriter();
    const p = opfsWriteText("meta.json", "{}");
    const w = theWorker();
    expect(w.posted[0]).toMatchObject({
      op: "writeText",
      filename: "meta.json",
      text: "{}",
    });
    w.emit({ id: w.posted[0].id, type: "done", size: 2 });
    await expect(p).resolves.toBeUndefined();
  });

  it("writeText propagates an error", async () => {
    const { opfsWriteText } = await loadWriter();
    const p = opfsWriteText("meta.json", "{}");
    const w = theWorker();
    w.emit({
      id: w.posted[0].id,
      type: "error",
      name: "QuotaExceededError",
      message: "no space",
    });
    await expect(p).rejects.toMatchObject({ name: "QuotaExceededError" });
  });
});

describe("worker reuse", () => {
  it("reuses the same Worker instance across multiple requests", async () => {
    const { opfsFetchWrite } = await loadWriter();
    const p1 = opfsFetchWrite("https://x/a", "a");
    const p2 = opfsFetchWrite("https://x/b", "b");
    expect(FakeWorker.instances).toHaveLength(1);
    const w = theWorker();
    w.emit({ id: w.posted[0].id, type: "done", size: 1 });
    w.emit({ id: w.posted[1].id, type: "done", size: 2 });
    await Promise.all([p1, p2]);
  });
});
