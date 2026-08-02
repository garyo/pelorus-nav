import { describe, expect, it } from "vitest";
import {
  alongTrackDistanceNM,
  bboxOfCoords,
  bearingDelta,
  densifyGreatCircle,
  densifyGreatCirclePath,
  formatLatLon,
  greatCirclePoint,
  haversineDistanceNM,
  initialBearingDeg,
  parseLatLon,
  pathDistanceNM,
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

describe("bearingDelta", () => {
  it("zero when aligned", () => {
    expect(bearingDelta(45, 45)).toBe(0);
  });
  it("positive for right turn", () => {
    expect(bearingDelta(90, 60)).toBe(30);
  });
  it("negative for left turn", () => {
    expect(bearingDelta(60, 90)).toBe(-30);
  });
  it("wraps near 0/360 — small right", () => {
    expect(bearingDelta(10, 350)).toBe(20);
  });
  it("wraps near 0/360 — small left", () => {
    expect(bearingDelta(350, 10)).toBe(-20);
  });
  it("antipode returns ±180 (we get -180 from the modulo formulation)", () => {
    expect(Math.abs(bearingDelta(180, 0))).toBe(180);
  });
  it("handles 360-valued inputs", () => {
    expect(bearingDelta(360, 0)).toBe(0);
  });
});

describe("pathDistanceNM", () => {
  it("returns 0 for empty and single-point paths", () => {
    expect(pathDistanceNM([])).toBe(0);
    expect(pathDistanceNM([{ lat: 42, lon: -71 }])).toBe(0);
  });

  it("matches haversineDistanceNM for a two-point path", () => {
    const a = { lat: 42.36, lon: -71.05 };
    const b = { lat: 42.35, lon: -71.03 };
    expect(pathDistanceNM([a, b])).toBeCloseTo(
      haversineDistanceNM(a.lat, a.lon, b.lat, b.lon),
      10,
    );
  });

  it("sums consecutive legs", () => {
    const a = { lat: 42.0, lon: -71.0 };
    const b = { lat: 42.1, lon: -71.0 };
    const c = { lat: 42.1, lon: -70.9 };
    const expected =
      haversineDistanceNM(a.lat, a.lon, b.lat, b.lon) +
      haversineDistanceNM(b.lat, b.lon, c.lat, c.lon);
    expect(pathDistanceNM([a, b, c])).toBeCloseTo(expected, 10);
  });

  it("one degree of latitude is ~60 NM", () => {
    expect(
      pathDistanceNM([
        { lat: 42, lon: -71 },
        { lat: 43, lon: -71 },
      ]),
    ).toBeCloseTo(60, 0);
  });
});

describe("bboxOfCoords", () => {
  it("returns null for an empty array", () => {
    expect(bboxOfCoords([])).toBeNull();
  });

  it("returns a degenerate box for a single point", () => {
    expect(bboxOfCoords([[-71.06, 42.36]])).toEqual([
      -71.06, 42.36, -71.06, 42.36,
    ]);
  });

  it("finds min/max across lon and lat independently", () => {
    const coords: [number, number][] = [
      [-71.06, 42.36],
      [-70.9, 41.49],
      [-71.31, 42.0],
    ];
    expect(bboxOfCoords(coords)).toEqual([-71.31, 41.49, -70.9, 42.36]);
  });
});

describe("greatCirclePoint", () => {
  it("returns the endpoints exactly", () => {
    const a = greatCirclePoint(42, -71, 38, -28, 0);
    expect(a.lat).toBeCloseTo(42, 6);
    expect(a.lon).toBeCloseTo(-71, 6);
    const b = greatCirclePoint(42, -71, 38, -28, 1);
    expect(b.lat).toBeCloseTo(38, 6);
    expect(b.lon).toBeCloseTo(-28, 6);
  });

  it("puts the halfway point equidistant from both ends", () => {
    const mid = greatCirclePoint(41.49, -71.31, 38.53, -28.63, 0.5);
    const toStart = haversineDistanceNM(mid.lat, mid.lon, 41.49, -71.31);
    const toEnd = haversineDistanceNM(mid.lat, mid.lon, 38.53, -28.63);
    expect(toStart).toBeCloseTo(toEnd, 3);
  });

  it("bows poleward of the straight line in the northern hemisphere", () => {
    // The whole point of the feature: a great circle between two mid-latitude
    // points passes north of their mean latitude.
    const mid = greatCirclePoint(41.49, -71.31, 38.53, -28.63, 0.5);
    expect(mid.lat).toBeGreaterThan((41.49 + 38.53) / 2);
  });

  it("handles coincident points without dividing by zero", () => {
    const p = greatCirclePoint(42, -71, 42, -71, 0.5);
    expect(p.lat).toBeCloseTo(42, 9);
    expect(p.lon).toBeCloseTo(-71, 9);
  });
});

describe("densifyGreatCircle", () => {
  const from = { lat: 41.49, lon: -71.31 }; // Newport
  const azores = { lat: 38.53, lon: -28.63 };

  it("leaves a coastal leg as two points", () => {
    const pts = densifyGreatCircle(
      { lat: 42.98, lon: -70.62 },
      { lat: 43.65, lon: -70.24 },
    );
    expect(pts).toEqual([
      [-70.62, 42.98],
      [-70.24, 43.65],
    ]);
  });

  it("subdivides an ocean leg", () => {
    const pts = densifyGreatCircle(from, azores);
    expect(pts.length).toBeGreaterThan(8);
    expect(pts[0]).toEqual([from.lon, from.lat]);
    expect(pts[pts.length - 1][0]).toBeCloseTo(azores.lon, 6);
    expect(pts[pts.length - 1][1]).toBeCloseTo(azores.lat, 6);
  });

  it("keeps every drawn segment within the offset tolerance of the arc", () => {
    const tol = 0.5;
    const pts = densifyGreatCircle(from, azores, tol);
    for (let i = 1; i < pts.length; i++) {
      const [lon1, lat1] = pts[i - 1];
      const [lon2, lat2] = pts[i];
      const straightMid = { lat: (lat1 + lat2) / 2, lon: (lon1 + lon2) / 2 };
      const arcMid = greatCirclePoint(lat1, lon1, lat2, lon2, 0.5);
      const off = haversineDistanceNM(
        straightMid.lat,
        straightMid.lon,
        arcMid.lat,
        arcMid.lon,
      );
      expect(off).toBeLessThanOrEqual(tol);
    }
  });

  it("tightening the tolerance adds points", () => {
    const coarse = densifyGreatCircle(from, azores, 5);
    const fine = densifyGreatCircle(from, azores, 0.1);
    expect(fine.length).toBeGreaterThan(coarse.length);
  });

  it("keeps longitude continuous across the antimeridian", () => {
    // Tokyo → San Francisco. Wrapping to ±180 here would draw the leg back
    // across the whole world instead of over the Pacific.
    const pts = densifyGreatCircle(
      { lat: 35.68, lon: 139.77 },
      { lat: 37.77, lon: -122.42 },
    );
    for (let i = 1; i < pts.length; i++) {
      expect(Math.abs(pts[i][0] - pts[i - 1][0])).toBeLessThan(180);
    }
    // The end point is expressed past +180 rather than jumping negative.
    expect(pts[pts.length - 1][0]).toBeCloseTo(237.58, 1);
  });

  it("crosses the antimeridian westbound too", () => {
    const pts = densifyGreatCircle(
      { lat: 37.77, lon: -122.42 },
      { lat: 35.68, lon: 139.77 },
    );
    for (let i = 1; i < pts.length; i++) {
      expect(Math.abs(pts[i][0] - pts[i - 1][0])).toBeLessThan(180);
    }
    expect(pts[pts.length - 1][0]).toBeCloseTo(-220.23, 1);
  });
});

describe("densifyGreatCirclePath", () => {
  it("joins legs without repeating the shared waypoint", () => {
    const pts = densifyGreatCirclePath([
      { lat: 42.98, lon: -70.62 },
      { lat: 43.65, lon: -70.24 },
      { lat: 44.1, lon: -69.1 },
    ]);
    expect(pts).toEqual([
      [-70.62, 42.98],
      [-70.24, 43.65],
      [-69.1, 44.1],
    ]);
  });

  it("stays continuous when several legs cross the antimeridian", () => {
    // Per-leg unwrapping alone gives 170 → 190 then −170 → −150, and the join
    // draws straight back across the world.
    const pts = densifyGreatCirclePath([
      { lat: 20, lon: 170 },
      { lat: 21, lon: -170 },
      { lat: 22, lon: -150 },
    ]);
    for (let i = 1; i < pts.length; i++) {
      expect(Math.abs(pts[i][0] - pts[i - 1][0])).toBeLessThan(180);
    }
    expect(pts[pts.length - 1][0]).toBeGreaterThan(180);
  });

  it("handles degenerate input", () => {
    expect(densifyGreatCirclePath([])).toEqual([]);
    expect(densifyGreatCirclePath([{ lat: 42, lon: -71 }])).toEqual([
      [-71, 42],
    ]);
  });
});
