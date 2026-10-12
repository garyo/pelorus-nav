import { describe, expect, it } from "vitest";
import type { Place, SearchEntry } from "../data/search-index";
import { describeLocation, nearestTown, placeMatcher } from "./places";

const CA: Place = {
  label: "CA",
  codes: ["ca", "usa", "us"],
  names: ["california", "united states"],
};

const CORONADO: SearchEntry = {
  name: "Coronado",
  type: "BUAARE",
  center: [-117.178, 32.691],
  bbox: [-117.19, 32.68, -117.165, 32.704],
  place: CA,
};
// A point town, placed nearer the yacht club than Coronado's center.
const SAN_DIEGO: SearchEntry = {
  name: "San Diego",
  type: "BUAARE",
  center: [-117.173, 32.679],
  place: CA,
};
const YACHT_CLUB: SearchEntry = {
  name: "Coronado Yacht Club",
  type: "SMCFAC",
  center: [-117.1747, 32.682],
  place: CA,
};
const OFFSHORE: SearchEntry = {
  name: "Coronado Canyon",
  type: "SEAARE",
  center: [-117.6, 32.4],
};
const ENTRIES = [CORONADO, SAN_DIEGO, YACHT_CLUB, OFFSHORE];

describe("nearestTown", () => {
  it("prefers a town whose area contains the feature", () => {
    expect(nearestTown(YACHT_CLUB, ENTRIES)).toBe(CORONADO);
  });

  it("finds none beyond 10 nm", () => {
    expect(nearestTown(OFFSHORE, ENTRIES)).toBeUndefined();
  });

  it("gives towns none of their own", () => {
    expect(nearestTown(CORONADO, ENTRIES)).toBeUndefined();
  });
});

describe("describeLocation", () => {
  it("combines the town and the state", () => {
    expect(describeLocation(YACHT_CLUB, CORONADO)).toBe("near Coronado, CA");
    expect(describeLocation(OFFSHORE, CORONADO)).toBe("near Coronado");
    expect(describeLocation(CORONADO, undefined)).toBe("CA");
    expect(describeLocation(OFFSHORE, undefined)).toBeUndefined();
  });
});

const matchesWhere = (where: string, entry: SearchEntry) =>
  placeMatcher(where, ENTRIES)(entry);

describe("placeMatcher", () => {
  it("matches codes whole and names by word prefix", () => {
    expect(matchesWhere("ca", YACHT_CLUB)).toBe(true);
    expect(matchesWhere("cal", YACHT_CLUB)).toBe(true);
    expect(matchesWhere("states", YACHT_CLUB)).toBe(true);
    expect(matchesWhere("c", YACHT_CLUB)).toBe(false);
    expect(matchesWhere("ates", YACHT_CLUB)).toBe(false);
  });

  it("matches any town within reach, not only the nearest", () => {
    expect(matchesWhere("san diego", YACHT_CLUB)).toBe(true);
    expect(matchesWhere("diego", YACHT_CLUB)).toBe(true);
    expect(matchesWhere("coronado", OFFSHORE)).toBe(false);
  });
});
