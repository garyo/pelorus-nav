// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  exportAllToGpx,
  parseGpx,
  routeToGpx,
  trackToGpx,
  waypointsToGpx,
} from "./gpx";
import type { Route } from "./Route";
import type { TrackMeta, TrackPoint } from "./Track";
import type { StandaloneWaypoint } from "./Waypoint";

const sampleRoute: Route = {
  id: "r1",
  name: "Boston Harbor",
  createdAt: 1700000000000,
  color: "#4488cc",
  visible: true,
  waypoints: [
    { lat: 42.3601, lon: -71.0589, name: "Start" },
    { lat: 42.3555, lon: -71.0486, name: "Mark 1" },
    { lat: 42.345, lon: -71.035, name: "End" },
  ],
};

const sampleTrackMeta: TrackMeta = {
  id: "t1",
  name: "Morning Sail",
  createdAt: 1700000000000,
  color: "#cc4444",
  visible: true,
  pointCount: 3,
};

const sampleTrackPoints: TrackPoint[] = [
  { lat: 42.36, lon: -71.06, timestamp: 1700000000000, sog: 5.2, cog: 45 },
  { lat: 42.361, lon: -71.059, timestamp: 1700000060000, sog: 5.5, cog: 47 },
  { lat: 42.362, lon: -71.058, timestamp: 1700000120000, sog: null, cog: null },
];

const sampleWaypoints: StandaloneWaypoint[] = [
  {
    id: "w1",
    lat: 42.36,
    lon: -71.06,
    name: "Anchorage A",
    notes: "Good holding",
    icon: "anchorage",
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
  {
    id: "w2",
    lat: 42.35,
    lon: -71.05,
    name: "Fuel Dock",
    notes: "",
    icon: "fuel",
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
];

describe("GPX export", () => {
  it("exports a route with valid GPX structure", () => {
    const gpx = routeToGpx(sampleRoute);
    expect(gpx).toContain('<?xml version="1.0"');
    expect(gpx).toContain('version="1.1"');
    expect(gpx).toContain("<rte>");
    expect(gpx).toContain("<name>Boston Harbor</name>");
    expect(gpx).toContain('lat="42.3601"');
    expect(gpx).toContain('lon="-71.0589"');
    expect(gpx).toContain("<name>Start</name>");
    expect(gpx).toContain("<name>Mark 1</name>");
    expect(gpx).toContain("</gpx>");
  });

  it("exports a track with timestamps and extensions", () => {
    const gpx = trackToGpx(sampleTrackMeta, sampleTrackPoints);
    expect(gpx).toContain("<trk>");
    expect(gpx).toContain("<name>Morning Sail</name>");
    expect(gpx).toContain("<time>");
    expect(gpx).toContain("<pelorus:sog>5.2</pelorus:sog>");
    expect(gpx).toContain("<pelorus:cog>45</pelorus:cog>");
    // Last point has null sog/cog — no extensions
    const lastTrkpt = gpx.lastIndexOf("<trkpt");
    const afterLast = gpx.slice(lastTrkpt);
    expect(afterLast).not.toContain("<pelorus:sog>");
  });

  it("exports waypoints with desc and sym", () => {
    const gpx = waypointsToGpx(sampleWaypoints);
    expect(gpx).toContain("<wpt");
    expect(gpx).toContain("<name>Anchorage A</name>");
    expect(gpx).toContain("<desc>Good holding</desc>");
    expect(gpx).toContain("<sym>anchorage</sym>");
    expect(gpx).toContain("<name>Fuel Dock</name>");
    expect(gpx).toContain("<sym>fuel</sym>");
    // Empty notes should not produce <desc>
    expect(gpx).not.toContain("<desc></desc>");
  });

  it("exports combined GPX with all data types", () => {
    const gpx = exportAllToGpx(
      [sampleRoute],
      [{ meta: sampleTrackMeta, points: sampleTrackPoints }],
      sampleWaypoints,
    );
    expect(gpx).toContain("<wpt");
    expect(gpx).toContain("<rte>");
    expect(gpx).toContain("<trk>");
  });

  it("escapes XML special characters", () => {
    const route: Route = {
      ...sampleRoute,
      name: 'Route <"A&B">',
      waypoints: [{ lat: 0, lon: 0, name: "Mark & <Point>" }],
    };
    const gpx = routeToGpx(route);
    expect(gpx).toContain("Route &lt;&quot;A&amp;B&quot;&gt;");
    expect(gpx).toContain("Mark &amp; &lt;Point&gt;");
    // Should still be valid XML
    const result = parseGpx(gpx);
    expect(result.routes[0].name).toBe('Route <"A&B">');
    expect(result.routes[0].waypoints[0].name).toBe("Mark & <Point>");
  });
});

describe("GPX import", () => {
  it("round-trips a route", () => {
    const gpx = routeToGpx(sampleRoute);
    const result = parseGpx(gpx);
    expect(result.routes).toHaveLength(1);
    const r = result.routes[0];
    expect(r.name).toBe("Boston Harbor");
    expect(r.color).toBe("#4488cc");
    expect(r.visible).toBe(true);
    expect(r.waypoints).toHaveLength(3);
    expect(r.waypoints[0].lat).toBe(42.3601);
    expect(r.waypoints[0].lon).toBe(-71.0589);
    expect(r.waypoints[0].name).toBe("Start");
    expect(r.waypoints[2].name).toBe("End");
    // Should have a new UUID
    expect(r.id).not.toBe("r1");
    expect(r.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("round-trips a track with timestamps and sog/cog", () => {
    const gpx = trackToGpx(sampleTrackMeta, sampleTrackPoints);
    const result = parseGpx(gpx);
    expect(result.tracks).toHaveLength(1);
    const { meta, points } = result.tracks[0];
    expect(meta.name).toBe("Morning Sail");
    expect(meta.color).toBe("#cc4444");
    expect(meta.pointCount).toBe(3);
    expect(points).toHaveLength(3);
    expect(points[0].lat).toBe(42.36);
    expect(points[0].timestamp).toBe(1700000000000);
    expect(points[0].sog).toBe(5.2);
    expect(points[0].cog).toBe(45);
    expect(points[2].sog).toBeNull();
    expect(points[2].cog).toBeNull();
  });

  it("round-trips waypoints with notes and icon", () => {
    const gpx = waypointsToGpx(sampleWaypoints);
    const result = parseGpx(gpx);
    expect(result.waypoints).toHaveLength(2);
    expect(result.waypoints[0].name).toBe("Anchorage A");
    expect(result.waypoints[0].notes).toBe("Good holding");
    expect(result.waypoints[0].icon).toBe("anchorage");
    expect(result.waypoints[1].name).toBe("Fuel Dock");
    expect(result.waypoints[1].notes).toBe("");
    expect(result.waypoints[1].icon).toBe("fuel");
  });

  it("parses GPX with mixed content types", () => {
    const gpx = exportAllToGpx(
      [sampleRoute],
      [{ meta: sampleTrackMeta, points: sampleTrackPoints }],
      sampleWaypoints,
    );
    const result = parseGpx(gpx);
    expect(result.routes).toHaveLength(1);
    expect(result.tracks).toHaveLength(1);
    expect(result.waypoints).toHaveLength(2);
  });

  it("uses fallback names when <name> is missing", () => {
    const gpx = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">',
      "  <rte>",
      '    <rtept lat="42.36" lon="-71.06"/>',
      "  </rte>",
      "  <trk>",
      "    <trkseg>",
      '      <trkpt lat="42.36" lon="-71.06"/>',
      "    </trkseg>",
      "  </trk>",
      '  <wpt lat="42.36" lon="-71.06"/>',
      "</gpx>",
    ].join("\n");
    const result = parseGpx(gpx);
    expect(result.routes[0].name).toBe("Imported Route 1");
    expect(result.tracks[0].meta.name).toBe("Imported Track 1");
    expect(result.waypoints[0].name).toBe("Imported Waypoint");
  });

  it("returns empty arrays for empty GPX", () => {
    const gpx = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">',
      "</gpx>",
    ].join("\n");
    const result = parseGpx(gpx);
    expect(result.routes).toHaveLength(0);
    expect(result.tracks).toHaveLength(0);
    expect(result.waypoints).toHaveLength(0);
  });

  it("throws on invalid XML", () => {
    expect(() => parseGpx("not xml at all <><>")).toThrow("Invalid GPX XML");
  });

  it("parses bare (non-namespaced) GPX", () => {
    const gpx = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<gpx version="1.1">',
      "  <rte>",
      "    <name>Test Route</name>",
      '    <rtept lat="42.36" lon="-71.06">',
      "      <name>WP1</name>",
      "    </rtept>",
      "  </rte>",
      "</gpx>",
    ].join("\n");
    const result = parseGpx(gpx);
    expect(result.routes).toHaveLength(1);
    expect(result.routes[0].name).toBe("Test Route");
    expect(result.routes[0].waypoints[0].name).toBe("WP1");
  });
});
