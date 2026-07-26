// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  archiveFilename,
  boundsForKey,
  ChartLoadHealth,
  categorizeSource,
  classifyLoadError,
  composeFailureMessage,
} from "./ChartLoadMonitor";

describe("categorizeSource", () => {
  it("attributes chart sources", () => {
    expect(categorizeSource("s57-vector-boston-test")).toBe("chart");
    expect(categorizeSource("s57-coverage-unified")).toBe("chart");
    expect(categorizeSource("rnc-13218")).toBe("chart");
    expect(categorizeSource("noaa-ncds")).toBe("chart");
  });

  it("attributes basemap sources", () => {
    expect(categorizeSource("basemap-underlay")).toBe("basemap");
    expect(categorizeSource("basemap-underlay-labels")).toBe("basemap");
    expect(categorizeSource("osm-underlay")).toBe("basemap");
    expect(categorizeSource("osm")).toBe("basemap");
  });

  it("attributes protocol-level file keys", () => {
    expect(categorizeSource("file:nautical-oregon.pmtiles")).toBe("chart");
    expect(categorizeSource("file:rnc-bvi.pmtiles")).toBe("chart");
    expect(categorizeSource("file:basemap-northern-new-england.pmtiles")).toBe(
      "basemap",
    );
  });

  it("ignores overlays and missing ids", () => {
    expect(categorizeSource("tides-stations")).toBeNull();
    expect(categorizeSource(undefined)).toBeNull();
  });
});

describe("archiveFilename", () => {
  it("extracts the archive from protocol URLs", () => {
    expect(archiveFilename("pmtiles:///nautical-oregon.pmtiles/8/75/94")).toBe(
      "nautical-oregon.pmtiles",
    );
    expect(
      archiveFilename(
        "pmtiles://https://pelorus-nav.com/nautical-usvi.pmtiles?v=abc",
      ),
    ).toBe("nautical-usvi.pmtiles");
    expect(archiveFilename("osmtiles://tile.example/3/4/5")).toBeNull();
  });
});

describe("classifyLoadError", () => {
  it("ignores aborted requests regardless of connectivity", () => {
    expect(classifyLoadError("AbortError: signal is aborted", true)).toBeNull();
    expect(classifyLoadError("Request aborted", false)).toBeNull();
  });

  it("is offline whenever the browser reports offline", () => {
    expect(classifyLoadError("Failed to fetch", false)).toBe("offline");
  });

  it("classifies server responses", () => {
    expect(classifyLoadError("Bad response code: 404", true)).toBe("server");
    expect(classifyLoadError("AJAXError: Internal Error (500)", true)).toBe(
      "server",
    );
    expect(classifyLoadError("Not Found", true)).toBe("server");
  });

  it("classifies network-level failures", () => {
    expect(classifyLoadError("Failed to fetch", true)).toBe("network");
    expect(classifyLoadError("NetworkError when fetching", true)).toBe(
      "network",
    );
    expect(classifyLoadError("Load failed", true)).toBe("network");
  });

  it("classifies non-archive responses as server trouble", () => {
    expect(
      classifyLoadError("Wrong magic number for PMTiles archive", true),
    ).toBe("server");
  });

  it("classifies unreadable offline storage", () => {
    expect(
      classifyLoadError(
        "NotReadableError: The requested file could not be read",
        true,
      ),
    ).toBe("storage");
  });

  it("falls back to unknown", () => {
    expect(classifyLoadError("something exploded", true)).toBe("unknown");
  });
});

describe("ChartLoadHealth", () => {
  it("is quiet with no failures", () => {
    expect(new ChartLoadHealth().summary()).toBeNull();
  });

  it("one lone error is not a failure; two in the category are", () => {
    const h = new ChartLoadHealth();
    h.recordError("s57-vector-a", "network");
    expect(h.summary()).toBeNull();
    h.recordError("s57-coverage-unified", "network");
    expect(h.summary()).toEqual({
      categories: ["chart"],
      reason: "network",
    });
  });

  it("offline failures count immediately", () => {
    const h = new ChartLoadHealth();
    h.recordError("s57-vector-a", "offline");
    expect(h.summary()).toEqual({ categories: ["chart"], reason: "offline" });
  });

  it("a single source-level failure counts immediately — the region is dead", () => {
    const h = new ChartLoadHealth();
    h.recordError("file:nautical-oregon.pmtiles", "server", {
      sourceLevel: true,
    });
    expect(h.summary()).toEqual({ categories: ["chart"], reason: "server" });
    h.recordSuccess("file:nautical-oregon.pmtiles");
    expect(h.summary()).toBeNull();
  });

  it("a success clears only its own source", () => {
    const h = new ChartLoadHealth();
    h.recordError("s57-vector-a", "network");
    h.recordError("s57-vector-a", "network");
    h.recordError("basemap-underlay", "network");
    h.recordError("basemap-underlay", "network");
    expect(h.summary()?.categories).toEqual(["chart", "basemap"]);
    // The basemap recovering must not clear the chart failure.
    expect(h.recordSuccess("basemap-underlay")).toBe(true);
    expect(h.summary()).toEqual({ categories: ["chart"], reason: "network" });
    expect(h.recordSuccess("s57-vector-a")).toBe(true);
    expect(h.summary()).toBeNull();
  });

  it("a success on a source with no failures reports no change", () => {
    expect(new ChartLoadHealth().recordSuccess("s57-vector-a")).toBe(false);
  });

  it("failures latch until a success on that source", () => {
    const h = new ChartLoadHealth();
    h.recordError("s57-vector-a", "network");
    h.recordError("s57-vector-a", "network");
    // No aging: the broken tile is still on screen no matter how much
    // time passes.
    expect(h.summary()).not.toBeNull();
    h.recordSuccess("s57-vector-a");
    expect(h.summary()).toBeNull();
  });

  it("prune drops sources that left the style", () => {
    const h = new ChartLoadHealth();
    h.recordError("s57-vector-a", "network");
    h.recordError("s57-vector-a", "network");
    expect(h.prune(new Set(["s57-vector-b"]))).toBe(true);
    expect(h.summary()).toBeNull();
    expect(h.prune(new Set(["s57-vector-b"]))).toBe(false);
  });

  it("relevance filter hides failures without forgetting them", () => {
    const h = new ChartLoadHealth();
    h.recordError("s57-vector-new-york", "network");
    h.recordError("s57-vector-new-york", "network");
    expect(h.summary()).not.toBeNull();
    // Zoomed into a view the failing region doesn't touch → quiet…
    expect(h.summary((k) => k !== "s57-vector-new-york")).toBeNull();
    // …but zooming back out counts it again with no new errors.
    expect(h.summary()).not.toBeNull();
  });

  it("picks the most informative reason across failing sources", () => {
    const h = new ChartLoadHealth();
    h.recordError("s57-vector-a", "network");
    h.recordError("s57-vector-b", "server");
    expect(h.summary()?.reason).toBe("server");
  });
});

describe("boundsForKey", () => {
  it("resolves region footprints from source ids and archive keys", () => {
    expect(boundsForKey("s57-vector-southern-new-england")).toEqual([
      -74.0, 41.0, -65.5, 42.0,
    ]);
    expect(boundsForKey("file:nautical-new-york.pmtiles")).toEqual(
      boundsForKey("s57-vector-new-york"),
    );
    expect(boundsForKey("file:rnc-bvi.pmtiles")).toEqual(
      boundsForKey("rnc-bvi"),
    );
  });

  it("returns null for footprint-less sources (relevant everywhere)", () => {
    expect(boundsForKey("osm-underlay")).toBeNull();
    expect(boundsForKey("s57-coverage-unified")).toBeNull();
  });
});

describe("composeFailureMessage", () => {
  it("names what is failing", () => {
    expect(
      composeFailureMessage(
        { categories: ["chart"], reason: "network" },
        false,
      ),
    ).toMatch(/^Can't load charts — network/);
    expect(
      composeFailureMessage(
        { categories: ["basemap"], reason: "server" },
        false,
      ),
    ).toMatch(/^Can't load street maps — .*server/);
    expect(
      composeFailureMessage(
        { categories: ["chart", "basemap"], reason: "network" },
        false,
      ),
    ).toMatch(/^Can't load charts or street maps/);
  });

  it("mentions downloaded regions only when they exist", () => {
    const summary = {
      categories: ["chart"] as ["chart"],
      reason: "offline" as const,
    };
    expect(composeFailureMessage(summary, true)).toContain(
      "Downloaded regions still work",
    );
    expect(composeFailureMessage(summary, false)).not.toContain("Downloaded");
  });
});
