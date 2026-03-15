import { describe, expect, it } from "vitest";
import { findRegionForPosition, getRegion } from "./chart-catalog";

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
  it("returns southern-new-england at 42.0°N (SNE/NNE boundary)", () => {
    const region = findRegionForPosition(42.0, -71.0);
    expect(region?.id).toBe("southern-new-england");
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
