import { describe, expect, it } from "vitest";
import type { SearchEntry } from "../data/search-index";
import { searchFeatures } from "./feature-search";

function entry(
  name: string,
  type: string,
  center: [number, number] = [-71.0, 42.35],
): SearchEntry {
  return { name, type, center };
}

const ENTRIES: SearchEntry[] = [
  entry("Boston", "BUAARE"),
  entry("Boston Harbor", "SEAARE", [-71.03, 42.35]),
  entry("Boston Main Channel Lighted Buoy 6", "BOYLAT", [-71.02, 42.34]),
  entry("Spectacle Island", "LNDARE", [-70.99, 42.33]),
  entry("Cambridge", "BUAARE", [-71.1, 42.37]),
  entry("No Anchoring Zone", "RESARE", [-71.05, 42.36]),
  entry("Alpha Lighthouse", "LNDMRK", [-71.0, 42.4]),
];

describe("searchFeatures", () => {
  it("returns empty for short queries", () => {
    expect(searchFeatures("B", ENTRIES)).toEqual([]);
    expect(searchFeatures("", ENTRIES)).toEqual([]);
    expect(searchFeatures(" ", ENTRIES)).toEqual([]);
  });

  it("finds exact matches with highest score", () => {
    const results = searchFeatures("Boston", ENTRIES);
    expect(results[0].entry.name).toBe("Boston");
    expect(results[0].matchType).toBe("exact");
    expect(results[0].score).toBe(100);
  });

  it("finds prefix matches", () => {
    const results = searchFeatures("Boston H", ENTRIES);
    expect(results[0].entry.name).toBe("Boston Harbor");
    expect(results[0].matchType).toBe("prefix");
  });

  it("finds word-boundary prefix matches", () => {
    const results = searchFeatures("Harbor", ENTRIES);
    expect(results[0].entry.name).toBe("Boston Harbor");
    expect(results[0].matchType).toBe("word-prefix");
  });

  it("finds substring matches", () => {
    const results = searchFeatures("Island", ENTRIES);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].entry.name).toBe("Spectacle Island");
    expect(results[0].matchType).toBe("word-prefix");
  });

  it("is case-insensitive", () => {
    const results = searchFeatures("boston", ENTRIES);
    expect(results.length).toBeGreaterThanOrEqual(3);
    expect(results[0].entry.name).toBe("Boston");
  });

  it("ranks by type priority when scores tie", () => {
    const entries = [
      entry("Test Feature", "BOYLAT"),
      entry("Test Feature", "BUAARE"),
      entry("Test Feature", "LNDMRK"),
    ];
    const results = searchFeatures("Test Feature", entries);
    // All exact matches — sorted by type priority
    expect(results[0].entry.type).toBe("BUAARE");
    expect(results[1].entry.type).toBe("LNDMRK");
    expect(results[2].entry.type).toBe("BOYLAT");
  });

  it("respects limit option", () => {
    const results = searchFeatures("Boston", ENTRIES, { limit: 2 });
    expect(results.length).toBe(2);
  });

  it("provides human-readable type labels", () => {
    const results = searchFeatures("Boston", ENTRIES);
    const buaare = results.find((r) => r.entry.type === "BUAARE");
    expect(buaare?.typeLabel).toBe("Built-Up Area");
  });

  it("boosts features within viewport bounds", () => {
    const farEntry = entry("Boston Light", "LNDMRK", [-60.0, 40.0]);
    const nearEntry = entry("Boston Harbor Light", "LNDMRK", [-71.01, 42.35]);
    const entries = [farEntry, nearEntry];

    const results = searchFeatures("Boston", entries, {
      viewportBounds: [-71.1, 42.3, -70.9, 42.4],
    });
    // Near entry (in viewport) should rank higher despite similar text match
    expect(results[0].entry.name).toBe("Boston Harbor Light");
  });

  it("boosts features near reference point", () => {
    const farEntry = entry("Boston Light", "LNDMRK", [-60.0, 40.0]);
    const nearEntry = entry("Boston Harbor Light", "LNDMRK", [-71.01, 42.35]);
    const entries = [farEntry, nearEntry];

    const results = searchFeatures("Boston", entries, {
      referencePoint: [-71.0, 42.35],
    });
    expect(results[0].entry.name).toBe("Boston Harbor Light");
  });

  it("handles entries with no matching results", () => {
    const results = searchFeatures("ZZZNonexistent", ENTRIES);
    expect(results).toEqual([]);
  });

  it("trims whitespace from query", () => {
    const results = searchFeatures("  Boston  ", ENTRIES);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].entry.name).toBe("Boston");
  });
});
