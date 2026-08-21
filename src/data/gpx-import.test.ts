import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAllRoutes: vi.fn(),
  getAllTrackMetas: vi.fn(),
  getAllWaypoints: vi.fn(),
  saveRoutes: vi.fn(),
  saveTrackMetas: vi.fn(),
  saveWaypoints: vi.fn(),
  appendTrackPoints: vi.fn(),
  replaceTrackPoints: vi.fn(),
}));

/** Everything handed to a bulk writer across all its calls. */
function written(mock: { mock: { calls: unknown[][] } }): unknown[] {
  return mock.mock.calls.flatMap((call) => call[0] as unknown[]);
}

vi.mock("./db", () => mocks);

import type { GpxImportResult } from "./gpx";
import {
  defaultImportFolder,
  describeGpxContents,
  describeGpxImport,
  describeGpxUnchanged,
  type GpxImportCounts,
  isGpxImportEmpty,
  saveGpxImport,
} from "./gpx-import";
import type { MergeCounts } from "./gpx-merge";
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
    mocks.getAllWaypoints.mockResolvedValue([]);
    mocks.saveRoutes.mockResolvedValue(undefined);
    mocks.saveTrackMetas.mockResolvedValue(undefined);
    mocks.appendTrackPoints.mockResolvedValue(undefined);
    mocks.replaceTrackPoints.mockResolvedValue(undefined);
    mocks.saveWaypoints.mockResolvedValue(undefined);
  });

  it("saves routes, tracks and waypoints from one file", async () => {
    const counts = await saveGpxImport(
      result({
        routes: [route("Passage")],
        tracks: [{ meta: trackMeta("Sail"), points: [point(1)] }],
        waypoints: [waypoint("Buoy")],
      }),
    );

    // One write per kind, not one per item.
    expect(mocks.saveRoutes).toHaveBeenCalledTimes(1);
    expect(written(mocks.saveRoutes)).toHaveLength(1);
    expect(mocks.saveTrackMetas).toHaveBeenCalledTimes(1);
    expect(mocks.appendTrackPoints).toHaveBeenCalledWith("t-Sail", [point(1)]);
    expect(written(mocks.saveWaypoints)).toHaveLength(1);
    expect(counts).toEqual({
      routes: { added: 1, updated: 0, unchanged: 0 },
      tracks: { added: 1, updated: 0, unchanged: 0 },
      waypoints: { added: 1, updated: 0, unchanged: 0 },
      skippedPoints: 0,
    });
  });

  it("suffixes the name of a different route that happens to share one", async () => {
    // Same name, different geometry — a genuinely separate route, so it's
    // added rather than merged, and the suffix keeps the two apart.
    const existing = { ...route("Passage"), id: "stored-1" };
    existing.waypoints = [{ lat: 1, lon: 1, name: "elsewhere" }];
    mocks.getAllRoutes.mockResolvedValue([existing]);
    const imported = route("Passage");

    await saveGpxImport(result({ routes: [imported, route("Fresh")] }));

    expect(imported.name).toBe("Passage (imported)");
    expect((written(mocks.saveRoutes)[1] as { name: string }).name).toBe(
      "Fresh",
    );
  });

  it("re-importing an unchanged file writes nothing", async () => {
    const stored = { ...route("Passage"), id: "stored-1" };
    mocks.getAllRoutes.mockResolvedValue([stored]);
    mocks.getAllWaypoints.mockResolvedValue([
      { ...waypoint("Buoy"), id: "stored-w" },
    ]);

    const counts = await saveGpxImport(
      result({ routes: [route("Passage")], waypoints: [waypoint("Buoy")] }),
    );

    expect(written(mocks.saveRoutes)).toHaveLength(0);
    expect(written(mocks.saveWaypoints)).toHaveLength(0);
    expect(counts.routes).toEqual({ added: 0, updated: 0, unchanged: 1 });
    expect(counts.waypoints).toEqual({ added: 0, updated: 0, unchanged: 1 });
  });

  it("updates a stored route in place when the file's copy changed", async () => {
    const stored = { ...route("Passage"), id: "stored-1", folder: "Maine" };
    mocks.getAllRoutes.mockResolvedValue([stored]);
    const changed = { ...route("Passage"), sourceId: "stored-1" };
    changed.waypoints = [{ lat: 42, lon: -71, name: "new" }];

    const counts = await saveGpxImport(result({ routes: [changed] }));

    expect(counts.routes).toEqual({ added: 0, updated: 1, unchanged: 0 });
    const saved = written(mocks.saveRoutes)[0] as {
      id: string;
      folder?: string;
      waypoints: unknown[];
    };
    expect(saved.id).toBe("stored-1");
    expect(saved.folder).toBe("Maine");
    expect(saved.waypoints).toEqual(changed.waypoints);
  });

  it("suffixes the name of a different track that happens to share one", async () => {
    mocks.getAllTrackMetas.mockResolvedValue([
      { ...trackMeta("Sail"), id: "stored-t", pointCount: 99 },
    ]);
    const meta = trackMeta("Sail");

    await saveGpxImport(result({ tracks: [{ meta, points: [] }] }));

    expect(meta.name).toBe("Sail (imported)");
  });

  it("writes track points before metas so an interruption leaves no phantom track", async () => {
    // A meta committed ahead of its points would, on interruption (quota,
    // tab close), leave a track whose pointCount promises points that were
    // never written. Orphan points without a meta are merely invisible.
    await saveGpxImport(
      result({
        tracks: [{ meta: trackMeta("Sail"), points: [point(1)] }],
      }),
    );

    expect(mocks.appendTrackPoints.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.saveTrackMetas.mock.invocationCallOrder[0],
    );
  });

  it("re-importing a smoothed track's own export (minus dropped points) writes nothing", async () => {
    // Export omits dropped points (gpx.ts), so the file comes back with a
    // smaller pointCount than the stored copy. That must not be classified
    // as an update — replaceTrackPoints would erase the raw/smoothed data.
    const stored = {
      ...trackMeta("Sail"),
      id: "stored-t",
      pointCount: 500,
      smoothed: true,
    };
    mocks.getAllTrackMetas.mockResolvedValue([stored]);
    const incoming = {
      ...trackMeta("Sail"),
      id: "fresh",
      sourceId: "stored-t",
      pointCount: 488,
    };

    const counts = await saveGpxImport(
      result({
        tracks: [{ meta: incoming, points: [point(1)] }],
      }),
    );

    expect(counts.tracks).toEqual({ added: 0, updated: 0, unchanged: 1 });
    expect(mocks.saveTrackMetas).not.toHaveBeenCalled();
    expect(mocks.replaceTrackPoints).not.toHaveBeenCalled();
    expect(mocks.appendTrackPoints).not.toHaveBeenCalled();
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
    expect(written(mocks.saveRoutes)).toHaveLength(0);
    expect(written(mocks.saveWaypoints)).toHaveLength(0);
    expect(counts).toEqual({
      routes: { added: 0, updated: 0, unchanged: 0 },
      tracks: { added: 0, updated: 0, unchanged: 0 },
      waypoints: { added: 0, updated: 0, unchanged: 0 },
      skippedPoints: 0,
    });
  });
});

describe("saveGpxImport folders", () => {
  beforeEach(() => {
    for (const fn of Object.values(mocks)) fn.mockReset();
    mocks.getAllRoutes.mockResolvedValue([]);
    mocks.getAllTrackMetas.mockResolvedValue([]);
    mocks.getAllWaypoints.mockResolvedValue([]);
    mocks.saveRoutes.mockResolvedValue(undefined);
    mocks.saveWaypoints.mockResolvedValue(undefined);
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

const mc = (p: Partial<MergeCounts> = {}): MergeCounts => ({
  added: 0,
  updated: 0,
  unchanged: 0,
  ...p,
});

const counts = (p: Partial<GpxImportCounts> = {}): GpxImportCounts => ({
  routes: mc(),
  tracks: mc(),
  waypoints: mc(),
  skippedPoints: 0,
  ...p,
});

describe("describeGpxImport", () => {
  it("is empty when nothing was written", () => {
    expect(describeGpxImport(counts())).toBe("");
  });

  it("stays empty when everything matched and nothing changed", () => {
    expect(describeGpxImport(counts({ routes: mc({ unchanged: 9 }) }))).toBe(
      "",
    );
  });

  it("uses the singular for one", () => {
    expect(describeGpxImport(counts({ routes: mc({ added: 1 }) }))).toBe(
      "1 route added",
    );
  });

  it("reports added and updated separately", () => {
    expect(
      describeGpxImport(counts({ routes: mc({ added: 5, updated: 8 }) })),
    ).toBe("5 routes added and 8 routes updated");
  });

  it("joins kinds with commas and a final 'and'", () => {
    expect(
      describeGpxImport(
        counts({
          routes: mc({ added: 2 }),
          tracks: mc({ added: 1 }),
          waypoints: mc({ added: 5 }),
        }),
      ),
    ).toBe("2 routes added, 1 track added and 5 waypoints added");
  });
});

describe("describeGpxUnchanged", () => {
  it("names what was recognized and left alone", () => {
    expect(
      describeGpxUnchanged(
        counts({
          routes: mc({ unchanged: 42 }),
          waypoints: mc({ unchanged: 296 }),
        }),
      ),
    ).toBe("42 routes and 296 waypoints");
  });

  it("is empty when nothing matched", () => {
    expect(describeGpxUnchanged(counts())).toBe("");
  });
});

describe("isGpxImportEmpty", () => {
  it("is true when every kind is unchanged — the everyday re-sync", () => {
    expect(isGpxImportEmpty(counts({ routes: mc({ unchanged: 55 }) }))).toBe(
      true,
    );
  });

  it("is false as soon as one item would be written", () => {
    expect(isGpxImportEmpty(counts({ waypoints: mc({ updated: 1 }) }))).toBe(
      false,
    );
  });
});

describe("describeGpxContents", () => {
  it("says what a file holds", () => {
    expect(
      describeGpxContents(
        result({ routes: [route("A")], waypoints: [waypoint("B")] }),
      ),
    ).toBe("1 route and 1 waypoint");
  });

  it("is empty for a file with nothing importable", () => {
    expect(describeGpxContents(result({}))).toBe("");
  });
});
