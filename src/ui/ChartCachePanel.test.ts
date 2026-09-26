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
  partialDownloadBytes: vi.fn().mockResolvedValue(0),
  discardPartialDownload: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../data/tile-store", () => tileStoreMocks);

const diag = vi.hoisted(() => vi.fn());
vi.mock("../utils/diag", () => ({ diag }));

const { ChartCachePanel } = await import("./ChartCachePanel");

/** Private-method access for tests — the download queue is not public API. */
type ChartCachePanelInternals = {
  el: HTMLDivElement;
  regionJob(region: ChartRegion): unknown;
  enqueue(jobs: unknown[]): Promise<void>;
};

/** A panel plus its root element (the shared panel stack may be detached
 * from the document by an earlier body reset, so tests query the panel). */
function makePanel(): {
  panel: InstanceType<typeof ChartCachePanel>;
  el: HTMLDivElement;
} {
  const panel = new ChartCachePanel();
  return { panel, el: (panel as unknown as ChartCachePanelInternals).el };
}

/** Resolve the mocked downloadChart by hand, one call at a time. */
function manualDownloads(): { resolveNext: () => void; count: () => number } {
  const resolvers: (() => void)[] = [];
  tileStoreMocks.downloadChart.mockImplementation(
    (_url: string, _file: string, _p: unknown, signal?: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
        resolvers.push(resolve);
        signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      }),
  );
  return {
    resolveNext: () => resolvers.shift()?.(),
    count: () => tileStoreMocks.downloadChart.mock.calls.length,
  };
}

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
    const downloads = manualDownloads();
    const panel = new ChartCachePanel();
    const internals = panel as unknown as ChartCachePanelInternals;
    await internals.enqueue([internals.regionJob(makeRegion())]);
    expect(panel.isBusy()).toBe(true);

    await vi.waitFor(() => expect(downloads.count()).toBe(1));
    downloads.resolveNext();
    await vi.waitFor(() => expect(panel.isBusy()).toBe(false));
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

    const { panel, el } = makePanel();
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

    const { panel, el } = makePanel();
    panel.show();
    await vi.waitFor(() =>
      expect(el.querySelectorAll(".manager-item").length).toBeGreaterThan(0),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(el.querySelector(".chart-cache-update-all")).toBeNull();
  });
});

describe("ChartCachePanel download queue", () => {
  const [first, second] = CHART_REGIONS;
  const downloadButton = (el: HTMLElement, region: ChartRegion) =>
    el.querySelector<HTMLButtonElement>(
      `[data-region-id="${region.id}"] button[title="Download for offline use"]`,
    );
  const detail = (el: HTMLElement, region: ChartRegion) =>
    el.querySelector(`[data-region-id="${region.id}"] .manager-item-detail`)
      ?.textContent ?? "";

  beforeEach(() => {
    document.body.innerHTML = "";
    tileStoreMocks.downloadChart.mockReset();
    tileStoreMocks.listStoredCharts.mockReset();
    tileStoreMocks.listStoredCharts.mockResolvedValue([]);
    tileStoreMocks.fetchRemoteChartMeta.mockReset();
    tileStoreMocks.fetchRemoteChartMeta.mockResolvedValue(null);
    tileStoreMocks.getStorageEstimate.mockResolvedValue({ used: 0, quota: 0 });
    tileStoreMocks.partialDownloadBytes.mockResolvedValue(0);
  });

  async function openPanel() {
    const { panel, el } = makePanel();
    panel.show();
    await vi.waitFor(() => expect(downloadButton(el, first)).not.toBeNull());
    return { panel, el };
  }

  it("keeps the list live and queues a second download behind the first", async () => {
    const downloads = manualDownloads();
    const { panel, el } = await openPanel();

    downloadButton(el, first)?.click();
    await vi.waitFor(() => expect(downloads.count()).toBe(1));
    await vi.waitFor(() => expect(detail(el, first)).toContain("Downloading"));
    // The rest of the list is still there to tap on
    expect(el.querySelectorAll(".manager-item").length).toBeGreaterThan(1);

    downloadButton(el, second)?.click();
    await vi.waitFor(() => expect(detail(el, second)).toContain("Queued"));
    expect(downloads.count()).toBe(1); // one at a time
    expect(el.querySelector(".chart-cache-queue-text")?.textContent).toContain(
      "2 downloads",
    );

    downloads.resolveNext();
    await vi.waitFor(() => expect(downloads.count()).toBe(2));
    expect(tileStoreMocks.downloadChart.mock.calls[1][1]).toBe(second.filename);
    expect(el.querySelector(".chart-cache-queue-text")?.textContent).toContain(
      "1 download ",
    );

    downloads.resolveNext();
    await vi.waitFor(() => expect(panel.isBusy()).toBe(false));
    expect(el.querySelector(".chart-cache-queue")).toBeNull();
  });

  it("removes a waiting download and cancels the active one", async () => {
    const downloads = manualDownloads();
    const { panel, el } = await openPanel();

    downloadButton(el, first)?.click();
    await vi.waitFor(() => expect(downloads.count()).toBe(1));
    downloadButton(el, second)?.click();
    await vi.waitFor(() => expect(detail(el, second)).toContain("Queued"));

    el.querySelector<HTMLButtonElement>(
      `[data-region-id="${second.id}"] button[title="Remove from queue"]`,
    )?.click();
    await vi.waitFor(() => expect(downloadButton(el, second)).not.toBeNull());

    el.querySelector<HTMLButtonElement>(
      `[data-region-id="${first.id}"] button[title="Cancel download"]`,
    )?.click();
    await vi.waitFor(() => expect(panel.isBusy()).toBe(false));
    expect(downloads.count()).toBe(1); // the removed one never started
    expect(detail(el, first)).not.toContain("failed");
  });

  it("reports a failed download on its row and moves on to the next", async () => {
    tileStoreMocks.downloadChart
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue(undefined);
    const { panel, el } = await openPanel();

    downloadButton(el, first)?.click();
    downloadButton(el, second)?.click();
    await vi.waitFor(() =>
      expect(tileStoreMocks.downloadChart).toHaveBeenCalledTimes(2),
    );
    await vi.waitFor(() => expect(panel.isBusy()).toBe(false));
    expect(detail(el, first)).toContain("Download failed: boom");
    expect(downloadButton(el, first)).not.toBeNull(); // retry is a tap away
  });

  it("counts bytes kept from an interrupted download as already stored", async () => {
    tileStoreMocks.downloadChart.mockResolvedValue(undefined);
    tileStoreMocks.getStorageEstimate.mockResolvedValue({
      used: 900,
      quota: 1000,
    });
    tileStoreMocks.partialDownloadBytes.mockResolvedValue(
      first.sizeEstimate - 100,
    );
    const { panel, el } = await openPanel();

    downloadButton(el, first)?.click();
    await vi.waitFor(() =>
      expect(tileStoreMocks.downloadChart).toHaveBeenCalledTimes(1),
    );
    await vi.waitFor(() => expect(panel.isBusy()).toBe(false));
  });

  it("refuses a batch that would not fit in free storage", async () => {
    tileStoreMocks.getStorageEstimate.mockResolvedValue({
      used: 900,
      quota: 1000,
    });
    const { panel, el } = await openPanel();

    downloadButton(el, first)?.click();
    await vi.waitFor(() =>
      expect(detail(el, first)).toContain("Not enough storage"),
    );
    expect(panel.isBusy()).toBe(false);
    expect(tileStoreMocks.downloadChart).not.toHaveBeenCalled();
  });
});

/** An error as it arrives from the OPFS write worker. */
function workerError(name: string, message: string): Error {
  const err = new Error(message);
  err.name = name;
  return err;
}

const networkDrop = () => workerError("TypeError", "network error");

describe("ChartCachePanel automatic retry", () => {
  const [first, second] = CHART_REGIONS;
  const detail = (el: HTMLElement, region: ChartRegion) =>
    el.querySelector(`[data-region-id="${region.id}"] .manager-item-detail`)
      ?.textContent ?? "";
  const setHidden = (hidden: boolean) =>
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => hidden,
    });

  beforeEach(() => {
    document.body.innerHTML = "";
    setHidden(false);
    tileStoreMocks.downloadChart.mockReset();
    tileStoreMocks.discardPartialDownload.mockClear();
    tileStoreMocks.listStoredCharts.mockResolvedValue([]);
    tileStoreMocks.fetchRemoteChartMeta.mockResolvedValue(null);
    tileStoreMocks.getStorageEstimate.mockResolvedValue({ used: 0, quota: 0 });
  });

  function queuePanel() {
    const { panel, el } = makePanel();
    panel.show();
    const internals = panel as unknown as ChartCachePanelInternals;
    const enqueue = (...regions: ChartRegion[]) =>
      internals.enqueue(regions.map((r) => internals.regionJob(r)));
    return { panel, el, enqueue };
  }

  it("waits after a network drop and resumes when the device is back online", async () => {
    tileStoreMocks.downloadChart
      .mockRejectedValueOnce(networkDrop())
      .mockResolvedValue(undefined);
    const { panel, el, enqueue } = queuePanel();

    await enqueue(first);
    await vi.waitFor(() =>
      expect(detail(el, first)).toContain("Waiting for network"),
    );
    expect(panel.isBusy()).toBe(true);
    expect(panel.queueState()).toEqual([
      expect.objectContaining({
        filename: first.filename,
        state: "waiting",
        attempts: 1,
      }),
    ]);

    window.dispatchEvent(new Event("online"));
    await vi.waitFor(() => expect(panel.isBusy()).toBe(false));
    expect(tileStoreMocks.downloadChart).toHaveBeenCalledTimes(2);
    expect(detail(el, first)).not.toContain("failed");
  });

  it("moves a failed download behind the rest of the queue", async () => {
    tileStoreMocks.downloadChart
      .mockRejectedValueOnce(networkDrop())
      .mockResolvedValue(undefined);
    const { panel, enqueue } = queuePanel();

    await enqueue(first, second);
    await vi.waitFor(() =>
      expect(panel.queueState().map((q) => q.filename)).toEqual([
        second.filename,
        first.filename,
      ]),
    );
    window.dispatchEvent(new Event("online"));
    await vi.waitFor(() => expect(panel.isBusy()).toBe(false));
    expect(
      tileStoreMocks.downloadChart.mock.calls.map((call) => call[1]),
    ).toEqual([first.filename, second.filename, first.filename]);
  });

  it("gives up after its retries and shows the failure", async () => {
    tileStoreMocks.downloadChart.mockRejectedValue(
      workerError("StallError", "download stalled — no data for 60 s"),
    );
    const { panel, el, enqueue } = queuePanel();

    await enqueue(first);
    for (let i = 1; i <= 5; i++) {
      await vi.waitFor(() =>
        expect(panel.queueState()[0]).toMatchObject({
          state: "waiting",
          attempts: i,
        }),
      );
      window.dispatchEvent(new Event("online"));
    }
    await vi.waitFor(() => expect(panel.isBusy()).toBe(false));
    expect(tileStoreMocks.downloadChart).toHaveBeenCalledTimes(6);
    expect(detail(el, first)).toContain(
      "Download failed: download stalled — no data for 60 s",
    );
  });

  it("does not retry, or count failures, while the app is hidden", async () => {
    tileStoreMocks.downloadChart
      .mockRejectedValueOnce(networkDrop())
      .mockResolvedValue(undefined);
    const { panel, enqueue } = queuePanel();
    setHidden(true);

    await enqueue(first);
    await vi.waitFor(() =>
      expect(panel.queueState()[0]).toMatchObject({
        state: "waiting",
        attempts: 0,
      }),
    );
    window.dispatchEvent(new Event("online"));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(tileStoreMocks.downloadChart).toHaveBeenCalledTimes(1);

    setHidden(false);
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(panel.isBusy()).toBe(false));
    expect(tileStoreMocks.downloadChart).toHaveBeenCalledTimes(2);
  });

  it("discards the kept partial when a waiting download is cancelled", async () => {
    tileStoreMocks.downloadChart.mockRejectedValue(networkDrop());
    const { panel, el, enqueue } = queuePanel();

    await enqueue(first);
    await vi.waitFor(() =>
      expect(detail(el, first)).toContain("Waiting for network"),
    );
    el.querySelector<HTMLButtonElement>(
      `[data-region-id="${first.id}"] button[title="Remove from queue"]`,
    )?.click();
    await vi.waitFor(() => expect(panel.isBusy()).toBe(false));
    expect(tileStoreMocks.discardPartialDownload).toHaveBeenCalledWith(
      first.filename,
    );
    expect(tileStoreMocks.downloadChart).toHaveBeenCalledTimes(1);
  });

  it("fetches only the missing aux files when a region download is retried", async () => {
    tileStoreMocks.downloadChart.mockResolvedValue(undefined);
    tileStoreMocks.downloadAuxFile
      .mockRejectedValueOnce(networkDrop())
      .mockResolvedValue(undefined);
    const { panel, enqueue } = queuePanel();

    await enqueue(first);
    await vi.waitFor(() =>
      expect(panel.queueState()[0]?.state).toBe("waiting"),
    );
    window.dispatchEvent(new Event("online"));
    await vi.waitFor(() => expect(panel.isBusy()).toBe(false));
    expect(tileStoreMocks.downloadChart).toHaveBeenCalledTimes(1);
  });
});

describe("ChartCachePanel download log", () => {
  const [first] = CHART_REGIONS;

  beforeEach(() => {
    document.body.innerHTML = "";
    diag.mockClear();
    tileStoreMocks.downloadChart.mockReset();
    tileStoreMocks.downloadAuxFile.mockResolvedValue(undefined);
    tileStoreMocks.listStoredCharts.mockResolvedValue([]);
    tileStoreMocks.fetchRemoteChartMeta.mockResolvedValue(null);
    tileStoreMocks.getStorageEstimate.mockResolvedValue({ used: 0, quota: 0 });
  });

  it("logs each run's start, failure, retry trigger and completion", async () => {
    type Progress = (loaded: number, total: number) => void;
    tileStoreMocks.downloadChart
      .mockImplementationOnce(
        async (_url: string, _file: string, onProgress: Progress) => {
          onProgress(0, 2048);
          onProgress(1024, 2048);
          throw networkDrop();
        },
      )
      .mockImplementationOnce(
        async (_url: string, _file: string, onProgress: Progress) => {
          onProgress(1024, 2048);
          onProgress(2048, 2048);
        },
      );
    const { panel } = makePanel();
    const internals = panel as unknown as ChartCachePanelInternals;

    await internals.enqueue([internals.regionJob(first)]);
    await vi.waitFor(() =>
      expect(panel.queueState()[0]?.state).toBe("waiting"),
    );
    window.dispatchEvent(new Event("online"));
    await vi.waitFor(() => expect(panel.isBusy()).toBe(false));

    const lines = diag.mock.calls.map(([tag, message]) => {
      expect(tag).toBe("download");
      return message as string;
    });
    const f = first.filename;
    expect(lines).toEqual([
      `queued ${f}`,
      `${f} start run 1: fresh, 2 KB`,
      `${f} failed at 1 KB / 2 KB (50%): TypeError: network error; waiting, retry 1/5`,
      expect.stringMatching(/^queue resumed \(online\) after \d+s$/),
      `${f} start run 2: resume at 1 KB / 2 KB (50%)`,
      expect.stringMatching(
        new RegExp(`^${f} done: 2 KB \\(1 KB fetched\\) in \\d+s @ `),
      ),
    ]);
  });
});
