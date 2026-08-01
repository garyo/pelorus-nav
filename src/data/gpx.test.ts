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
    visible: true,
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
    visible: true,
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

  it("rounds trkpt lat/lon and sog/cog to avoid float noise", () => {
    const noisy: TrackPoint[] = [
      {
        lat: 42.34866445279327,
        lon: -71.02177731100036,
        timestamp: 1700000000000,
        sog: 4.598195902669607,
        cog: 128.69478433098968,
      },
    ];
    const gpx = trackToGpx(sampleTrackMeta, noisy);
    expect(gpx).toContain('lat="42.3486645" lon="-71.0217773"');
    expect(gpx).toContain("<pelorus:sog>4.6</pelorus:sog>");
    expect(gpx).toContain("<pelorus:cog>128.7</pelorus:cog>");
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

  it("exports the folder as a pelorus extension, escaped", () => {
    const gpx = routeToGpx({ ...sampleRoute, folder: "USVI A & B" });
    expect(gpx).toContain("<pelorus:folder>USVI A &amp; B</pelorus:folder>");
  });

  it("emits no folder element without one (the id is always written)", () => {
    const gpx = routeToGpx({ ...sampleRoute, color: "" });
    expect(gpx).not.toContain("pelorus:folder");
    expect(gpx).toContain("<pelorus:id>r1</pelorus:id>");
  });

  it("writes each item's id so a re-import can recognize it", () => {
    const gpx = exportAllToGpx(
      [sampleRoute],
      [{ meta: sampleTrackMeta, points: sampleTrackPoints }],
      sampleWaypoints,
    );
    expect(gpx).toContain("<pelorus:id>r1</pelorus:id>");
    expect(gpx).toContain("<pelorus:id>t1</pelorus:id>");
    expect(gpx).toContain("<pelorus:id>w1</pelorus:id>");
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
    // Folderless routes come back without a folder key
    expect("folder" in r).toBe(false);
    // Should have a new UUID
    expect(r.id).not.toBe("r1");
    expect(r.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("reads the file's own name from <metadata>", () => {
    const gpx = routeToGpx(sampleRoute);
    expect(parseGpx(gpx).metadataName).toBe("Boston Harbor");
  });

  it("reports no name when <metadata> carries none", () => {
    const gpx =
      '<?xml version="1.0"?><gpx version="1.1" creator="test">' +
      "<rte><name>Loose</name>" +
      '<rtept lat="42.36" lon="-71.05"/></rte></gpx>';
    expect(parseGpx(gpx).metadataName).toBeNull();
  });

  it("takes the file's name, not a route's, from a named file", () => {
    const gpx =
      '<?xml version="1.0"?><gpx version="1.1" creator="test">' +
      "<metadata><name>Maine Cruise</name></metadata>" +
      "<rte><name>Leg 1</name>" +
      '<rtept lat="42.36" lon="-71.05"/></rte></gpx>';
    expect(parseGpx(gpx).metadataName).toBe("Maine Cruise");
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

  it("does not emit raw lat/lon by default; smoothed lat/lon export cleanly", () => {
    const smoothedPoints: TrackPoint[] = [
      {
        lat: 42.3601,
        lon: -71.0599,
        timestamp: 1700000000000,
        sog: 5.2,
        cog: 45,
        rawLat: 42.36,
        rawLon: -71.06,
      },
    ];
    const gpx = trackToGpx(sampleTrackMeta, smoothedPoints);
    expect(gpx).not.toContain("pelorus:lat-raw");
    expect(gpx).not.toContain("pelorus:lon-raw");
    // Smoothed lat/lon still go out as the trkpt attrs.
    expect(gpx).toContain('lat="42.3601"');
    expect(gpx).toContain('lon="-71.0599"');
    // Round-trip drops the raw fields (they're not emitted).
    const result = parseGpx(gpx);
    const points = result.tracks[0].points;
    expect(points[0].rawLat).toBeUndefined();
    expect(points[0].rawLon).toBeUndefined();
  });

  it("round-trips per-point accuracy via pelorus extension", () => {
    const points: TrackPoint[] = [
      {
        lat: 42.36,
        lon: -71.06,
        timestamp: 1700000000000,
        sog: 5,
        cog: 45,
        accuracy: 8.4,
      },
      {
        lat: 42.37,
        lon: -71.05,
        timestamp: 1700000060000,
        sog: 5,
        cog: 45,
        accuracy: null,
      },
    ];
    const gpx = trackToGpx(sampleTrackMeta, points);
    expect(gpx).toContain("<pelorus:accuracy>8.4</pelorus:accuracy>");
    const result = parseGpx(gpx);
    const parsed = result.tracks[0].points;
    expect(parsed[0].accuracy).toBe(8.4);
    // null accuracy isn't emitted, so it doesn't come back
    expect(parsed[1].accuracy).toBeUndefined();
  });

  it("excludes dropped points from track export", () => {
    const points: TrackPoint[] = [
      { lat: 42.36, lon: -71.06, timestamp: 1700000000000, sog: 5, cog: 45 },
      {
        lat: 42.37,
        lon: -71.05,
        timestamp: 1700000060000,
        sog: 5,
        cog: 45,
        dropped: true,
      },
      { lat: 42.362, lon: -71.058, timestamp: 1700000120000, sog: 5, cog: 45 },
    ];
    const gpx = trackToGpx(sampleTrackMeta, points);
    const result = parseGpx(gpx);
    expect(result.tracks[0].points).toHaveLength(2);
    expect(result.tracks[0].points.map((p) => p.timestamp)).toEqual([
      1700000000000, 1700000120000,
    ]);
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

  it("parses MOB/COB waypoint syms", () => {
    const gpx = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">',
      '  <wpt lat="42.36" lon="-71.06"><name>A</name><sym>cob</sym></wpt>',
      '  <wpt lat="42.37" lon="-71.07"><name>B</name><sym>MOB</sym></wpt>',
      '  <wpt lat="42.38" lon="-71.08"><name>C</name><sym>Man Overboard</sym></wpt>',
      "</gpx>",
    ].join("\n");
    const result = parseGpx(gpx);
    expect(result.waypoints.map((w) => w.icon)).toEqual(["cob", "cob", "cob"]);
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

  it("doesn't mistake a rtept's <name> for the route's own name", () => {
    // A <rte> with no <name> of its own but whose first <rtept> has one —
    // a descendant search would wrongly pick up the waypoint's name.
    const gpx = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">',
      "  <rte>",
      '    <rtept lat="42.36" lon="-71.06">',
      "      <name>Mark 1</name>",
      "    </rtept>",
      "  </rte>",
      "</gpx>",
    ].join("\n");
    const result = parseGpx(gpx);
    expect(result.routes[0].name).toBe("Imported Route 1");
    expect(result.routes[0].waypoints[0].name).toBe("Mark 1");
  });

  it("skips a waypoint with a missing lat/lon instead of defaulting to null-island", () => {
    const gpx = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">',
      "  <wpt>",
      "    <name>No Position</name>",
      "  </wpt>",
      '  <wpt lat="42.36" lon="-71.06">',
      "    <name>Good</name>",
      "  </wpt>",
      "</gpx>",
    ].join("\n");
    const result = parseGpx(gpx);
    expect(result.waypoints).toHaveLength(1);
    expect(result.waypoints[0].name).toBe("Good");
    expect(result.skippedPoints).toBe(1);
  });

  it("skips a route point with an out-of-range or non-numeric coordinate", () => {
    const gpx = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">',
      "  <rte>",
      "    <name>Bad Points</name>",
      '    <rtept lat="120" lon="-71.06"><name>Bad lat</name></rtept>',
      '    <rtept lat="42.36" lon="abc"><name>Bad lon</name></rtept>',
      '    <rtept lat="42.36" lon="-71.06"><name>Good</name></rtept>',
      "  </rte>",
      "</gpx>",
    ].join("\n");
    const result = parseGpx(gpx);
    expect(result.routes[0].waypoints).toHaveLength(1);
    expect(result.routes[0].waypoints[0].name).toBe("Good");
    expect(result.skippedPoints).toBe(2);
  });

  it("skips a track point with a non-numeric coordinate", () => {
    const gpx = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">',
      "  <trk>",
      "    <trkseg>",
      '      <trkpt lat="42.36" lon="-71.06"/>',
      '      <trkpt lat="notanumber" lon="-71.06"/>',
      '      <trkpt lat="42.37" lon="-71.05"/>',
      "    </trkseg>",
      "  </trk>",
      "</gpx>",
    ].join("\n");
    const result = parseGpx(gpx);
    expect(result.tracks[0].points).toHaveLength(2);
    expect(result.skippedPoints).toBe(1);
  });

  it("reports zero skipped points for a fully valid file", () => {
    const gpx = routeToGpx(sampleRoute);
    const result = parseGpx(gpx);
    expect(result.skippedPoints).toBe(0);
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

describe("preserving another app's extensions", () => {
  const OPENCPN =
    '<?xml version="1.0"?><gpx version="1.1" creator="OpenCPN" ' +
    'xmlns="http://www.topografix.com/GPX/1/1" ' +
    'xmlns:gpxx="http://www.garmin.com/xmlschemas/GpxExtensions/v3" ' +
    'xmlns:opencpn="http://www.opencpn.org">' +
    "<rte><extensions>" +
    "<opencpn:guid>57ac3bd9-d91a-44ef-a8a4-5f5d7bd4c553</opencpn:guid>" +
    "<opencpn:viz>1</opencpn:viz>" +
    "<opencpn:planned_speed>4.50</opencpn:planned_speed>" +
    "<gpxx:RouteExtension><gpxx:IsAutoNamed>false</gpxx:IsAutoNamed>" +
    "</gpxx:RouteExtension>" +
    "</extensions>" +
    '<rtept lat="42.3691995" lon="-71.0499287"><name>001</name><extensions>' +
    "<opencpn:guid>4de74d4e-1909-4119-9fa4-b2b15972709f</opencpn:guid>" +
    "<opencpn:arrival_radius>0.050</opencpn:arrival_radius>" +
    "</extensions></rtept>" +
    '<rtept lat="42.3688915" lon="-71.0488" /></rte></gpx>';

  it("hands a route's extensions back on export", () => {
    const out = exportAllToGpx(parseGpx(OPENCPN).routes, [], []);
    expect(out).toContain(
      "<opencpn:guid>57ac3bd9-d91a-44ef-a8a4-5f5d7bd4c553</opencpn:guid>",
    );
    expect(out).toContain(
      "<opencpn:planned_speed>4.50</opencpn:planned_speed>",
    );
    expect(out).toContain("<gpxx:IsAutoNamed>false</gpxx:IsAutoNamed>");
  });

  it("keeps each route point's own extensions with that point", () => {
    const out = exportAllToGpx(parseGpx(OPENCPN).routes, [], []);
    const firstPt = out.slice(out.indexOf("<rtept"), out.indexOf("</rtept>"));
    expect(firstPt).toContain(
      "<opencpn:guid>4de74d4e-1909-4119-9fa4-b2b15972709f</opencpn:guid>",
    );
    expect(firstPt).toContain("<opencpn:arrival_radius>0.050");
  });

  it("declares each namespace once, on the root", () => {
    const out = exportAllToGpx(parseGpx(OPENCPN).routes, [], []);
    expect(out.match(/xmlns:opencpn=/g)).toHaveLength(1);
    expect(out.indexOf("xmlns:opencpn=")).toBeLessThan(out.indexOf("<rte>"));
  });

  it("drops visibility, which the app now owns locally", () => {
    // Re-emitting the file's stale viz would tell OpenCPN a route is shown
    // when the user has since hidden it here.
    const out = exportAllToGpx(parseGpx(OPENCPN).routes, [], []);
    expect(out).not.toContain("opencpn:viz");
  });

  it("does not duplicate our own elements into the preserved block", () => {
    const once = routeToGpx({ ...sampleRoute, folder: "USVI" });
    const twice = routeToGpx(parseGpx(once).routes[0]);
    expect(twice.match(/pelorus:folder/g)).toHaveLength(2); // open + close
    expect(twice.match(/pelorus:id/g)).toHaveLength(2);
  });

  it("survives a second trip unchanged", () => {
    const first = exportAllToGpx(parseGpx(OPENCPN).routes, [], []);
    const second = exportAllToGpx(parseGpx(first).routes, [], []);
    const strip = (s: string) =>
      s.replace(/<time>[^<]*<\/time>/g, "").replace(/<pelorus:id>[^<]*</g, "<");
    expect(strip(second)).toBe(strip(first));
  });

  it("adds no extensions block to an item that had none", () => {
    const gpx =
      '<?xml version="1.0"?><gpx version="1.1" creator="test">' +
      '<wpt lat="42.36" lon="-71.05"><name>Plain</name></wpt></gpx>';
    const wp = parseGpx(gpx).waypoints[0];
    expect(wp.sourceExtensions).toBeUndefined();
  });
});

describe("GPX folder round-trip", () => {
  it("preserves the folder through export and import", () => {
    const gpx = routeToGpx({ ...sampleRoute, folder: "USVI" });
    const result = parseGpx(gpx);
    expect(result.routes[0].folder).toBe("USVI");
  });

  it("round-trips escaped folder names", () => {
    const gpx = routeToGpx({ ...sampleRoute, folder: 'Trip <"A&B">' });
    expect(parseGpx(gpx).routes[0].folder).toBe('Trip <"A&B">');
  });

  it("preserves a waypoint's folder", () => {
    const gpx = waypointsToGpx([
      { ...sampleWaypoints[0], folder: "Maine Cruise" },
    ]);
    expect(parseGpx(gpx).waypoints[0].folder).toBe("Maine Cruise");
  });

  it("preserves a track's folder alongside its color", () => {
    const gpx = trackToGpx(
      { ...sampleTrackMeta, folder: "Deliveries" },
      sampleTrackPoints,
    );
    const meta = parseGpx(gpx).tracks[0].meta;
    expect(meta.folder).toBe("Deliveries");
    expect(meta.color).toBe("#cc4444");
  });

  it("emits no folder element for a folderless waypoint", () => {
    const gpx = waypointsToGpx([sampleWaypoints[0]]);
    expect(gpx).not.toContain("pelorus:folder");
  });

  it("round-trips an item's id as the sourceId a re-import matches on", () => {
    const parsed = parseGpx(routeToGpx(sampleRoute));
    expect(parsed.routes[0].sourceId).toBe("r1");
    // ...and the local id is fresh, so nothing collides if it is a new import.
    expect(parsed.routes[0].id).not.toBe("r1");
  });

  it("reads a Garmin uuid extension as the sourceId", () => {
    const gpx =
      '<?xml version="1.0"?><gpx version="1.1" creator="Garmin" ' +
      'xmlns:uuidx="http://www.garmin.com/xmlschemas/IdentifierExtension/v1">' +
      '<wpt lat="42.36" lon="-71.05"><name>RANDY</name>' +
      "<extensions><uuidx:uuid>225a11e5-5050-45df-a263-b744e13fa975</uuidx:uuid>" +
      "</extensions></wpt></gpx>";
    expect(parseGpx(gpx).waypoints[0].sourceId).toBe(
      "225a11e5-5050-45df-a263-b744e13fa975",
    );
  });

  it("imports waypoints visible", () => {
    const gpx = waypointsToGpx(sampleWaypoints);
    expect(parseGpx(gpx).waypoints.every((w) => w.visible)).toBe(true);
  });
});
