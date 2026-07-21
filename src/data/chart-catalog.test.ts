import { describe, expect, it } from "vitest";
import {
  bboxIntersects,
  findRegionForPosition,
  getRegion,
  regionsInView,
  regionsInViewWithHysteresis,
} from "./chart-catalog";

describe("bboxIntersects", () => {
  const a: [number, number, number, number] = [-71, 42, -70, 43];
  it("true for overlapping boxes", () => {
    expect(bboxIntersects(a, [-70.5, 42.5, -69, 44])).toBe(true);
  });
  it("true when one contains the other", () => {
    expect(bboxIntersects(a, [-72, 41, -69, 44])).toBe(true);
  });
  it("false for disjoint boxes (east of)", () => {
    expect(bboxIntersects(a, [-69, 42, -68, 43])).toBe(false);
  });
  it("false for disjoint boxes (north of)", () => {
    expect(bboxIntersects(a, [-71, 44, -70, 45])).toBe(false);
  });
});

describe("regionsInView", () => {
  it("returns only the active region when bounds is null", () => {
    expect(regionsInView(null, "usvi")).toEqual(["usvi"]);
  });
  it("always includes the active region even if its bbox is out of view", () => {
    // bounds in the mid-Pacific, far from USVI
    expect(regionsInView([-150, -10, -140, 0], "usvi")).toEqual(["usvi"]);
  });
  it("includes a region whose bbox overlaps the viewport", () => {
    // Boston-area viewport → northern-new-england (the active region here too)
    const ids = regionsInView(
      [-71.1, 42.3, -70.9, 42.4],
      "northern-new-england",
    );
    expect(ids).toContain("northern-new-england");
  });
  it("brings in a neighbor when the viewport spans a boundary", () => {
    // A viewport spanning the NNE/SNE latitude boundary (~42°N) includes both,
    // even though only one is active.
    const ids = regionsInView(
      [-71.5, 41.5, -71.0, 42.5],
      "northern-new-england",
    );
    expect(ids).toContain("northern-new-england");
    expect(ids).toContain("southern-new-england");
  });
});

describe("regionsInViewWithHysteresis", () => {
  // Viewport just north of the NNE/SNE boundary (~42N): overlaps only NNE.
  // Exact bounds stop north of SNE (north edge 42.0); the 50% pad reaches it.
  const northOfLine: [number, number, number, number] = [
    -71.1, 42.05, -70.9, 42.25,
  ];

  it("matches regionsInView when nothing was previously loaded", () => {
    expect(
      regionsInViewWithHysteresis(northOfLine, "northern-new-england", []),
    ).toEqual(regionsInView(northOfLine, "northern-new-england"));
  });

  it("keeps a previously loaded region that is just out of view", () => {
    const ids = regionsInViewWithHysteresis(
      northOfLine,
      "northern-new-england",
      ["northern-new-england", "southern-new-england"],
    );
    expect(ids).toContain("southern-new-england");
  });

  it("drops a previously loaded region once it is far out of view", () => {
    const ids = regionsInViewWithHysteresis(
      [-70.0, 43.5, -69.8, 43.7], // mid-Maine coast, well north of SNE + pad
      "northern-new-england",
      ["northern-new-england", "southern-new-england"],
    );
    expect(ids).not.toContain("southern-new-england");
  });

  it("does not add an unloaded region that only touches the padded bounds", () => {
    const ids = regionsInViewWithHysteresis(
      northOfLine,
      "northern-new-england",
      ["northern-new-england"],
    );
    expect(ids).not.toContain("southern-new-england");
  });

  it("returns only the active region when bounds is null", () => {
    expect(
      regionsInViewWithHysteresis(null, "usvi", ["northern-new-england"]),
    ).toEqual(["usvi"]);
  });
});

describe("findRegionForPosition", () => {
  it("returns southern-new-england for Narragansett Bay", () => {
    const region = findRegionForPosition(41.5, -71.4);
    expect(region?.id).toBe("southern-new-england");
  });

  it("returns northern-new-england for Boston", () => {
    const region = findRegionForPosition(42.36, -71.06);
    expect(region?.id).toBe("northern-new-england");
  });

  it("returns northern-new-england for Deer Island", () => {
    const region = findRegionForPosition(45.1, -66.84);
    expect(region?.id).toBe("northern-new-england");
  });

  it("returns USVI for St. Thomas coordinates", () => {
    const region = findRegionForPosition(18.34, -64.93);
    expect(region?.id).toBe("usvi");
  });

  it("returns new-york for NYC coordinates", () => {
    const region = findRegionForPosition(40.7, -74.0);
    expect(region?.id).toBe("new-york");
  });

  it("returns mid-atlantic for Chesapeake Bay", () => {
    const region = findRegionForPosition(37.0, -76.0);
    expect(region?.id).toBe("mid-atlantic");
  });

  it("returns south-atlantic for Miami", () => {
    const region = findRegionForPosition(25.8, -80.2);
    expect(region?.id).toBe("south-atlantic");
  });

  it("returns south-atlantic for Key West wildlife refuge", () => {
    const region = findRegionForPosition(24.445, -82.169);
    expect(region?.id).toBe("south-atlantic");
  });

  // Shared latitude boundaries — first match wins
  it("returns northern-new-england at 42.0°N (SNE/NNE boundary)", () => {
    const region = findRegionForPosition(42.0, -71.0);
    expect(region?.id).toBe("northern-new-england");
  });

  it("returns southern-new-england at 41.0°N (SNE/NY boundary)", () => {
    const region = findRegionForPosition(41.0, -72.0);
    expect(region?.id).toBe("southern-new-england");
  });

  it("returns new-york at 39.0°N (NY/Mid-Atlantic boundary)", () => {
    const region = findRegionForPosition(39.0, -75.0);
    expect(region?.id).toBe("new-york");
  });

  it("returns mid-atlantic at 35.0°N (Mid-Atlantic/South boundary)", () => {
    const region = findRegionForPosition(35.0, -75.0);
    expect(region?.id).toBe("mid-atlantic");
  });

  it("returns undefined for position far from any region", () => {
    const region = findRegionForPosition(0, 0);
    expect(region).toBeUndefined();
  });
});

describe("getRegion", () => {
  it("finds region by ID", () => {
    expect(getRegion("southern-new-england")?.name).toBe(
      "Southern New England",
    );
    expect(getRegion("northern-new-england")?.name).toBe(
      "Northern New England",
    );
    expect(getRegion("new-york")?.name).toBe("New York & NJ");
    expect(getRegion("mid-atlantic")?.name).toBe("Mid-Atlantic");
    expect(getRegion("south-atlantic")?.name).toBe("South Atlantic");
    expect(getRegion("usvi")?.name).toBe("USVI & Puerto Rico");
  });

  it("returns undefined for unknown ID", () => {
    expect(getRegion("nonexistent")).toBeUndefined();
    expect(getRegion("new-england")).toBeUndefined();
  });
});
