import { describe, expect, it } from "vitest";
import type { SearchEntry } from "../data/search-index";
import { findNearestNamedFeature, searchFeatures } from "./feature-search";

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

describe("findNearestNamedFeature", () => {
  // Closely-spaced features for proximity tests (~50–500 m apart).
  // 1° lat ≈ 111 km → 0.001° ≈ 111 m.
  const FEATURES: SearchEntry[] = [
    entry("Light A", "LIGHTS", [-71.0, 42.35]),
    entry("Buoy R12", "BOYLAT", [-71.001, 42.35]), // ~83 m east of Light A
    entry("Big Landmark", "LNDMRK", [-71.003, 42.35]), // ~250 m east
    entry("Far Island", "LNDARE", [-71.01, 42.35]), // ~830 m east
  ];

  it("returns the closest feature within range", () => {
    const found = findNearestNamedFeature(-71.0, 42.35, FEATURES);
    expect(found?.name).toBe("Light A");
  });

  it("returns null when nothing is close enough", () => {
    const found = findNearestNamedFeature(-72.0, 43.0, FEATURES);
    expect(found).toBeNull();
  });

  it("respects maxMeters", () => {
    // 100 m radius from Buoy R12 — only Buoy R12 and Light A qualify
    const found = findNearestNamedFeature(-71.001, 42.35, FEATURES, 50);
    expect(found?.name).toBe("Buoy R12");
  });

  it("ignores empty-name entries", () => {
    const withEmpty: SearchEntry[] = [
      { name: "", type: "LIGHTS", center: [-71.0, 42.35] },
      { name: "Real Thing", type: "LIGHTS", center: [-71.0001, 42.35] },
    ];
    expect(findNearestNamedFeature(-71.0, 42.35, withEmpty)?.name).toBe(
      "Real Thing",
    );
  });

  it("matches a small area when the click is inside its bbox", () => {
    // ~0.25 nm × 0.25 nm anchorage → half-diagonal ≈ 0.18 nm ≈ 330 m,
    // well within the 1500 m default.
    const anchorage: SearchEntry = {
      name: "Inner Anchorage",
      type: "ACHARE",
      center: [-71.0, 42.35],
      bbox: [-71.0028, 42.348, -70.9972, 42.352],
    };
    // Click near a corner of the bbox — still inside.
    const found = findNearestNamedFeature(-71.0025, 42.3495, [anchorage]);
    expect(found?.name).toBe("Inner Anchorage");
  });

  it("prefers a close point feature over the encompassing area", () => {
    const anchorage: SearchEntry = {
      name: "Inner Anchorage",
      type: "ACHARE",
      center: [-71.0, 42.35],
      bbox: [-71.0028, 42.348, -70.9972, 42.352], // half-diag ~330 m
    };
    const buoy = entry("Buoy R12", "BOYLAT", [-71.0, 42.35]);
    // Click on the buoy inside the anchorage — buoy at 0 m beats the
    // anchorage's effective ~330 m.
    const found = findNearestNamedFeature(-71.0, 42.35, [anchorage, buoy]);
    expect(found?.name).toBe("Buoy R12");
  });

  it("falls back to the area when no point feature is close", () => {
    const anchorage: SearchEntry = {
      name: "Inner Anchorage",
      type: "ACHARE",
      center: [-71.0, 42.35],
      bbox: [-71.0028, 42.348, -70.9972, 42.352],
    };
    // Distant point feature (~5 nm away).
    const far = entry("Distant Buoy", "BOYLAT", [-71.1, 42.35]);
    const found = findNearestNamedFeature(-71.0, 42.35, [anchorage, far]);
    expect(found?.name).toBe("Inner Anchorage");
  });

  it("rejects huge areas — their effective distance exceeds the cap", () => {
    // Gulf-of-Maine-sized area: ~3° × 2° → half-diagonal ~100 nm.
    const huge: SearchEntry = {
      name: "Gulf of Maine",
      type: "SEAARE",
      center: [-69.5, 43.0],
      bbox: [-71.0, 42.0, -68.0, 44.0],
    };
    const found = findNearestNamedFeature(-69.5, 43.0, [huge]);
    expect(found).toBeNull();
  });

  it("rejects whole-harbor-sized bboxes (~3 nm half-diagonal)", () => {
    // A typical big-harbor bbox — too coarse to be a useful waypoint name.
    const harbor: SearchEntry = {
      name: "Boston Harbor",
      type: "SEAARE",
      center: [-71.0, 42.35],
      bbox: [-71.05, 42.32, -70.95, 42.38], // ~3 nm half-diagonal
    };
    const found = findNearestNamedFeature(-71.0, 42.35, [harbor]);
    expect(found).toBeNull();
  });
});
