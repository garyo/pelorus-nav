import { describe, expect, it } from "vitest";
import type { Place, SearchEntry } from "../data/search-index";
import {
  findNearestNamedFeature,
  parseSearchQuery,
  searchFeatures,
} from "./feature-search";

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

const MA: Place = {
  label: "MA",
  codes: ["ma", "usa", "us"],
  names: ["massachusetts", "united states"],
};
const ME: Place = {
  label: "ME",
  codes: ["me", "usa", "us"],
  names: ["maine", "united states"],
};

function area(
  name: string,
  type: string,
  bbox: [number, number, number, number],
  place?: Place,
): SearchEntry {
  const center: [number, number] = [
    (bbox[0] + bbox[2]) / 2,
    (bbox[1] + bbox[3]) / 2,
  ];
  return { name, type, center, bbox, place };
}

describe("parseSearchQuery", () => {
  it("splits a place suffix at the last comma", () => {
    expect(parseSearchQuery(" Coronado, CA ")).toEqual({
      name: "coronado",
      where: "ca",
    });
    expect(parseSearchQuery("a, b, maine")).toEqual({
      name: "a, b",
      where: "maine",
    });
  });

  it("ignores a trailing comma", () => {
    expect(parseSearchQuery("coronado,")).toEqual({ name: "coronado" });
    expect(parseSearchQuery("coronado")).toEqual({ name: "coronado" });
  });
});

describe("searchFeatures duplicates", () => {
  const ref = { referencePoint: [-71.0, 42.3] as [number, number] };

  it("keeps the nearest of overlapping same-named pieces", () => {
    const near = area("Long Island", "LNDARE", [-70.97, 42.31, -70.95, 42.33]);
    const results = searchFeatures(
      "long island",
      [
        area("Long Island", "LNDARE", [-70.975, 42.305, -70.945, 42.335]),
        near,
        area("Long Island", "LNDARE", [-70.98, 42.3, -70.94, 42.34]),
      ],
      ref,
    );
    expect(results.map((r) => r.entry)).toEqual([near]);
  });

  it("joins pieces of one feature that meet only through a farther piece", () => {
    // The two ends rank first and don't touch; the middle piece reaches
    // farther north, so it ranks last and joins them.
    const west = area("Long Island", "LNDARE", [-71.0, 42.3, -70.9, 42.32]);
    const results = searchFeatures(
      "long island",
      [
        west,
        area("Long Island", "LNDARE", [-70.6, 42.3, -70.5, 42.32]),
        area("Long Island", "LNDARE", [-70.9, 42.3, -70.6, 42.6]),
      ],
      { referencePoint: [-70.75, 42.0] },
    );
    expect(results.map((r) => r.entry)).toEqual([west]);
  });

  it("keeps separate features that share a name", () => {
    const results = searchFeatures(
      "long island",
      [
        area("Long Island", "LNDARE", [-70.97, 42.31, -70.95, 42.33], MA),
        area("Long Island", "LNDARE", [-70.13, 43.67, -70.1, 43.7], ME),
      ],
      ref,
    );
    expect(results.map((r) => r.location)).toEqual(["MA", "ME"]);
  });

  it("keeps same-named features of different types", () => {
    const results = searchFeatures("coronado", [
      entry("Coronado", "BUAARE"),
      entry("Coronado", "LNDARE"),
    ]);
    expect(results).toHaveLength(2);
  });
});

describe("searchFeatures place suffix", () => {
  const ENTRIES_WITH_PLACES: SearchEntry[] = [
    area("Boston", "BUAARE", [-71.19, 42.23, -70.92, 42.4], MA),
    area("Long Island", "LNDARE", [-70.97, 42.31, -70.95, 42.33], MA),
    area("Long Island", "LNDARE", [-70.13, 43.67, -70.1, 43.7], ME),
    area("Portland", "BUAARE", [-70.33, 43.62, -70.22, 43.7], ME),
    area("Bay, Beach, and Point", "LNDRGN", [-70.2, 43.0, -70.1, 43.1], ME),
  ];

  const names = (query: string) =>
    searchFeatures(query, ENTRIES_WITH_PLACES).map(
      (r) => `${r.entry.name} | ${r.location}`,
    );

  it("narrows by state code or name", () => {
    expect(names("long island, me")).toEqual([
      "Long Island | near Portland, ME",
    ]);
    expect(names("long island, Massachusetts")).toEqual([
      "Long Island | near Boston, MA",
    ]);
    expect(names("long island, mass")).toEqual([
      "Long Island | near Boston, MA",
    ]);
  });

  it("matches two letters only as a code", () => {
    expect(names("long island, ma")).toEqual(["Long Island | near Boston, MA"]);
    expect(names("long island, po")).toEqual([]);
  });

  it("narrows by a nearby town", () => {
    expect(names("long island, portland")).toEqual([
      "Long Island | near Portland, ME",
    ]);
  });

  it("narrows by country", () => {
    expect(names("long island, united states")).toHaveLength(2);
    expect(names("long island, usa")).toHaveLength(2);
  });

  it("still finds names that contain a comma", () => {
    expect(names("bay, beach")).toEqual(["Bay, Beach, and Point | ME"]);
  });

  it("shows towns by their state alone", () => {
    expect(names("portland")).toEqual(["Portland | ME"]);
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
