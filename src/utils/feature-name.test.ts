import { describe, expect, it } from "vitest";
import { abbreviateFeatureName } from "./feature-name";

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
