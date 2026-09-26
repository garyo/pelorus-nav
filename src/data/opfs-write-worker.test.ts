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
 * `moveIntoPlace` copy fallback (very old WebViews where `move` is missing
 * or throws) is exercised the same way, along with the `sweep` op that
 * recovers crash-interrupted fallback moves via the `.moving` marker.
 * `fetchWrite` runs against a stubbed `fetch`, covering resume (Range +
 * etag check), the stall watchdog, and which failures keep the partial.
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
  readonly name: string;
  private readonly files: FileMap;

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

  async getFile(): Promise<Blob> {
    return new Blob([
      (this.root.files.get(this.name) ?? new Uint8Array(0)).slice(),
    ]);
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

  keys(): IterableIterator<string> {
    return this.files.keys();
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

/** Make writes to `victim` silently drop their bytes (report success, store nothing). */
function sabotageWritesTo(victim: string): void {
  const realWrite = FakeSyncAccessHandle.prototype.write;
  vi.spyOn(FakeSyncAccessHandle.prototype, "write").mockImplementation(
    function (
      this: FakeSyncAccessHandle,
      data: Uint8Array,
      opts: { at: number },
    ) {
      if (this.name === victim) return data.byteLength;
      return realWrite.call(this, data, opts);
    },
  );
}

describe("moveIntoPlace fallbacks", () => {
  it.each<MoveMode>([
    "missing",
    "throws",
  ])("copies into place when move is %s (very old WebViews)", async (moveMode) => {
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
    expect(root.files.has("chart.pmtiles.moving")).toBe(false);
  });

  it("deletes the corrupt destination and reports an error when copy verification fails", async () => {
    await loadWorker();
    root.moveMode = "missing";
    sabotageWritesTo("chart.pmtiles");
    const reply = await send({
      op: "writeBlob",
      filename: "chart.pmtiles",
      blob: streamOnlyBlob(["doomed bytes"]),
    });
    expect(reply.type).toBe("error");
    expect(reply.message).toContain("verification failed");
    // No corrupt final file may survive a failed copy.
    expect(root.files.has("chart.pmtiles")).toBe(false);
    // The caller removed the temp, so the marker is an orphan the next
    // sweep clears without touching anything else.
    expect(root.files.has("chart.pmtiles.moving")).toBe(true);
    const sweepReply = await send({ op: "sweep" });
    expect(sweepReply.type).toBe("done");
    expect(root.files.has("chart.pmtiles.moving")).toBe(false);
  });

  it("clears a stale marker before writing a fresh temp", async () => {
    await loadWorker();
    // Leftover marker from an earlier failed attempt: if it survived next
    // to this write's (partial) temp, the sweep would take the temp as
    // proven complete and install a truncated file.
    root.files.set("chart.pmtiles.moving", new Uint8Array(0));
    const reply = await send({
      op: "writeBlob",
      filename: "chart.pmtiles",
      blob: streamOnlyBlob(["fresh "], 1), // stream dies mid-download
    });
    expect(reply.type).toBe("error");
    expect(root.files.has("chart.pmtiles.downloading")).toBe(false);
    expect(root.files.has("chart.pmtiles.moving")).toBe(false);
  });
});

describe("sweep", () => {
  it.each<[string, string | undefined]>([
    ["a torn partial destination", "full ch"],
    ["no destination at all", undefined],
  ])("finishes an interrupted fallback move: %s, marker proves the temp complete", async (_case, destContent) => {
    await loadWorker();
    root.moveMode = "throws"; // the device class that needs the fallback
    const enc = new TextEncoder();
    root.files.set("chart.pmtiles.downloading", enc.encode("full chart bytes"));
    root.files.set("chart.pmtiles.moving", new Uint8Array(0));
    if (destContent !== undefined) {
      root.files.set("chart.pmtiles", enc.encode(destContent));
    }
    const reply = await send({ op: "sweep" });
    expect(reply.type).toBe("done");
    expect(contentOf("chart.pmtiles")).toBe("full chart bytes");
    expect(root.files.has("chart.pmtiles.downloading")).toBe(false);
    expect(root.files.has("chart.pmtiles.moving")).toBe(false);
  });

  it("deletes a markerless temp without installing it (possible partial download)", async () => {
    await loadWorker();
    const enc = new TextEncoder();
    root.files.set("a.pmtiles.downloading", enc.encode("half a cha"));
    root.files.set("b.pmtiles", enc.encode("good chart"));
    root.files.set("b.pmtiles.downloading", enc.encode("half"));
    const reply = await send({ op: "sweep" });
    expect(reply.type).toBe("done");
    expect(root.files.has("a.pmtiles")).toBe(false);
    expect(root.files.has("a.pmtiles.downloading")).toBe(false);
    expect(contentOf("b.pmtiles")).toBe("good chart");
    expect(root.files.has("b.pmtiles.downloading")).toBe(false);
  });

  it("drops an orphaned marker once the move has completed", async () => {
    await loadWorker();
    const enc = new TextEncoder();
    root.files.set("chart.pmtiles", enc.encode("good chart"));
    root.files.set("chart.pmtiles.moving", new Uint8Array(0));
    const reply = await send({ op: "sweep" });
    expect(reply.type).toBe("done");
    expect(contentOf("chart.pmtiles")).toBe("good chart");
    expect(root.files.has("chart.pmtiles.moving")).toBe(false);
  });

  it("keeps the temp and marker when recovery verification fails", async () => {
    await loadWorker();
    root.moveMode = "missing";
    const enc = new TextEncoder();
    root.files.set("chart.pmtiles.downloading", enc.encode("full chart bytes"));
    root.files.set("chart.pmtiles.moving", new Uint8Array(0));
    sabotageWritesTo("chart.pmtiles");
    const reply = await send({ op: "sweep" });
    expect(reply.type).toBe("done"); // per-file best effort
    expect(contentOf("chart.pmtiles.downloading")).toBe("full chart bytes");
    expect(root.files.has("chart.pmtiles.moving")).toBe(true);
    expect(root.files.has("chart.pmtiles")).toBe(false);
  });
});

const ETAG = '"build-1"';
const FULL = "0123456789abcdefghij"; // the 20-byte file on the server

interface FakeReply {
  status?: number;
  headers?: Record<string, string>;
  /** Chunks to deliver; the stream then ends, or fails with `fail`. */
  chunks?: string[];
  fail?: "network" | "hang";
}

/**
 * Stub `fetch` with one reply per call, in order, recording each request's
 * Range header. A "network" failure errors the body the way a dropped
 * connection does (TypeError); "hang" never delivers another byte.
 */
function stubFetch(replies: FakeReply[]): { ranges: (string | null)[] } {
  const ranges: (string | null)[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const range = new Headers(init.headers).get("range");
      ranges.push(range);
      const reply = replies.shift();
      if (!reply) throw new TypeError("Failed to fetch");
      const chunks = (reply.chunks ?? []).map((c) =>
        new TextEncoder().encode(c),
      );
      // Chunks are handed out one per pull: erroring a stream discards
      // whatever it still has queued.
      const body = new ReadableStream<Uint8Array>({
        pull(c) {
          const chunk = chunks.shift();
          if (chunk) c.enqueue(chunk);
          else if (reply.fail === "network") {
            c.error(new TypeError("network error"));
          } else if (reply.fail === "hang") {
            return new Promise<void>((_resolve, reject) =>
              init.signal?.addEventListener("abort", () =>
                reject(new DOMException("Aborted", "AbortError")),
              ),
            );
          } else c.close();
        },
      });
      return new Response(body, {
        status: reply.status ?? 200,
        headers: reply.headers,
      });
    }),
  );
  return { ranges };
}

/** A whole-file 200 reply for `content` from build `etag`. */
function whole(content: string, etag = ETAG, fail?: FakeReply["fail"]) {
  return {
    headers: { etag, "content-length": String(content.length) },
    chunks: fail ? [content.slice(0, 8)] : [content],
    fail,
  };
}

/** A 206 reply continuing the server file from `start`. */
function rest(start: number, etag = ETAG): FakeReply {
  return {
    status: 206,
    headers: {
      etag,
      "content-range": `bytes ${start}-${FULL.length - 1}/${FULL.length}`,
      "content-length": String(FULL.length - start),
    },
    chunks: [FULL.slice(start)],
  };
}

function resumeOf(filename: string): Record<string, unknown> | null {
  const data = root.files.get(`${filename}.resume`);
  return data ? JSON.parse(new TextDecoder().decode(data)) : null;
}

describe("fetchWrite", () => {
  const fetchChart = () =>
    send({
      op: "fetchWrite",
      url: "/chart.pmtiles",
      filename: "chart.pmtiles",
    });

  it("keeps the partial after a network drop and resumes it with a Range request", async () => {
    await loadWorker();
    const { ranges } = stubFetch([whole(FULL, ETAG, "network"), rest(8)]);

    const failed = await fetchChart();
    expect(failed).toMatchObject({ type: "error", name: "TypeError" });
    expect(contentOf("chart.pmtiles.downloading")).toBe(FULL.slice(0, 8));
    expect(resumeOf("chart.pmtiles")).toMatchObject({
      etag: ETAG,
      bytes: 8,
      total: 20,
    });

    const reply = await fetchChart();
    expect(reply).toMatchObject({ type: "done", size: 20, etag: ETAG });
    expect(ranges).toEqual([null, "bytes=8-"]);
    expect(contentOf("chart.pmtiles")).toBe(FULL);
    expect(root.files.has("chart.pmtiles.downloading")).toBe(false);
    expect(root.files.has("chart.pmtiles.resume")).toBe(false);
  });

  it("starts over, never splicing builds, when the server has a new build", async () => {
    await loadWorker();
    const next = "ABCDEFGHIJKLMNOPQRST";
    const { ranges } = stubFetch([
      whole(FULL, ETAG, "network"),
      rest(8, '"build-2"'),
      whole(next, '"build-2"'),
    ]);
    await fetchChart();
    const reply = await fetchChart();
    expect(reply).toMatchObject({ type: "done", etag: '"build-2"' });
    expect(ranges).toEqual([null, "bytes=8-", null]);
    expect(contentOf("chart.pmtiles")).toBe(next);
  });

  it("takes a whole-file reply when the server ignores Range", async () => {
    await loadWorker();
    const { ranges } = stubFetch([whole(FULL, ETAG, "network"), whole(FULL)]);
    await fetchChart();
    const reply = await fetchChart();
    expect(reply).toMatchObject({ type: "done", size: 20 });
    expect(ranges).toEqual([null, "bytes=8-"]);
    expect(contentOf("chart.pmtiles")).toBe(FULL);
  });

  it("keeps the resume state when the retry itself can't connect", async () => {
    await loadWorker();
    stubFetch([whole(FULL, ETAG, "network")]); // then "Failed to fetch"
    await fetchChart();
    const again = await fetchChart();
    expect(again).toMatchObject({ type: "error", message: "Failed to fetch" });
    expect(contentOf("chart.pmtiles.downloading")).toBe(FULL.slice(0, 8));
    expect(resumeOf("chart.pmtiles")).toMatchObject({ bytes: 8 });
  });

  it("fails a stalled download with a clear message and keeps it resumable", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await loadWorker();
      stubFetch([whole(FULL, ETAG, "hang")]);
      const pending = fetchChart();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(await pending).toMatchObject({
        type: "error",
        name: "StallError",
        message: "download stalled — no data for 60 s",
      });
      expect(resumeOf("chart.pmtiles")).toMatchObject({ bytes: 8 });
    } finally {
      vi.useRealTimers();
    }
  });

  it.each<[string, FakeReply]>([
    [
      "no etag",
      {
        headers: { "content-length": "20" },
        chunks: ["01234567"],
        fail: "network",
      },
    ],
    ["a weak etag", { ...whole(FULL, `W/${ETAG}`, "network") }],
  ])("deletes the partial when the reply has %s", async (_case, reply) => {
    await loadWorker();
    stubFetch([reply]);
    expect((await fetchChart()).type).toBe("error");
    expect(root.files.has("chart.pmtiles.downloading")).toBe(false);
    expect(root.files.has("chart.pmtiles.resume")).toBe(false);
  });

  it("deletes the partial and its resume state on cancel", async () => {
    await loadWorker();
    stubFetch([
      whole(FULL, ETAG, "network"),
      { ...rest(8), chunks: ["89"], fail: "hang" },
    ]);
    await fetchChart();
    const id = nextId;
    const pending = fetchChart();
    await vi.waitFor(() =>
      expect(contentOf("chart.pmtiles.downloading")).toBe(FULL.slice(0, 10)),
    );
    fakeSelf.onmessage?.({ data: { id, op: "abort" } } as MessageEvent);
    expect(await pending).toMatchObject({ type: "error", name: "AbortError" });
    expect(root.files.has("chart.pmtiles.downloading")).toBe(false);
    expect(root.files.has("chart.pmtiles.resume")).toBe(false);
  });

  it("deletes the partial on an HTTP error", async () => {
    await loadWorker();
    stubFetch([whole(FULL, ETAG, "network"), { status: 404 }, { status: 404 }]);
    await fetchChart();
    expect(await fetchChart()).toMatchObject({
      type: "error",
      message: "HTTP 404 ",
    });
    expect(root.files.has("chart.pmtiles.downloading")).toBe(false);
    expect(root.files.has("chart.pmtiles.resume")).toBe(false);
  });
});

describe("sweep of resumable downloads", () => {
  const enc = new TextEncoder();
  const sidecar = (savedAt: number) =>
    enc.encode(JSON.stringify({ etag: ETAG, bytes: 8, total: 20, savedAt }));

  it("keeps a temp with valid resume state", async () => {
    await loadWorker();
    root.files.set("chart.pmtiles.downloading", enc.encode(FULL.slice(0, 8)));
    root.files.set("chart.pmtiles.resume", sidecar(Date.now()));
    expect((await send({ op: "sweep" })).type).toBe("done");
    expect(contentOf("chart.pmtiles.downloading")).toBe(FULL.slice(0, 8));
    expect(root.files.has("chart.pmtiles.resume")).toBe(true);
  });

  it("deletes an expired resumable temp and an orphaned sidecar", async () => {
    await loadWorker();
    root.files.set("a.pmtiles.downloading", enc.encode(FULL.slice(0, 8)));
    root.files.set("a.pmtiles.resume", sidecar(Date.now() - 8 * 86_400_000));
    root.files.set("b.pmtiles.resume", sidecar(Date.now()));
    expect((await send({ op: "sweep" })).type).toBe("done");
    expect([...root.files.keys()]).toEqual([]);
  });

  it("drops a stale sidecar when a blob write replaces the temp", async () => {
    await loadWorker();
    root.files.set("chart.pmtiles.resume", sidecar(Date.now()));
    await send({
      op: "writeBlob",
      filename: "chart.pmtiles",
      blob: streamOnlyBlob(["imported "], 1),
    });
    expect(root.files.has("chart.pmtiles.resume")).toBe(false);
  });
});
