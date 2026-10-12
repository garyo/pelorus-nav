import { describe, expect, it } from "vitest";
import type { SearchEntry } from "../data/search-index";
import { approxDistanceNM, entriesNear, latSorted } from "./spatial";

const at = (name: string, lon: number, lat: number): SearchEntry => ({
  name,
  type: "LNDMRK",
  center: [lon, lat],
});

describe("approxDistanceNM", () => {
  it("measures a minute of latitude as a nautical mile", () => {
    expect(approxDistanceNM([-71, 42], [-71, 43])).toBeCloseTo(60, 6);
  });

  it("shrinks longitude by the cosine of the latitude", () => {
    expect(approxDistanceNM([0, 60], [1, 60])).toBeCloseTo(30, 6);
  });
});

describe("entriesNear", () => {
  it("returns entries within the radius from a lat-sorted list", () => {
    const entries = [
      at("north", -71, 42.2),
      at("here", -71, 42),
      at("east", -70.9, 42),
      at("south", -71, 41.95),
    ];
    const near = entriesNear(latSorted(entries), [-71, 42], 5);
    expect(near.map((e) => e.name).sort()).toEqual(["east", "here", "south"]);
  });
});
