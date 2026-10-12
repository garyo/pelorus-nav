import { afterEach, describe, expect, it, vi } from "vitest";
import { CHART_REGIONS } from "./chart-catalog";
import { clearSearchIndexCache, loadSearchIndex } from "./search-index";

afterEach(() => {
  vi.unstubAllGlobals();
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
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(index))),
    );

    const [town, canyon] = await loadSearchIndex(CHART_REGIONS[0].id);
    expect(town.place).toEqual({
      label: "CA",
      codes: ["ca", "usa"],
      names: ["california"],
    });
    expect(canyon.place).toBeUndefined();
  });
});
