import { describe, expect, it } from "vitest";
import { belowVesselLayerId } from "./layer-order";

function mapWith(ids: string[]): { getLayer(id: string): unknown } {
  return { getLayer: (id: string) => (ids.includes(id) ? { id } : undefined) };
}

describe("belowVesselLayerId", () => {
  it("returns the lowest vessel layer present", () => {
    expect(
      belowVesselLayerId(
        mapWith([
          "_vessel-accuracy-fill",
          "_vessel-accuracy-outline",
          "_vessel-icon",
        ]),
      ),
    ).toBe("_vessel-accuracy-fill");
  });

  it("falls through to the icon when the accuracy circle is absent", () => {
    expect(belowVesselLayerId(mapWith(["_vessel-icon"]))).toBe("_vessel-icon");
  });

  it("returns undefined when no vessel layers exist (append is fine — the vessel raises itself when it appears)", () => {
    expect(belowVesselLayerId(mapWith(["s57-airare"]))).toBeUndefined();
  });
});
