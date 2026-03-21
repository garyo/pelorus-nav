/**
 * End-to-end tests using actual Boston Harbor buoy data.
 *
 * These test cases use real feature properties from US5BOSCD and US5BOSCE
 * ENC cells, verifying the full chain from enriched tile properties through
 * icon resolution and feature info display.
 *
 * Each test case documents: buoy name, expected shape, expected color,
 * and expected icon sprite — based on NOAA Chart Explorer reference.
 */

import { describe, expect, it } from "vitest";
import { formatFeatureInfo } from "../feature-info";
import { type Props, resolveIcon } from "./test-helpers";

function getDetail(
  layer: string,
  props: Props,
  label: string,
): string | undefined {
  const info = formatFeatureInfo(layer, props);
  return info.details.find((d) => d.label === label)?.value;
}

// ── Actual Boston Harbor buoy data ─────────────────────────────────────
// Properties taken directly from enriched GeoJSON (post-pipeline).

describe("Boston Harbor BOYLAT buoys (US5BOSCD)", () => {
  it("Columbia Point Channel Buoy 2C — stbd conical red", () => {
    const props = {
      LABEL: "2C",
      OBJNAM: "Columbia Point Channel Buoy 2C",
      BOYSHP: 1,
      CATLAM: 2,
      COLOUR: "3",
    };
    expect(resolveIcon("BOYLAT", props)).toBe("BOYLAT14"); // red conical
    expect(getDetail("BOYLAT", props, "Category")).toBe("Starboard");
    expect(getDetail("BOYLAT", props, "Shape")).toBe("Conical");
    expect(getDetail("BOYLAT", props, "Color")).toBe("Red");
  });

  it("Winthrop Channel Buoy 3 — port can green", () => {
    const props = {
      LABEL: "3",
      OBJNAM: "Winthrop Channel Buoy 3",
      BOYSHP: 2,
      CATLAM: 1,
      COLOUR: "4",
    };
    expect(resolveIcon("BOYLAT", props)).toBe("BOYLAT23"); // green can/pillar
    expect(getDetail("BOYLAT", props, "Category")).toBe("Port");
    expect(getDetail("BOYLAT", props, "Shape")).toBe("Can");
    expect(getDetail("BOYLAT", props, "Color")).toBe("Green");
  });

  it("Boston Main Channel Lighted Buoy 12 — stbd pillar red", () => {
    const props = {
      LABEL: "12",
      OBJNAM: "Boston Main Channel Lighted Buoy 12",
      BOYSHP: 4,
      CATLAM: 2,
      COLOUR: "3",
    };
    expect(resolveIcon("BOYLAT", props)).toBe("BOYLAT24"); // red pillar
    expect(getDetail("BOYLAT", props, "Shape")).toBe("Pillar");
  });

  it("Dorchester Bay Lighted Buoy 5 — port pillar green", () => {
    const props = {
      LABEL: "5",
      OBJNAM: "Dorchester Bay Lighted Buoy 5",
      BOYSHP: 4,
      CATLAM: 1,
      COLOUR: "4",
    };
    expect(resolveIcon("BOYLAT", props)).toBe("BOYLAT23"); // green pillar
    expect(getDetail("BOYLAT", props, "Category")).toBe("Port");
    expect(getDetail("BOYLAT", props, "Shape")).toBe("Pillar");
  });

  it("Lower Middle Channel Buoy 1 — port can green", () => {
    const props = {
      LABEL: "1",
      OBJNAM: "Lower Middle Channel Buoy 1",
      BOYSHP: 2,
      CATLAM: 1,
      COLOUR: "4",
    };
    expect(resolveIcon("BOYLAT", props)).toBe("BOYLAT23"); // green can
  });
});

describe("Boston Harbor preferred channel buoys (US5BOSCE)", () => {
  it("President Roads Junction Buoy PR — pref stbd, pillar, green dominant", () => {
    const props = {
      LABEL: "PR",
      OBJNAM: "President Roads Junction Lighted Buoy PR",
      BOYSHP: 4,
      CATLAM: 3,
      COLOUR: "4,3,4",
    };
    // Pref stbd = green dominant → port shape set (green) → pillar → BOYLAT23
    expect(resolveIcon("BOYLAT", props)).toBe("BOYLAT23");
    expect(getDetail("BOYLAT", props, "Category")).toBe(
      "Preferred channel to starboard",
    );
    expect(getDetail("BOYLAT", props, "Color")).toBe("Green, Red, Green");
    expect(getDetail("BOYLAT", props, "Shape")).toBe("Pillar");
  });

  it("Nantasket Roads Channel Buoy TN — pref port, pillar, red dominant", () => {
    const props = {
      LABEL: "TN",
      OBJNAM: "Nantasket Roads Channel Lighted Buoy TN",
      BOYSHP: 4,
      CATLAM: 4,
      COLOUR: "3,4,3",
    };
    // Pref port = red dominant → stbd shape set (red) → pillar → BOYLAT24
    expect(resolveIcon("BOYLAT", props)).toBe("BOYLAT24");
    expect(getDetail("BOYLAT", props, "Category")).toBe(
      "Preferred channel to port",
    );
    expect(getDetail("BOYLAT", props, "Color")).toBe("Red, Green, Red");
  });

  it("Peddocks Island Buoy HS — pref stbd, can, green dominant", () => {
    const props = {
      LABEL: "HS",
      OBJNAM: "Peddocks Island Channel Hospital Shoal Buoy HS",
      BOYSHP: 2,
      CATLAM: 3,
      COLOUR: "4,3,4",
    };
    // Pref stbd = green dominant → port shape set → can → BOYLAT23
    expect(resolveIcon("BOYLAT", props)).toBe("BOYLAT23");
    expect(getDetail("BOYLAT", props, "Shape")).toBe("Can");
  });
});

describe("Boston Harbor BOYSPP buoys (US5BOSCD)", () => {
  it("Logan Airport Security Zone Buoy 26 — pillar white/orange", () => {
    const props = {
      LABEL: "26",
      OBJNAM: "Logan Airport Security Zone Buoy 26",
      BOYSHP: 4,
      COLOUR: "1,11",
      CATSPM: "50",
      STATUS: "8",
    };
    expect(resolveIcon("BOYSPP", props)).toBe("BOYSPP35"); // w/o pillar
    expect(getDetail("BOYSPP", props, "Color")).toBe("White, Orange");
    expect(getDetail("BOYSPP", props, "Status")).toBe("Private");
    expect(getDetail("BOYSPP", props, "Shape")).toBe("Pillar");
  });

  it("Bird Island Flats Anchorage Buoy A — can yellow", () => {
    const props = {
      LABEL: "A",
      OBJNAM: "Bird Island Flats Anchorage Buoy A",
      BOYSHP: 2,
      COLOUR: "6",
      CATSPM: "40",
      STATUS: "1",
    };
    expect(resolveIcon("BOYSPP", props)).toBe("BOYSPP25"); // yellow can
    expect(getDetail("BOYSPP", props, "Color")).toBe("Yellow");
    expect(getDetail("BOYSPP", props, "Shape")).toBe("Can");
    expect(getDetail("BOYSPP", props, "Status")).toBe("Permanent");
  });

  it("President Roads Anchorage Buoy C — can yellow", () => {
    const props = {
      LABEL: "C",
      OBJNAM: "President Roads Anchorage Buoy C",
      BOYSHP: 2,
      COLOUR: "6",
      CATSPM: "40",
    };
    expect(resolveIcon("BOYSPP", props)).toBe("BOYSPP25"); // yellow can
  });

  it("President Roads Anchorage Lighted Buoy B — pillar yellow", () => {
    const props = {
      LABEL: "B",
      OBJNAM: "President Roads Anchorage Lighted Buoy B",
      BOYSHP: 4,
      COLOUR: "6",
      CATSPM: "40",
    };
    expect(resolveIcon("BOYSPP", props)).toBe("BOYSPP35"); // yellow pillar
  });

  it("President Roads Anchorage Buoy E — conical yellow", () => {
    const props = {
      LABEL: "E",
      OBJNAM: "President Roads Anchorage Buoy E",
      BOYSHP: 1,
      COLOUR: "6",
      CATSPM: "40",
    };
    expect(resolveIcon("BOYSPP", props)).toBe("BOYSPP15"); // yellow conical
  });

  it("Spectacle Island Hazard Buoy B — pillar white/orange", () => {
    const props = {
      LABEL: "B",
      OBJNAM: "Spectacle Island Lighted Hazard Buoy B",
      BOYSHP: 4,
      COLOUR: "1,11",
      CATSPM: "27",
      STATUS: "5,8",
    };
    expect(resolveIcon("BOYSPP", props)).toBe("BOYSPP35"); // w/o pillar
    expect(getDetail("BOYSPP", props, "Color")).toBe("White, Orange");
    expect(getDetail("BOYSPP", props, "Status")).toBe("Temporary, Private");
  });

  it("Stone Living Lab Research Buoy A — pillar yellow", () => {
    const props = {
      LABEL: "A",
      OBJNAM: "Stone Living Lab Rainsford Island Lighted Research Buoy A",
      BOYSHP: 4,
      COLOUR: "6",
      CATSPM: "10",
    };
    expect(resolveIcon("BOYSPP", props)).toBe("BOYSPP35"); // pillar
  });
});

describe("BOYLAT shape consistency", () => {
  // Verify that ALL port can buoys get the same rectangular sprite,
  // ALL stbd conical buoys get the triangular sprite, etc.
  const portCans = [
    { BOYSHP: 2, CATLAM: 1, name: "regular can" },
    { BOYSHP: 2, CATLAM: 3, name: "preferred stbd can" },
  ];

  for (const { BOYSHP, CATLAM, name } of portCans) {
    it(`port ${name} → BOYLAT23 (green rectangular)`, () => {
      expect(resolveIcon("BOYLAT", { BOYSHP, CATLAM, COLOUR: "4" })).toBe(
        "BOYLAT23",
      );
    });
  }

  const stbdConicals = [
    { BOYSHP: 1, CATLAM: 2, name: "regular conical" },
    { BOYSHP: 1, CATLAM: 4, name: "preferred port conical" },
  ];

  for (const { BOYSHP, CATLAM, name } of stbdConicals) {
    it(`stbd ${name} → BOYLAT14 (red triangular)`, () => {
      expect(resolveIcon("BOYLAT", { BOYSHP, CATLAM, COLOUR: "3" })).toBe(
        "BOYLAT14",
      );
    });
  }
});
