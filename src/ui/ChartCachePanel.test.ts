// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CHART_REGIONS, type ChartRegion } from "../data/chart-catalog";
import type { StoredChartInfo } from "../data/tile-store";

const tileStoreMocks = vi.hoisted(() => ({
  downloadChart: vi.fn(),
  downloadAuxFile: vi.fn().mockResolvedValue(undefined),
  listStoredCharts: vi.fn().mockResolvedValue([]),
  getStorageEstimate: vi.fn().mockResolvedValue({ used: 0, quota: 0 } as {
    used: number;
    quota: number;
  }),
  deleteChart: vi.fn().mockResolvedValue(undefined),
  deleteAllCharts: vi.fn().mockResolvedValue(undefined),
  deleteAuxFile: vi.fn().mockResolvedValue(undefined),
  fetchRemoteChartMeta: vi.fn().mockResolvedValue(null),
  isUpdateAvailable: vi.fn().mockReturnValue(false),
  importChart: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../data/tile-store", () => tileStoreMocks);

const { ChartCachePanel } = await import("./ChartCachePanel");

/** Private-method access for tests — the download queue is not public API. */
type ChartCachePanelInternals = {
  el: HTMLDivElement;
  regionJob(region: ChartRegion): unknown;
  runDownloads(jobs: unknown[]): Promise<void>;
};

function makeRegion(): ChartRegion {
  return {
    id: "test-region",
    name: "Test Region",
    filename: "test-region.pmtiles",
    coverageFilename: "test-region.coverage.geojson",
    sizeEstimate: 1000,
    center: [0, 0],
    defaultZoom: 8,
    bbox: [-1, -1, 1, 1],
  };
}

describe("ChartCachePanel.isBusy", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    tileStoreMocks.downloadChart.mockReset();
  });

  it("is false before any download starts", () => {
    const panel = new ChartCachePanel();
    expect(panel.isBusy()).toBe(false);
  });

  it("is true while a download is in flight and false once it settles", async () => {
    let resolveDownload: () => void = () => {};
    tileStoreMocks.downloadChart.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveDownload = resolve;
        }),
    );

    const panel = new ChartCachePanel();
    const internals = panel as unknown as ChartCachePanelInternals;
    const downloadPromise = internals.runDownloads([
      internals.regionJob(makeRegion()),
    ]);

    // Let the download kick off (AbortController assigned) before checking.
    await Promise.resolve();
    expect(panel.isBusy()).toBe(true);

    resolveDownload();
    await downloadPromise;
    expect(panel.isBusy()).toBe(false);
  });
});

function stored(filename: string): StoredChartInfo {
  return {
    filename,
    region: filename,
    sizeBytes: 1000,
    downloadedAt: "2026-01-01T00:00:00Z",
    etag: "old",
  };
}

describe("ChartCachePanel update all", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    tileStoreMocks.downloadChart.mockReset();
    tileStoreMocks.downloadChart.mockResolvedValue(undefined);
    tileStoreMocks.fetchRemoteChartMeta.mockReset();
    tileStoreMocks.isUpdateAvailable.mockReset();
    tileStoreMocks.listStoredCharts.mockReset();
  });

  it("queues every out-of-date download behind one button, in catalog order", async () => {
    const [first, second] = CHART_REGIONS;
    tileStoreMocks.listStoredCharts.mockResolvedValue([
      stored(second.filename),
      stored(first.filename),
    ]);
    // The later region's HEAD answers first — the queue must not follow
    // reply order.
    tileStoreMocks.fetchRemoteChartMeta.mockImplementation((url: string) =>
      url.endsWith(first.filename)
        ? new Promise((resolve) =>
            setTimeout(() => resolve({ etag: "new" }), 5),
          )
        : Promise.resolve({ etag: "new" }),
    );
    tileStoreMocks.isUpdateAvailable.mockReturnValue(true);

    const panel = new ChartCachePanel();
    // The panel lives in the shared panel stack, which an earlier body reset
    // may have detached from the document — so query the panel itself.
    const el = (panel as unknown as ChartCachePanelInternals).el;
    panel.show();

    const text = () =>
      el.querySelector(".chart-cache-update-all-text")?.textContent;
    await vi.waitFor(() => expect(text()).toBe("2 updates available"));
    expect(el.querySelectorAll(".chart-region-update")).toHaveLength(2);

    el.querySelector<HTMLButtonElement>(
      ".chart-cache-update-all button",
    )?.click();
    await vi.waitFor(() =>
      expect(tileStoreMocks.downloadChart).toHaveBeenCalledTimes(2),
    );
    expect(
      tileStoreMocks.downloadChart.mock.calls.map((call) => call[1]),
    ).toEqual([first.filename, second.filename]);
  });

  it("shows no Update All row when nothing is out of date", async () => {
    tileStoreMocks.listStoredCharts.mockResolvedValue([
      stored(CHART_REGIONS[0].filename),
    ]);
    tileStoreMocks.fetchRemoteChartMeta.mockResolvedValue({ etag: "old" });
    tileStoreMocks.isUpdateAvailable.mockReturnValue(false);

    const panel = new ChartCachePanel();
    const el = (panel as unknown as ChartCachePanelInternals).el;
    panel.show();
    await vi.waitFor(() =>
      expect(el.querySelectorAll(".manager-item").length).toBeGreaterThan(0),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(el.querySelector(".chart-cache-update-all")).toBeNull();
  });
});
