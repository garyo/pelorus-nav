/**
 * Tests for the OPFS write worker (./opfs-write-worker.ts).
 *
 * The worker's logic is entirely OPFS calls behind the worker globals, so
 * these fake the whole seam: `self` (onmessage/postMessage) and
 * `navigator.storage.getDirectory()` backed by an in-memory file map. That
 * lets them assert the properties that matter and that a real browser run
 * would hide: writes stream chunk-by-chunk (never `blob.arrayBuffer()`),
 * land in a temp file, and only replace the final file after a complete
 * flush — a mid-write failure must leave an existing file untouched. The
 * `moveIntoPlace` copy fallback (WebViews where `move` throws, e.g. Amazon
 * Fire) is exercised the same way.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type FileMap = Map<string, Uint8Array>;

interface OutMsg {
  id: number;
  type: "progress" | "done" | "error";
  size?: number;
  loaded?: number;
  total?: number;
  name?: string;
  message?: string;
}

type MoveMode = "native" | "missing" | "throws";

class FakeSyncAccessHandle {
  closed = false;
  private readonly files: FileMap;
  private readonly name: string;

  constructor(files: FileMap, name: string) {
    this.files = files;
    this.name = name;
  }

  getSize(): number {
    return this.files.get(this.name)?.byteLength ?? 0;
  }

  truncate(size: number): void {
    const cur = this.files.get(this.name) ?? new Uint8Array(0);
    this.files.set(this.name, cur.slice(0, size));
  }

  write(data: Uint8Array, opts: { at: number }): number {
    if (this.closed) throw new Error("write on closed handle");
    const cur = this.files.get(this.name) ?? new Uint8Array(0);
    const end = opts.at + data.byteLength;
    const next = new Uint8Array(Math.max(cur.byteLength, end));
    next.set(cur);
    next.set(data, opts.at);
    this.files.set(this.name, next);
    return data.byteLength;
  }

  read(buf: Uint8Array, opts: { at: number }): number {
    const cur = this.files.get(this.name) ?? new Uint8Array(0);
    const n = Math.min(buf.byteLength, Math.max(0, cur.byteLength - opts.at));
    buf.set(cur.subarray(opts.at, opts.at + n));
    return n;
  }

  flush(): void {}

  close(): void {
    this.closed = true;
  }
}

class FakeFileHandle {
  // Present or absent depending on the root's moveMode, mirroring real
  // FileSystemFileHandle across browsers/WebViews.
  move?: (newName: string) => Promise<void>;

  private readonly root: FakeRoot;
  private name: string;

  constructor(root: FakeRoot, name: string) {
    this.root = root;
    this.name = name;
    if (root.moveMode !== "missing") {
      this.move = async (newName: string) => {
        if (root.moveMode === "throws") {
          throw new DOMException("move not allowed", "NotAllowedError");
        }
        const data = root.files.get(this.name);
        if (data === undefined) {
          throw new DOMException("not found", "NotFoundError");
        }
        root.files.set(newName, data);
        root.files.delete(this.name);
        this.name = newName;
      };
    }
  }

  async createSyncAccessHandle(): Promise<FakeSyncAccessHandle> {
    return new FakeSyncAccessHandle(this.root.files, this.name);
  }
}

class FakeRoot {
  files: FileMap = new Map();
  moveMode: MoveMode = "native";

  async getFileHandle(
    name: string,
    opts?: { create?: boolean },
  ): Promise<FakeFileHandle> {
    if (!this.files.has(name)) {
      if (!opts?.create) throw new DOMException("not found", "NotFoundError");
      this.files.set(name, new Uint8Array(0));
    }
    return new FakeFileHandle(this, name);
  }

  async removeEntry(name: string): Promise<void> {
    if (!this.files.delete(name)) {
      throw new DOMException("not found", "NotFoundError");
    }
  }
}

interface FakeSelf {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage: (m: OutMsg) => void;
}

let root: FakeRoot;
let fakeSelf: FakeSelf;
let posted: OutMsg[];
const waiters = new Map<number, (m: OutMsg) => void>();

beforeEach(() => {
  root = new FakeRoot();
  posted = [];
  waiters.clear();
  fakeSelf = {
    onmessage: null,
    postMessage: (m: OutMsg) => {
      posted.push(m);
      if (m.type === "done" || m.type === "error") {
        waiters.get(m.id)?.(m);
        waiters.delete(m.id);
      }
    },
  };
  vi.stubGlobal("self", fakeSelf);
  vi.stubGlobal("navigator", {
    storage: { getDirectory: async () => root },
  });
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

let nextId = 1;

/** Load the worker module (registers its onmessage on the fake self). */
async function loadWorker(): Promise<void> {
  await import("./opfs-write-worker");
  expect(fakeSelf.onmessage).toBeTypeOf("function");
}

/** Post a message to the worker and wait for its final done/error reply. */
function send(msg: Record<string, unknown>): Promise<OutMsg> {
  const id = nextId++;
  return new Promise<OutMsg>((resolve) => {
    waiters.set(id, resolve);
    fakeSelf.onmessage?.({ data: { id, ...msg } } as MessageEvent);
  });
}

function contentOf(filename: string): string {
  const data = root.files.get(filename);
  return data === undefined ? "<missing>" : new TextDecoder().decode(data);
}

/**
 * A Blob stand-in exposing only `stream()` — no `arrayBuffer()` — so any
 * regression back to whole-blob buffering fails loudly.
 */
function streamOnlyBlob(chunks: string[], failAfter?: number): Blob {
  return {
    stream: () =>
      new ReadableStream<Uint8Array>({
        start(c) {
          const enc = new TextEncoder();
          chunks.forEach((chunk, i) => {
            if (failAfter !== undefined && i >= failAfter) return;
            c.enqueue(enc.encode(chunk));
          });
          if (failAfter !== undefined) c.error(new Error("stream failed"));
          else c.close();
        },
      }),
  } as unknown as Blob;
}

describe("writeBlob", () => {
  it("streams chunk-by-chunk into place without ever calling arrayBuffer", async () => {
    await loadWorker();
    const reply = await send({
      op: "writeBlob",
      filename: "chart.pmtiles",
      blob: streamOnlyBlob(["hello ", "chart ", "bytes"]),
    });
    expect(reply).toMatchObject({ type: "done", size: 17 });
    expect(contentOf("chart.pmtiles")).toBe("hello chart bytes");
    expect(root.files.has("chart.pmtiles.downloading")).toBe(false);
  });

  it("replaces an existing file's content on success", async () => {
    await loadWorker();
    root.files.set("chart.pmtiles", new TextEncoder().encode("old copy"));
    const reply = await send({
      op: "writeBlob",
      filename: "chart.pmtiles",
      blob: new Blob(["new copy"]),
    });
    expect(reply.type).toBe("done");
    expect(contentOf("chart.pmtiles")).toBe("new copy");
  });

  it("leaves an existing file untouched and removes the temp when the stream fails", async () => {
    await loadWorker();
    root.files.set("chart.pmtiles", new TextEncoder().encode("good copy"));
    const reply = await send({
      op: "writeBlob",
      filename: "chart.pmtiles",
      blob: streamOnlyBlob(["partial "], 1),
    });
    expect(reply).toMatchObject({ type: "error", message: "stream failed" });
    expect(contentOf("chart.pmtiles")).toBe("good copy");
    expect(root.files.has("chart.pmtiles.downloading")).toBe(false);
  });

  it("reports an error (and writes nothing) when the write itself fails", async () => {
    await loadWorker();
    vi.spyOn(FakeSyncAccessHandle.prototype, "write").mockImplementation(() => {
      throw new DOMException("no space", "QuotaExceededError");
    });
    const reply = await send({
      op: "writeBlob",
      filename: "chart.pmtiles",
      blob: new Blob(["doomed"]),
    });
    expect(reply).toMatchObject({ type: "error", name: "QuotaExceededError" });
    expect(root.files.has("chart.pmtiles")).toBe(false);
    expect(root.files.has("chart.pmtiles.downloading")).toBe(false);
  });
});

describe("writeText", () => {
  it("writes UTF-8 text via the same temp-then-move path", async () => {
    await loadWorker();
    root.files.set("meta.json", new TextEncoder().encode("{}"));
    const reply = await send({
      op: "writeText",
      filename: "meta.json",
      text: '{"charts":[]}',
    });
    expect(reply).toMatchObject({ type: "done", size: 13 });
    expect(contentOf("meta.json")).toBe('{"charts":[]}');
    expect(root.files.has("meta.json.downloading")).toBe(false);
  });
});

describe("moveIntoPlace fallbacks", () => {
  it.each<MoveMode>([
    "missing",
    "throws",
  ])("copies into place when move is %s (Amazon Fire quirk)", async (moveMode) => {
    await loadWorker();
    root.moveMode = moveMode;
    root.files.set("chart.pmtiles", new TextEncoder().encode("old copy"));
    const reply = await send({
      op: "writeBlob",
      filename: "chart.pmtiles",
      blob: streamOnlyBlob(["copied ", "content"]),
    });
    expect(reply).toMatchObject({ type: "done", size: 14 });
    expect(contentOf("chart.pmtiles")).toBe("copied content");
    expect(root.files.has("chart.pmtiles.downloading")).toBe(false);
  });
});
