import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory stand-in for the OPFS root, shared by the mocked opfs-writer
// (main-thread proxy for the write worker) and the fake FileSystemDirectoryHandle
// tile-store.ts reads through directly. Lets these tests exercise the real
// read-modify-write / enumeration logic in tile-store.ts without a browser.
const mockFiles = vi.hoisted(() => new Map<string, string>());

vi.mock("./opfs-writer", () => ({
  opfsFetchWrite: vi.fn(
    async (
      _url: string,
      filename: string,
      onProgress?: (loaded: number, total: number) => void,
    ) => {
      onProgress?.(10, 10);
      mockFiles.set(filename, "chart-bytes");
      return { size: 10, etag: '"etag1"' };
    },
  ),
  opfsWriteBlob: vi.fn(async (filename: string, blob: Blob) => {
    mockFiles.set(filename, await blob.text());
  }),
  opfsWriteText: vi.fn(async (filename: string, text: string) => {
    mockFiles.set(filename, text);
  }),
}));

import {
  deleteAllCharts,
  deleteChart,
  downloadChart,
  importChart,
  isUpdateAvailable,
  listStoredCharts,
  type RemoteChartMeta,
  type StoredChartInfo,
} from "./tile-store";

function makeFakeRoot() {
  return {
    async getFileHandle(name: string, opts?: { create?: boolean }) {
      if (!mockFiles.has(name)) {
        if (opts?.create) mockFiles.set(name, "");
        else throw new DOMException("not found", "NotFoundError");
      }
      return {
        async getFile() {
          return new File([mockFiles.get(name) ?? ""], name);
        },
      };
    },
    async removeEntry(name: string) {
      if (!mockFiles.has(name)) {
        throw new DOMException("not found", "NotFoundError");
      }
      mockFiles.delete(name);
    },
    keys() {
      return mockFiles.keys();
    },
  };
}

beforeEach(() => {
  mockFiles.clear();
  vi.stubGlobal("navigator", {
    storage: { getDirectory: vi.fn(async () => makeFakeRoot()) },
  });
});

const stored = (over: Partial<StoredChartInfo> = {}): StoredChartInfo => ({
  filename: "nautical-x.pmtiles",
  region: "nautical-x",
  sizeBytes: 1000,
  downloadedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

describe("isUpdateAvailable", () => {
  it("etag match = no update", () => {
    expect(
      isUpdateAvailable(stored({ etag: '"abc"' }), { etag: '"abc"' }),
    ).toBe(false);
  });

  it("etag differs = update", () => {
    expect(
      isUpdateAvailable(stored({ etag: '"abc"' }), { etag: '"def"' }),
    ).toBe(true);
  });

  it("ignores weak-validator prefix and quotes when comparing etags", () => {
    expect(
      isUpdateAvailable(stored({ etag: '"abc"' }), { etag: 'W/"abc"' }),
    ).toBe(false);
  });

  it("falls back to last-modified newer than download time", () => {
    const s = stored({ downloadedAt: "2026-01-01T00:00:00.000Z" });
    expect(
      isUpdateAvailable(s, { lastModified: "Wed, 02 Jan 2026 00:00:00 GMT" }),
    ).toBe(true);
    expect(
      isUpdateAvailable(s, { lastModified: "Wed, 31 Dec 2025 00:00:00 GMT" }),
    ).toBe(false);
  });

  it("etag takes priority over last-modified", () => {
    // etag matches → current, even though last-modified looks newer
    const s = stored({ etag: '"abc"' });
    const remote: RemoteChartMeta = {
      etag: '"abc"',
      lastModified: "Wed, 02 Jan 2030 00:00:00 GMT",
    };
    expect(isUpdateAvailable(s, remote)).toBe(false);
  });

  it("falls back to size difference when no etag/last-modified", () => {
    expect(
      isUpdateAvailable(stored({ sizeBytes: 1000 }), { sizeBytes: 2000 }),
    ).toBe(true);
    expect(
      isUpdateAvailable(stored({ sizeBytes: 1000 }), { sizeBytes: 1000 }),
    ).toBe(false);
  });

  it("no reliable signal = no update (don't nag)", () => {
    expect(isUpdateAvailable(stored(), {})).toBe(false);
  });
});

describe("chart metadata sidecar", () => {
  it("serializes concurrent downloads so neither entry is lost", async () => {
    // Both calls read the sidecar, mutate, and write back; without the
    // metaQueue serialization in tile-store.ts, whichever write lands last
    // would clobber the other's entry.
    await Promise.all([
      downloadChart("https://example.com/a.pmtiles", "a.pmtiles", () => {}),
      downloadChart("https://example.com/b.pmtiles", "b.pmtiles", () => {}),
    ]);
    const charts = await listStoredCharts();
    expect(charts.map((c) => c.filename).sort()).toEqual([
      "a.pmtiles",
      "b.pmtiles",
    ]);
  });

  it("serializes a concurrent download and import", async () => {
    await Promise.all([
      downloadChart("https://example.com/a.pmtiles", "a.pmtiles", () => {}),
      importChart(
        new File(["bytes"], "b.pmtiles", { type: "application/octet-stream" }),
      ),
    ]);
    const charts = await listStoredCharts();
    expect(charts.map((c) => c.filename).sort()).toEqual([
      "a.pmtiles",
      "b.pmtiles",
    ]);
  });

  it("delete removes only the targeted chart's meta entry", async () => {
    await downloadChart("https://example.com/a.pmtiles", "a.pmtiles", () => {});
    await downloadChart("https://example.com/b.pmtiles", "b.pmtiles", () => {});
    await deleteChart("a.pmtiles");
    const charts = await listStoredCharts();
    expect(charts.map((c) => c.filename)).toEqual(["b.pmtiles"]);
  });

  it("deleteAllCharts removes an orphaned file with no meta entry", async () => {
    // Simulate a chart file that made it to OPFS but whose meta entry was
    // lost (e.g. a crash during an earlier unguarded read-modify-write) —
    // deleteAllCharts used to iterate meta only and could never reach it.
    mockFiles.set("orphan.pmtiles", "bytes");
    await downloadChart("https://example.com/a.pmtiles", "a.pmtiles", () => {});

    await deleteAllCharts();

    expect(mockFiles.has("orphan.pmtiles")).toBe(false);
    expect(mockFiles.has("a.pmtiles")).toBe(false);
    expect(await listStoredCharts()).toEqual([]);
  });
});
