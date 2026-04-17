import { describe, expect, it } from "vitest";
import {
  alongTrackDistanceNM,
  formatLatLon,
  haversineDistanceNM,
  initialBearingDeg,
  parseLatLon,
  projectPoint,
  toDegrees,
  toRadians,
} from "./coordinates";

describe("toRadians / toDegrees", () => {
  it("converts 180 degrees to PI radians", () => {
    expect(toRadians(180)).toBeCloseTo(Math.PI);
  });

  it("converts PI radians to 180 degrees", () => {
    expect(toDegrees(Math.PI)).toBeCloseTo(180);
  });

  it("round-trips correctly", () => {
    expect(toDegrees(toRadians(42.36))).toBeCloseTo(42.36);
  });
});

describe("haversineDistanceNM", () => {
  it("returns 0 for same point", () => {
    expect(haversineDistanceNM(42.36, -71.06, 42.36, -71.06)).toBe(0);
  });

  it("calculates Boston to Newport (~50 NM)", () => {
    // Boston Harbor to Newport RI is approximately 50 NM
    const dist = haversineDistanceNM(42.36, -71.06, 41.49, -71.31);
    expect(dist).toBeGreaterThan(45);
    expect(dist).toBeLessThan(55);
  });

  it("calculates one degree of latitude (~60 NM)", () => {
    const dist = haversineDistanceNM(0, 0, 1, 0);
    expect(dist).toBeCloseTo(60, 0);
  });
});

describe("initialBearingDeg", () => {
  it("returns 0 for due north", () => {
    const bearing = initialBearingDeg(42.0, -71.0, 43.0, -71.0);
    expect(bearing).toBeCloseTo(0, 0);
  });

  it("returns 90 for due east at equator", () => {
    const bearing = initialBearingDeg(0, 0, 0, 1);
    expect(bearing).toBeCloseTo(90, 0);
  });

  it("returns 180 for due south", () => {
    const bearing = initialBearingDeg(43.0, -71.0, 42.0, -71.0);
    expect(bearing).toBeCloseTo(180, 0);
  });

  it("returns 270 for due west at equator", () => {
    const bearing = initialBearingDeg(0, 0, 0, -1);
    expect(bearing).toBeCloseTo(270, 0);
  });

  it("Boston to Newport is roughly SW (~220°)", () => {
    const bearing = initialBearingDeg(42.36, -71.06, 41.49, -71.31);
    expect(bearing).toBeGreaterThan(190);
    expect(bearing).toBeLessThan(230);
  });
});

describe("formatLatLon", () => {
  it("formats positive latitude", () => {
    expect(formatLatLon(42.36, "lat")).toBe("42°21.60'N");
  });

  it("formats negative longitude", () => {
    expect(formatLatLon(-71.06, "lon")).toBe("071°03.60'W");
  });

  it("formats zero latitude as N", () => {
    expect(formatLatLon(0, "lat")).toBe("00°00.00'N");
  });
});

describe("parseLatLon", () => {
  it("parses decimal degrees with comma", () => {
    const result = parseLatLon("42.305, -70.946");
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result[0]).toBeCloseTo(42.305);
    expect(result[1]).toBeCloseTo(-70.946);
  });

  it("parses DDM with hemisphere letters", () => {
    const result = parseLatLon("42°18.295'N 70°56.787'W");
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result[0]).toBeCloseTo(42.30492, 3);
    expect(result[1]).toBeCloseTo(-70.94645, 3);
  });

  it("parses DDM with comma separator", () => {
    const result = parseLatLon("42°18.295'N, 70°56.787'W");
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result[0]).toBeCloseTo(42.30492, 3);
    expect(result[1]).toBeCloseTo(-70.94645, 3);
  });

  it("parses DDM without quote mark", () => {
    const result = parseLatLon("42°18.295N 70°56.787W");
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result[0]).toBeCloseTo(42.30492, 3);
  });

  it("parses decimal with hemisphere suffix", () => {
    const result = parseLatLon("42.305N 70.946W");
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result[0]).toBeCloseTo(42.305);
    expect(result[1]).toBeCloseTo(-70.946);
  });

  it("parses southern/eastern hemispheres", () => {
    const result = parseLatLon("33°51.000'S, 151°12.000'E");
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result[0]).toBeCloseTo(-33.85, 2);
    expect(result[1]).toBeCloseTo(151.2, 2);
  });

  it("returns null for empty string", () => {
    expect(parseLatLon("")).toBeNull();
  });

  it("returns null for garbage", () => {
    expect(parseLatLon("hello world")).toBeNull();
  });

  it("returns null for out-of-range lat", () => {
    expect(parseLatLon("91.0, -70.0")).toBeNull();
  });

  it("parses DMS format", () => {
    const result = parseLatLon("42°18'17.7\"N, 70°56'47.2\"W");
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result[0]).toBeCloseTo(42.3049, 3);
    expect(result[1]).toBeCloseTo(-70.9464, 3);
  });

  it("parses 'deg' keyword", () => {
    const result = parseLatLon("42deg18.295N, 70deg56.787W");
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result[0]).toBeCloseTo(42.30492, 3);
    expect(result[1]).toBeCloseTo(-70.94645, 3);
  });

  it("parses negative sign as W/S", () => {
    const result = parseLatLon("-42.305, -70.946");
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result[0]).toBeCloseTo(-42.305);
    expect(result[1]).toBeCloseTo(-70.946);
  });

  it("parses space-separated DMS without symbols", () => {
    const result = parseLatLon("42 18 17.7 N, 70 56 47.2 W");
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result[0]).toBeCloseTo(42.3049, 3);
    expect(result[1]).toBeCloseTo(-70.9464, 3);
  });

  it("parses hemisphere-separated coordinates without comma", () => {
    const result = parseLatLon("42°18.295'N 70°56.787'W");
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result[0]).toBeCloseTo(42.30492, 3);
    expect(result[1]).toBeCloseTo(-70.94645, 3);
  });

  it("rejects incomplete input with one hemisphere letter", () => {
    expect(parseLatLon("42 22N")).toBeNull();
    expect(parseLatLon("42.3 70W")).toBeNull();
  });

  it("parses curly right-single-quote apostrophes (U+2019)", () => {
    const result = parseLatLon("41\u00B0 20.2\u2019 N, 70\u00B0 55.0\u2019W");
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result[0]).toBeCloseTo(41.3367, 3);
    expect(result[1]).toBeCloseTo(-70.9167, 3);
  });

  it("parses unicode prime marks (U+2032 / U+2033)", () => {
    const result = parseLatLon(
      "42\u00B018\u203217.7\u2033N, 70\u00B056\u203247.2\u2033W",
    );
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result[0]).toBeCloseTo(42.3049, 3);
    expect(result[1]).toBeCloseTo(-70.9464, 3);
  });

  it("parses curly double quotes (U+201D)", () => {
    const result = parseLatLon(
      "42\u00B018'17.7\u201DN, 70\u00B056'47.2\u201DW",
    );
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result[0]).toBeCloseTo(42.3049, 3);
    expect(result[1]).toBeCloseTo(-70.9464, 3);
  });

  it("parses lon/lat order when hemispheres indicate swap", () => {
    const result = parseLatLon("70°56.787'W, 42°18.295'N");
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result[0]).toBeCloseTo(42.30492, 3);
    expect(result[1]).toBeCloseTo(-70.94645, 3);
  });
});

describe("alongTrackDistanceNM", () => {
  it("returns approximately full leg distance at the endpoint", () => {
    // A→B: equator, 0° to 1° east (≈60 NM). Point at B.
    const atd = alongTrackDistanceNM(0, 0, 0, 1, 0, 1);
    expect(atd).toBeCloseTo(60, 0);
  });

  it("returns ~0 at the start point", () => {
    const atd = alongTrackDistanceNM(0, 0, 0, 1, 0, 0);
    expect(atd).toBeCloseTo(0, 1);
  });

  it("returns half leg distance at midpoint", () => {
    const atd = alongTrackDistanceNM(0, 0, 0, 1, 0, 0.5);
    expect(atd).toBeCloseTo(30, 0);
  });

  it("exceeds leg distance when past the endpoint", () => {
    // Point at 0°, 1.5° — past the endpoint at 0°, 1°
    const legDist = haversineDistanceNM(0, 0, 0, 1);
    const atd = alongTrackDistanceNM(0, 0, 0, 1, 0, 1.5);
    expect(atd).toBeGreaterThan(legDist);
  });

  it("handles off-track point correctly", () => {
    // A at 0,0 → B at 0,1. Point offset north at 0.1, 0.5
    const atd = alongTrackDistanceNM(0, 0, 0, 1, 0.1, 0.5);
    // Should be approximately 30 NM (halfway along)
    expect(atd).toBeCloseTo(30, -1); // within 10 NM
  });

  it("returns negative for point behind start", () => {
    // A at 0,0 → B at 0,1. Point behind at 0, -0.5
    const atd = alongTrackDistanceNM(0, 0, 0, 1, 0, -0.5);
    expect(atd).toBeLessThan(0);
  });
});

describe("projectPoint", () => {
  it("projects due north by 60 NM (≈1° lat)", () => {
    const [lon, lat] = projectPoint(42.0, -71.0, 0, 60);
    expect(lat).toBeCloseTo(43.0, 0);
    expect(lon).toBeCloseTo(-71.0, 1);
  });

  it("projects due east at equator by 60 NM (≈1° lon)", () => {
    const [lon, lat] = projectPoint(0, 0, 90, 60);
    expect(lat).toBeCloseTo(0, 1);
    expect(lon).toBeCloseTo(1.0, 0);
  });

  it("projects due south", () => {
    const [lon, lat] = projectPoint(42.0, -71.0, 180, 60);
    expect(lat).toBeCloseTo(41.0, 0);
    expect(lon).toBeCloseTo(-71.0, 1);
  });

  it("projects zero distance returns same point", () => {
    const [lon, lat] = projectPoint(42.36, -71.06, 45, 0);
    expect(lat).toBeCloseTo(42.36, 4);
    expect(lon).toBeCloseTo(-71.06, 4);
  });

  it("round-trips with haversine distance", () => {
    const [lon, lat] = projectPoint(42.36, -71.06, 135, 10);
    const dist = haversineDistanceNM(42.36, -71.06, lat, lon);
    expect(dist).toBeCloseTo(10, 1);
  });
});
