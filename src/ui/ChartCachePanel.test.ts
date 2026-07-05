// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChartRegion } from "../data/chart-catalog";

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

/** Private-method access for tests — startDownload is not part of the public API. */
type ChartCachePanelInternals = {
  startDownload(region: ChartRegion): Promise<void>;
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
    const downloadPromise = internals.startDownload(makeRegion());

    // Let the download kick off (AbortController assigned) before checking.
    await Promise.resolve();
    expect(panel.isBusy()).toBe(true);

    resolveDownload();
    await downloadPromise;
    expect(panel.isBusy()).toBe(false);
  });
});
