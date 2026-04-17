import type { Feature, Point } from "geojson";
import { describe, expect, it } from "vitest";
import { buildClusters, buildGeoJson } from "./PelLightLayer";

function lights(
  props: Record<string, unknown>,
  coords: [number, number] = [-70.6743, 41.6925],
): Feature<Point> {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: coords },
    properties: props,
  };
}

// Realistic Cleveland Ledge fixture (the 7-sector PEL the user asked about).
// Bearings are FROM seaward; the overlay flips them 180° for display rotation.
const CLEVELAND_LEDGE_CHILDREN = [
  {
    LNAM: "L1",
    LITCHR: 2,
    SECTR1: 14.7,
    SECTR2: 15.0,
    LABEL: "Fl(1)R 8.2m3M",
    COLOUR: "3",
  },
  {
    LNAM: "L2",
    LITCHR: 1,
    SECTR1: 15.0,
    SECTR2: 15.3,
    LABEL: "F R 8.2m3M",
    COLOUR: "3",
  },
  {
    LNAM: "L3",
    LITCHR: 28,
    SECTR1: 15.3,
    SECTR2: 15.6,
    LABEL: "Al WR 8.2m3M",
    COLOUR: "1,3",
  },
  {
    LNAM: "L4",
    LITCHR: 1,
    SECTR1: 15.6,
    SECTR2: 15.8,
    LABEL: "F 8.2m3M",
    COLOUR: "1",
  },
  {
    LNAM: "L5",
    LITCHR: 28,
    SECTR1: 15.8,
    SECTR2: 16.1,
    LABEL: "Al GW 8.2m3M",
    COLOUR: "4,1",
  },
  {
    LNAM: "L6",
    LITCHR: 1,
    SECTR1: 16.1,
    SECTR2: 16.4,
    LABEL: "F G 8.2m3M",
    COLOUR: "4",
  },
  {
    LNAM: "L7",
    LITCHR: 2,
    SECTR1: 16.4,
    SECTR2: 16.7,
    LABEL: "Fl(1)G 8.2m3M",
    COLOUR: "4",
  },
];

function clevelandLedge(): Feature[] {
  return CLEVELAND_LEDGE_CHILDREN.map((p) =>
    lights({
      ...p,
      PARENT_LNAM: "M1",
      PARENT_OBJNAM: "Cleveland Ledge Channel Precision Directional Light",
    }),
  );
}

describe("buildClusters", () => {
  it("groups all children at a shared position into one cluster", () => {
    const clusters = buildClusters(clevelandLedge());
    expect(clusters.size).toBe(1);
    const c = clusters.values().next().value;
    expect(c?.children).toHaveLength(7);
    expect(c?.parentObjnam).toBe(
      "Cleveland Ledge Channel Precision Directional Light",
    );
  });

  it("keeps separate positions in separate clusters", () => {
    const feats = [
      lights(
        { LNAM: "A1", PARENT_LNAM: "MA", PARENT_OBJNAM: "A", LITCHR: 2 },
        [-70.0, 41.0],
      ),
      lights(
        { LNAM: "A2", PARENT_LNAM: "MA", PARENT_OBJNAM: "A", LITCHR: 2 },
        [-70.0, 41.0],
      ),
      lights(
        { LNAM: "B1", PARENT_LNAM: "MB", PARENT_OBJNAM: "B", LITCHR: 2 },
        [-71.0, 42.0],
      ),
    ];
    const clusters = buildClusters(feats);
    expect(clusters.size).toBe(2);
    const sizes = Array.from(clusters.values())
      .map((c) => c.children.length)
      .sort();
    expect(sizes).toEqual([1, 2]);
  });

  it("merges multi-cell duplicates of the same aid (different LNAMs, same position)", () => {
    // The real-world bug: Graves Light appears in US5BOSCF, US4MA1HC, and
    // US2EC04M. Each cell has its own PARENT_LNAM on the children, but all
    // children share the same position. They must cluster together.
    const pos: [number, number] = [-70.8696, 42.3649];
    const feats = [
      lights(
        {
          LNAM: "a1",
          PARENT_LNAM: "cellA",
          PARENT_OBJNAM: "Graves",
          LITCHR: 2,
        },
        pos,
      ),
      lights(
        {
          LNAM: "b1",
          PARENT_LNAM: "cellB",
          PARENT_OBJNAM: "Graves",
          LITCHR: 2,
        },
        pos,
      ),
      lights(
        {
          LNAM: "c1",
          PARENT_LNAM: "cellC",
          PARENT_OBJNAM: "Graves",
          LITCHR: 2,
        },
        pos,
      ),
    ];
    const clusters = buildClusters(feats);
    expect(clusters.size).toBe(1);
    const c = clusters.values().next().value;
    expect(c?.children).toHaveLength(3);
    expect(c?.parentObjnam).toBe("Graves");
  });

  it("ignores LIGHTS without PARENT_LNAM (non-PEL)", () => {
    const feats = [
      lights({ LNAM: "X", LITCHR: 2 }, [-70.0, 41.0]), // no parent
      lights({ LNAM: "S", PARENT_LNAM: "M", LITCHR: 2 }, [-71.0, 42.0]),
    ];
    const clusters = buildClusters(feats);
    expect(clusters.size).toBe(1);
  });

  it("recovers PARENT_OBJNAM from any child that carries it", () => {
    const feats = [
      lights({ LNAM: "S1", PARENT_LNAM: "M", LITCHR: 2 }), // no OBJNAM
      lights({
        LNAM: "S2",
        PARENT_LNAM: "M",
        PARENT_OBJNAM: "Big Light",
        LITCHR: 2,
      }),
    ];
    const clusters = buildClusters(feats);
    expect(clusters.values().next().value?.parentObjnam).toBe("Big Light");
  });
});

describe("buildGeoJson", () => {
  it("emits one child feature per sector plus one parent-name feature", () => {
    const { geojson } = buildGeoJson(clevelandLedge());
    const children = geojson.features.filter(
      (f) => f.properties?._type === "child",
    );
    const parents = geojson.features.filter(
      (f) => f.properties?._type === "parent-name",
    );
    expect(children).toHaveLength(7);
    expect(parents).toHaveLength(1);
    expect(parents[0].properties?.OBJNAM).toBe(
      "Cleveland Ledge Channel Precision Directional Light",
    );
  });

  it("returns all child LNAMs for suppression", () => {
    const { suppressedLnams } = buildGeoJson(clevelandLedge());
    expect(suppressedLnams.sort()).toEqual(
      ["L1", "L2", "L3", "L4", "L5", "L6", "L7"].sort(),
    );
  });

  it("rotates teardrops to the sector midpoint (nautical sprites, no baked rotation)", () => {
    const { geojson } = buildGeoJson(clevelandLedge(), "nautical");
    const children = geojson.features.filter(
      (f) => f.properties?._type === "child",
    );
    // L1: SECTR1=14.7, SECTR2=15.0 → midpoint 14.85° FROM seaward → 194.85° FROM light
    const l1 = children.find(
      (f) =>
        f.properties?.COLOUR === "3" &&
        (f.properties?.LABEL as string).startsWith("Fl"),
    );
    expect(l1?.properties?.ROT).toBeCloseTo(194.85, 1);
    // L7: SECTR1=16.4, SECTR2=16.7 → midpoint 16.55 → 196.55
    const l7 = children.find(
      (f) =>
        f.properties?.COLOUR === "4" &&
        (f.properties?.LABEL as string).startsWith("Fl"),
    );
    expect(l7?.properties?.ROT).toBeCloseTo(196.55, 1);
  });

  it("subtracts 135° baked rotation for S-52 sprites", () => {
    const { geojson } = buildGeoJson(clevelandLedge(), "s52-day");
    const children = geojson.features.filter(
      (f) => f.properties?._type === "child",
    );
    // L1 visual bearing 194.85° → icon-rotate should be (194.85 - 135) = 59.85°
    const l1 = children.find(
      (f) =>
        f.properties?.COLOUR === "3" &&
        (f.properties?.LABEL as string).startsWith("Fl"),
    );
    expect(l1?.properties?.ROT).toBeCloseTo(59.85, 1);
  });

  it("ignores single-child clusters (non-PEL lighted buoys)", () => {
    // A lighted buoy has one LIGHTS child under a BOYLAT parent. That's not
    // a PEL — it should render through s57-lights, not our overlay.
    const feats = [
      lights({
        LNAM: "SINGLE",
        PARENT_LNAM: "BUOY1",
        PARENT_OBJNAM: "Lighted Buoy",
        LITCHR: 2,
        SECTR1: 0,
        SECTR2: 360,
      }),
    ];
    const { geojson, suppressedLnams } = buildGeoJson(feats, "nautical");
    expect(geojson.features).toHaveLength(0);
    expect(suppressedLnams).toEqual([]);
  });

  it("blanks labels on fixed (LITCHR=1) sectors, keeps them on others", () => {
    // Cleveland Ledge: 3 sectors have LITCHR=1 (fixed), 4 are Fl or Al.
    const { geojson } = buildGeoJson(clevelandLedge());
    const labels = geojson.features
      .filter((f) => f.properties?._type === "child")
      .map((f) => f.properties?.LABEL);
    expect(labels.filter((l) => l === "")).toHaveLength(3);
    expect(labels.filter((l) => l !== "")).toHaveLength(4);
  });

  it("copies COLOUR/VALNMR/CATLIT so the shared LIGHTS iconExpr works", () => {
    const feats = [
      lights({
        LNAM: "S1",
        PARENT_LNAM: "M",
        PARENT_OBJNAM: "X",
        LITCHR: 2,
        SECTR1: 10,
        SECTR2: 20,
        COLOUR: "3",
        VALNMR: 5,
        CATLIT: "1",
      }),
      lights({
        LNAM: "S2",
        PARENT_LNAM: "M",
        PARENT_OBJNAM: "X",
        LITCHR: 2,
        SECTR1: 20,
        SECTR2: 30,
        COLOUR: "4",
      }),
    ];
    const { geojson } = buildGeoJson(feats, "nautical");
    const s1 = geojson.features.find((f) => f.properties?.COLOUR === "3");
    expect(s1?.properties?.VALNMR).toBe(5);
    expect(s1?.properties?.CATLIT).toBe("1");
  });

  it("handles a child missing SECTR1/SECTR2 without crashing", () => {
    const feats = [
      lights({
        LNAM: "S1",
        PARENT_LNAM: "M",
        PARENT_OBJNAM: "X",
        LITCHR: 2,
        LABEL: "Fl G",
      }),
      lights({
        LNAM: "S2",
        PARENT_LNAM: "M",
        PARENT_OBJNAM: "X",
        LITCHR: 2,
        LABEL: "Fl R",
      }),
    ];
    const { geojson } = buildGeoJson(feats, "nautical");
    const children = geojson.features.filter(
      (f) => f.properties?._type === "child",
    );
    expect(children).toHaveLength(2);
    // No SECTR1/SECTR2 → ROT=0
    for (const c of children) expect(c.properties?.ROT).toBe(0);
  });

  it("skips parent-name feature when PARENT_OBJNAM is missing", () => {
    const feats = [lights({ LNAM: "S", PARENT_LNAM: "M", LITCHR: 2 })];
    const { geojson } = buildGeoJson(feats);
    const parents = geojson.features.filter(
      (f) => f.properties?._type === "parent-name",
    );
    expect(parents).toHaveLength(0);
  });

  it("dedupes identical labels within a cluster", () => {
    // Graves Light case: three sectors with identical rhythm/height/range,
    // differing only in bearing. Only one label should be kept; the
    // remaining two children emit icon-only (blank label).
    const feats = Array.from({ length: 3 }, (_, i) =>
      lights({
        LNAM: `S${i}`,
        PARENT_LNAM: "M",
        PARENT_OBJNAM: "Graves Light",
        PARENT_LAYER: "LNDMRK",
        LITCHR: 2,
        SIGGRP: "(2)",
        SIGPER: 12,
        COLOUR: "1",
        HEIGHT: 29.9,
        VALNMR: 14,
        LABEL: "Fl(2) 12s",
        SECTR1: i * 30,
        SECTR2: i * 30 + 20,
      }),
    );
    const { geojson } = buildGeoJson(feats, "nautical");
    const children = geojson.features.filter(
      (f) => f.properties?._type === "child",
    );
    const withLabel = children.filter((f) => f.properties?.LABEL !== "");
    const blank = children.filter((f) => f.properties?.LABEL === "");
    expect(children).toHaveLength(3);
    expect(withLabel).toHaveLength(1);
    expect(blank).toHaveLength(2);
    expect(withLabel[0].properties?.LABEL).toBe("Fl(2) 12s");
  });

  it("dedupes children contributed by multiple overlapping cells", () => {
    // Graves Light has 3 sectors and appears in 3 ENC cells (overview +
    // harbour + coastal). Without cross-cell dedup we'd emit 9 child
    // features; with it we emit 3 (one per unique sector). All 9 LNAMs
    // still go into suppressedLnams so every cell's raw LIGHTS are hidden.
    const pos: [number, number] = [-70.8696, 42.3649];
    const feats: Feature[] = [];
    for (const cell of ["a", "b", "c"]) {
      for (const [s1, s2] of [
        [10, 20] as const,
        [30, 40] as const,
        [50, 60] as const,
      ]) {
        feats.push(
          lights(
            {
              LNAM: `${cell}${s1}`,
              PARENT_LNAM: `m${cell}`,
              PARENT_OBJNAM: "Graves",
              PARENT_LAYER: "LNDMRK",
              LITCHR: 2,
              SIGGRP: "(2)",
              SIGPER: 12,
              COLOUR: "1",
              HEIGHT: 29.9,
              VALNMR: 14,
              LABEL: "Fl(2) 12s",
              SECTR1: s1,
              SECTR2: s2,
            },
            pos,
          ),
        );
      }
    }
    const { geojson, suppressedLnams } = buildGeoJson(feats, "nautical");
    const children = geojson.features.filter(
      (f) => f.properties?._type === "child",
    );
    expect(children).toHaveLength(3); // one per unique sector, not 9
    expect(suppressedLnams).toHaveLength(9); // every cell's LNAM suppressed
  });

  it("keeps distinct labels even within the same cluster", () => {
    // Cleveland Ledge case: sectors differ (Fl R vs Fl G vs Al WR) →
    // all non-duplicate labels render.
    const feats = [
      lights({
        LNAM: "A",
        PARENT_LNAM: "M",
        PARENT_OBJNAM: "X",
        LITCHR: 2,
        COLOUR: "3",
        LABEL: "Fl(1) R",
      }),
      lights({
        LNAM: "B",
        PARENT_LNAM: "M",
        PARENT_OBJNAM: "X",
        LITCHR: 2,
        COLOUR: "4",
        LABEL: "Fl(1) G",
      }),
    ];
    const { geojson } = buildGeoJson(feats, "nautical");
    const withLabel = geojson.features
      .filter((f) => f.properties?._type === "child")
      .filter((f) => f.properties?.LABEL !== "");
    expect(withLabel).toHaveLength(2);
  });

  it("skips parent-name when PARENT_LAYER is LNDMRK (avoids duplicate)", () => {
    // Boston Light / Graves Light style: the lighthouse LNDMRK is the parent.
    // The s57-lndmrk layer already renders its OBJNAM, so we must not also
    // emit a quoted parent-name copy.
    const feats = [
      lights({
        LNAM: "A",
        PARENT_LNAM: "M",
        PARENT_OBJNAM: "Boston Light",
        PARENT_LAYER: "LNDMRK",
        LITCHR: 2,
        SECTR1: 0,
        SECTR2: 90,
      }),
      lights({
        LNAM: "B",
        PARENT_LNAM: "M",
        PARENT_OBJNAM: "Boston Light",
        PARENT_LAYER: "LNDMRK",
        LITCHR: 2,
        SECTR1: 90,
        SECTR2: 180,
      }),
    ];
    const { geojson } = buildGeoJson(feats, "nautical");
    const parents = geojson.features.filter(
      (f) => f.properties?._type === "parent-name",
    );
    expect(parents).toHaveLength(0);
    // Children are still emitted + suppressed from s57-lights.
    const children = geojson.features.filter(
      (f) => f.properties?._type === "child",
    );
    expect(children).toHaveLength(2);
  });

  it("returns empty suppression when no PEL features are present", () => {
    const feats = [
      lights({ LNAM: "X", LITCHR: 2 }), // non-PEL
    ];
    const { geojson, suppressedLnams } = buildGeoJson(feats);
    expect(geojson.features).toHaveLength(0);
    expect(suppressedLnams).toEqual([]);
  });
});
