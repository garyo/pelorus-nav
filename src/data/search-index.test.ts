import { afterEach, describe, expect, it, vi } from "vitest";
import { CHART_REGIONS } from "./chart-catalog";
import { clearSearchIndexCache, loadSearchIndex } from "./search-index";
import { getAuxFile } from "./tile-store";

vi.mock("./tile-store", () => ({ getAuxFile: vi.fn(async () => null) }));

const REGION = CHART_REGIONS[0];

function indexText(...names: string[]): string {
  return JSON.stringify({
    version: 1,
    features: names.map((n) => ({ n, t: "BUAARE", c: [-70, 42] })),
  });
}

function storeIndex(text: string): void {
  vi.mocked(getAuxFile).mockResolvedValue(new File([text], "index.json"));
}

function serveIndex(text: string | null): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () =>
    text === null
      ? new Response("Not found", { status: 404 })
      : new Response(text),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(getAuxFile).mockReset();
  vi.mocked(getAuxFile).mockResolvedValue(null);
  clearSearchIndexCache();
});

describe("loadSearchIndex", () => {
  it("resolves each entry's place from the index's place table", async () => {
    const index = {
      version: 1,
      features: [
        { n: "Coronado", t: "BUAARE", c: [-117.18, 32.69], p: 0 },
        { n: "Coronado Canyon", t: "SEAARE", c: [-117.6, 32.4] },
      ],
      places: [{ l: "CA", c: ["CA", "USA"], n: ["California"] }],
    };
    serveIndex(JSON.stringify(index));

    const [town, canyon] = await loadSearchIndex(REGION.id);
    expect(town.place).toEqual({
      label: "CA",
      codes: ["ca", "usa"],
      names: ["california"],
    });
    expect(canyon.place).toBeUndefined();
  });

  it("uses the copy saved with a downloaded region, without the network", async () => {
    storeIndex(indexText("Stored Harbor"));
    const fetchMock = serveIndex(indexText("Server Harbor"));

    const entries = await loadSearchIndex(REGION.id);
    expect(entries.map((e) => e.name)).toEqual(["Stored Harbor"]);
    expect(vi.mocked(getAuxFile)).toHaveBeenCalledWith(
      REGION.filename.replace(".pmtiles", ".search.json"),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches from the server when the saved copy is missing or damaged", async () => {
    serveIndex(indexText("Server Harbor"));
    expect((await loadSearchIndex(REGION.id)).map((e) => e.name)).toEqual([
      "Server Harbor",
    ]);

    clearSearchIndexCache();
    storeIndex('{"version": 1, "featu');
    expect((await loadSearchIndex(REGION.id)).map((e) => e.name)).toEqual([
      "Server Harbor",
    ]);
  });

  it("tries again later when no index is available", async () => {
    serveIndex(null);
    expect(await loadSearchIndex(REGION.id)).toEqual([]);

    serveIndex(indexText("Server Harbor"));
    expect((await loadSearchIndex(REGION.id)).map((e) => e.name)).toEqual([
      "Server Harbor",
    ]);
  });
});
