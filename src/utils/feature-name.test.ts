import { describe, expect, it } from "vitest";
import { abbreviateFeatureName, isNearDuplicateName } from "./feature-name";

describe("abbreviateFeatureName", () => {
  it.each([
    ["Boston Main Channel Light 5", "Boston Main Chan Lt 5"],
    ["Western Way Buoy 7", "Western Way 7"],
    ["Peddocks Island Channel Buoy 2P", "Peddocks Is Chan 2P"],
    [
      "Peddocks Island Channel Hospital Shoal Buoy HS",
      "Peddocks Is Chan Hosp Shl HS",
    ],
    ["Nubble Channel Buoy 5", "Nubble Chan 5"],
    ["Boston Main Channel Lighted Buoy 10", "Boston Main Chan LB 10"],
  ])("abbreviates %j → %j", (input, expected) => {
    expect(abbreviateFeatureName(input)).toBe(expected);
  });

  it("leaves names without abbreviatable words unchanged", () => {
    expect(abbreviateFeatureName("MBTA Tunnel")).toBe("MBTA Tunnel");
  });

  it("drops the standalone Buoy word but keeps the designation", () => {
    expect(abbreviateFeatureName("Green Can Buoy 9")).toBe("Green Can 9");
  });

  it("does not abbreviate 'Light' inside 'Lighted'", () => {
    expect(abbreviateFeatureName("Lighted Buoy 2")).toBe("LB 2");
  });

  it("collapses irregular whitespace", () => {
    expect(abbreviateFeatureName("  Nubble   Channel   Buoy 5 ")).toBe(
      "Nubble Chan 5",
    );
  });

  it("falls back to the trimmed input if only a dropped word remains", () => {
    expect(abbreviateFeatureName("  Buoy  ")).toBe("Buoy");
  });

  it("is case-insensitive for matching", () => {
    expect(abbreviateFeatureName("SOUTH CHANNEL LIGHT 3")).toBe(
      "SOUTH Chan Lt 3",
    );
  });
});

describe("isNearDuplicateName", () => {
  // ~500 m of latitude ≈ 0.0045°
  const base = { lat: 42.35, lon: -71.0 };

  it("flags a same-named neighbor within 500 m", () => {
    expect(
      isNearDuplicateName("Fan Pier S", base.lat, base.lon, [
        { name: "Fan Pier S", lat: base.lat + 0.002, lon: base.lon },
      ]),
    ).toBe(true);
  });

  it("is case- and whitespace-insensitive", () => {
    expect(
      isNearDuplicateName("Fan Pier S", base.lat, base.lon, [
        { name: "  fan pier s ", lat: base.lat, lon: base.lon },
      ]),
    ).toBe(true);
  });

  it("keeps same-named features that are far apart", () => {
    expect(
      isNearDuplicateName("Nun 2", base.lat, base.lon, [
        { name: "Nun 2", lat: base.lat + 0.05, lon: base.lon }, // ~5.5 km
      ]),
    ).toBe(false);
  });

  it("ignores nearby neighbors with different names", () => {
    expect(
      isNearDuplicateName("Fan Pier S", base.lat, base.lon, [
        { name: "Fan Pier N", lat: base.lat + 0.001, lon: base.lon },
      ]),
    ).toBe(false);
  });

  it("handles no neighbors", () => {
    expect(isNearDuplicateName("WP1", base.lat, base.lon, [])).toBe(false);
  });
});
