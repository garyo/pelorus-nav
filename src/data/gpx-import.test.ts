import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAllRoutes: vi.fn(),
  getAllTrackMetas: vi.fn(),
  saveRoute: vi.fn(),
  saveTrackMeta: vi.fn(),
  appendTrackPoints: vi.fn(),
  saveWaypoint: vi.fn(),
}));

vi.mock("./db", () => mocks);

import type { GpxImportResult } from "./gpx";
import {
  defaultImportFolder,
  describeGpxImport,
  type GpxImportCounts,
  saveGpxImport,
} from "./gpx-import";
import type { Route } from "./Route";
import type { TrackMeta, TrackPoint } from "./Track";
import type { StandaloneWaypoint } from "./Waypoint";

function route(name: string): Route {
  return {
    id: `r-${name}`,
    name,
    createdAt: 0,
    color: "#ff0000",
    visible: true,
    waypoints: [],
  };
}

function trackMeta(name: string): TrackMeta {
  return {
    id: `t-${name}`,
    name,
    createdAt: 0,
    color: "#ff0000",
    visible: true,
    pointCount: 0,
  };
}

function point(timestamp: number): TrackPoint {
  return { lat: 42, lon: -71, timestamp, sog: null, cog: null };
}

function waypoint(name: string): StandaloneWaypoint {
  return {
    id: `w-${name}`,
    name,
    lat: 42,
    lon: -71,
    notes: "",
    icon: "default",
    createdAt: 0,
    updatedAt: 0,
    visible: true,
  };
}

function result(partial: Partial<GpxImportResult>): GpxImportResult {
  return {
    routes: [],
    tracks: [],
    waypoints: [],
    skippedPoints: 0,
    metadataName: null,
    ...partial,
  };
}

describe("saveGpxImport", () => {
  beforeEach(() => {
    for (const fn of Object.values(mocks)) fn.mockReset();
    mocks.getAllRoutes.mockResolvedValue([]);
    mocks.getAllTrackMetas.mockResolvedValue([]);
    mocks.saveRoute.mockResolvedValue(undefined);
    mocks.saveTrackMeta.mockResolvedValue(undefined);
    mocks.appendTrackPoints.mockResolvedValue(undefined);
    mocks.saveWaypoint.mockResolvedValue(undefined);
  });

  it("saves routes, tracks and waypoints from one file", async () => {
    const counts = await saveGpxImport(
      result({
        routes: [route("Passage")],
        tracks: [{ meta: trackMeta("Sail"), points: [point(1)] }],
        waypoints: [waypoint("Buoy")],
      }),
    );

    expect(mocks.saveRoute).toHaveBeenCalledTimes(1);
    expect(mocks.saveTrackMeta).toHaveBeenCalledTimes(1);
    expect(mocks.appendTrackPoints).toHaveBeenCalledWith("t-Sail", [point(1)]);
    expect(mocks.saveWaypoint).toHaveBeenCalledTimes(1);
    expect(counts).toEqual({
      routes: 1,
      tracks: 1,
      waypoints: 1,
      skippedPoints: 0,
    });
  });

  it("suffixes route names that collide with existing ones", async () => {
    mocks.getAllRoutes.mockResolvedValue([route("Passage")]);
    const imported = route("Passage");

    await saveGpxImport(result({ routes: [imported, route("Fresh")] }));

    expect(imported.name).toBe("Passage (imported)");
    expect(mocks.saveRoute.mock.calls[1][0].name).toBe("Fresh");
  });

  it("suffixes track names that collide with existing ones", async () => {
    mocks.getAllTrackMetas.mockResolvedValue([trackMeta("Sail")]);
    const meta = trackMeta("Sail");

    await saveGpxImport(result({ tracks: [{ meta, points: [] }] }));

    expect(meta.name).toBe("Sail (imported)");
  });

  it("sorts track points by timestamp before saving", async () => {
    await saveGpxImport(
      result({
        tracks: [
          {
            meta: trackMeta("Sail"),
            points: [point(30), point(10), point(20)],
          },
        ],
      }),
    );

    expect(mocks.appendTrackPoints.mock.calls[0][1]).toEqual([
      point(10),
      point(20),
      point(30),
    ]);
  });

  it("passes skippedPoints through", async () => {
    const counts = await saveGpxImport(
      result({ waypoints: [waypoint("A")], skippedPoints: 7 }),
    );
    expect(counts.skippedPoints).toBe(7);
  });

  it("writes nothing for an empty file", async () => {
    const counts = await saveGpxImport(result({}));

    expect(mocks.getAllRoutes).not.toHaveBeenCalled();
    expect(mocks.getAllTrackMetas).not.toHaveBeenCalled();
    expect(mocks.saveRoute).not.toHaveBeenCalled();
    expect(mocks.saveWaypoint).not.toHaveBeenCalled();
    expect(counts).toEqual({
      routes: 0,
      tracks: 0,
      waypoints: 0,
      skippedPoints: 0,
    });
  });
});

describe("saveGpxImport folders", () => {
  beforeEach(() => {
    for (const fn of Object.values(mocks)) fn.mockReset();
    mocks.getAllRoutes.mockResolvedValue([]);
    mocks.saveRoute.mockResolvedValue(undefined);
  });

  it("files imported routes in the given folder", async () => {
    const a = route("Passage");
    const b = route("Return");

    await saveGpxImport(result({ routes: [a, b] }), "ActiveCaptain");

    expect(a.folder).toBe("ActiveCaptain");
    expect(b.folder).toBe("ActiveCaptain");
  });

  it("leaves a route's own folder alone", async () => {
    const own = { ...route("Passage"), folder: "Maine Cruise" };

    await saveGpxImport(result({ routes: [own] }), "ActiveCaptain");

    expect(own.folder).toBe("Maine Cruise");
  });

  it("leaves routes unfiled when no folder is given", async () => {
    const loose = route("Passage");

    await saveGpxImport(result({ routes: [loose] }));

    expect(loose.folder).toBeUndefined();
  });
});

describe("defaultImportFolder", () => {
  const june = new Date("2026-06-04T12:00:00Z");

  it("uses the file's own name", () => {
    expect(defaultImportFolder(result({ metadataName: "Maine Cruise" }))).toBe(
      "Maine Cruise",
    );
  });

  it("trims the file's name", () => {
    expect(defaultImportFolder(result({ metadataName: "  Day Sails " }))).toBe(
      "Day Sails",
    );
  });

  it("falls back to the date when the file names itself blankly", () => {
    expect(defaultImportFolder(result({ metadataName: "   " }), june)).toBe(
      `Imported ${june.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`,
    );
  });

  it("falls back to the date when the file has no name", () => {
    expect(defaultImportFolder(result({}), june)).toMatch(/^Imported /);
  });

  it("falls back to the date rather than use an unwieldy name", () => {
    const long = "A very long description of this file".repeat(3);
    expect(defaultImportFolder(result({ metadataName: long }), june)).toMatch(
      /^Imported /,
    );
  });
});

describe("describeGpxImport", () => {
  const counts = (p: Partial<GpxImportCounts>): GpxImportCounts => ({
    routes: 0,
    tracks: 0,
    waypoints: 0,
    skippedPoints: 0,
    ...p,
  });

  it("is empty when nothing was imported", () => {
    expect(describeGpxImport(counts({}))).toBe("");
  });

  it("uses the singular for one", () => {
    expect(describeGpxImport(counts({ routes: 1 }))).toBe("1 route");
  });

  it("pluralizes", () => {
    expect(describeGpxImport(counts({ waypoints: 3 }))).toBe("3 waypoints");
  });

  it("joins two kinds with 'and'", () => {
    expect(describeGpxImport(counts({ routes: 2, waypoints: 1 }))).toBe(
      "2 routes and 1 waypoint",
    );
  });

  it("joins three kinds with commas and a final 'and'", () => {
    expect(
      describeGpxImport(counts({ routes: 2, tracks: 1, waypoints: 5 })),
    ).toBe("2 routes, 1 track and 5 waypoints");
  });
});
