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
const CLEVELAND_LEDGE_SLAVES = [
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
  return CLEVELAND_LEDGE_SLAVES.map((p) =>
    lights({
      ...p,
      MASTER_LNAM: "M1",
      MASTER_OBJNAM: "Cleveland Ledge Channel Precision Directional Light",
    }),
  );
}

describe("buildClusters", () => {
  it("groups all slaves under the shared MASTER_LNAM", () => {
    const clusters = buildClusters(clevelandLedge());
    expect(clusters.size).toBe(1);
    const c = clusters.get("M1");
    expect(c?.slaves).toHaveLength(7);
    expect(c?.masterObjnam).toBe(
      "Cleveland Ledge Channel Precision Directional Light",
    );
  });

  it("keeps separate clusters apart", () => {
    const feats = [
      lights({ LNAM: "A1", MASTER_LNAM: "MA", MASTER_OBJNAM: "A", LITCHR: 2 }),
      lights({ LNAM: "A2", MASTER_LNAM: "MA", MASTER_OBJNAM: "A", LITCHR: 2 }),
      lights({ LNAM: "B1", MASTER_LNAM: "MB", MASTER_OBJNAM: "B", LITCHR: 2 }),
    ];
    const clusters = buildClusters(feats);
    expect(clusters.size).toBe(2);
    expect(clusters.get("MA")?.slaves).toHaveLength(2);
    expect(clusters.get("MB")?.slaves).toHaveLength(1);
  });

  it("ignores LIGHTS without MASTER_LNAM (non-PEL)", () => {
    const feats = [
      lights({ LNAM: "X", LITCHR: 2 }), // no master
      lights({ LNAM: "S", MASTER_LNAM: "M", LITCHR: 2 }),
    ];
    const clusters = buildClusters(feats);
    expect(clusters.size).toBe(1);
    expect(clusters.get("M")?.slaves).toHaveLength(1);
  });

  it("recovers MASTER_OBJNAM from any slave that carries it", () => {
    // Annotate_masters may have missing OBJNAM on some slaves if data is odd.
    const feats = [
      lights({ LNAM: "S1", MASTER_LNAM: "M", LITCHR: 2 }), // no OBJNAM
      lights({
        LNAM: "S2",
        MASTER_LNAM: "M",
        MASTER_OBJNAM: "Big Light",
        LITCHR: 2,
      }),
    ];
    const clusters = buildClusters(feats);
    expect(clusters.get("M")?.masterObjnam).toBe("Big Light");
  });
});

describe("buildGeoJson", () => {
  it("emits one slave feature per sector plus one master-name feature", () => {
    const { geojson } = buildGeoJson(clevelandLedge());
    const slaves = geojson.features.filter(
      (f) => f.properties?._type === "slave",
    );
    const masters = geojson.features.filter(
      (f) => f.properties?._type === "master-name",
    );
    expect(slaves).toHaveLength(7);
    expect(masters).toHaveLength(1);
    expect(masters[0].properties?.OBJNAM).toBe(
      "Cleveland Ledge Channel Precision Directional Light",
    );
  });

  it("returns all slave LNAMs for suppression", () => {
    const { suppressedLnams } = buildGeoJson(clevelandLedge());
    expect(suppressedLnams.sort()).toEqual(
      ["L1", "L2", "L3", "L4", "L5", "L6", "L7"].sort(),
    );
  });

  it("rotates teardrops to the sector midpoint (nautical sprites, no baked rotation)", () => {
    const { geojson } = buildGeoJson(clevelandLedge(), "nautical");
    const slaves = geojson.features.filter(
      (f) => f.properties?._type === "slave",
    );
    // L1: SECTR1=14.7, SECTR2=15.0 → midpoint 14.85° FROM seaward → 194.85° FROM light
    const l1 = slaves.find(
      (f) =>
        f.properties?.COLOUR === "3" &&
        (f.properties?.LABEL as string).startsWith("Fl"),
    );
    expect(l1?.properties?.ROT).toBeCloseTo(194.85, 1);
    // L7: SECTR1=16.4, SECTR2=16.7 → midpoint 16.55 → 196.55
    const l7 = slaves.find(
      (f) =>
        f.properties?.COLOUR === "4" &&
        (f.properties?.LABEL as string).startsWith("Fl"),
    );
    expect(l7?.properties?.ROT).toBeCloseTo(196.55, 1);
  });

  it("subtracts 135° baked rotation for S-52 sprites", () => {
    const { geojson } = buildGeoJson(clevelandLedge(), "s52-day");
    const slaves = geojson.features.filter(
      (f) => f.properties?._type === "slave",
    );
    // L1 visual bearing 194.85° → icon-rotate should be (194.85 - 135) = 59.85°
    const l1 = slaves.find(
      (f) =>
        f.properties?.COLOUR === "3" &&
        (f.properties?.LABEL as string).startsWith("Fl"),
    );
    expect(l1?.properties?.ROT).toBeCloseTo(59.85, 1);
  });

  it("ignores single-slave clusters (non-PEL lighted buoys)", () => {
    // A lighted buoy has one LIGHTS slave under a BOYLAT master. That's not
    // a PEL — it should render through s57-lights, not our overlay.
    const feats = [
      lights({
        LNAM: "SINGLE",
        MASTER_LNAM: "BUOY1",
        MASTER_OBJNAM: "Lighted Buoy",
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
      .filter((f) => f.properties?._type === "slave")
      .map((f) => f.properties?.LABEL);
    expect(labels.filter((l) => l === "")).toHaveLength(3);
    expect(labels.filter((l) => l !== "")).toHaveLength(4);
  });

  it("copies COLOUR/VALNMR/CATLIT so the shared LIGHTS iconExpr works", () => {
    const feats = [
      lights({
        LNAM: "S1",
        MASTER_LNAM: "M",
        MASTER_OBJNAM: "X",
        LITCHR: 2,
        SECTR1: 10,
        SECTR2: 20,
        COLOUR: "3",
        VALNMR: 5,
        CATLIT: "1",
      }),
      lights({
        LNAM: "S2",
        MASTER_LNAM: "M",
        MASTER_OBJNAM: "X",
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

  it("handles a slave missing SECTR1/SECTR2 without crashing", () => {
    const feats = [
      lights({
        LNAM: "S1",
        MASTER_LNAM: "M",
        MASTER_OBJNAM: "X",
        LITCHR: 2,
        LABEL: "Fl G",
      }),
      lights({
        LNAM: "S2",
        MASTER_LNAM: "M",
        MASTER_OBJNAM: "X",
        LITCHR: 2,
        LABEL: "Fl R",
      }),
    ];
    const { geojson } = buildGeoJson(feats, "nautical");
    const slaves = geojson.features.filter(
      (f) => f.properties?._type === "slave",
    );
    expect(slaves).toHaveLength(2);
    // No SECTR1/SECTR2 → ROT=0
    for (const s of slaves) expect(s.properties?.ROT).toBe(0);
  });

  it("skips master-name feature when MASTER_OBJNAM is missing", () => {
    const feats = [lights({ LNAM: "S", MASTER_LNAM: "M", LITCHR: 2 })];
    const { geojson } = buildGeoJson(feats);
    const masters = geojson.features.filter(
      (f) => f.properties?._type === "master-name",
    );
    expect(masters).toHaveLength(0);
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
