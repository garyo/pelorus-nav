import { describe, expect, it } from "vitest";
import {
  countsOf,
  mergeRoute,
  mergeTrackMeta,
  mergeWaypoint,
  planMerge,
  routeSignature,
  trackMetaSignature,
  waypointIdentity,
  waypointSignature,
} from "./gpx-merge";
import type { Route } from "./Route";
import type { TrackMeta } from "./Track";
import type { StandaloneWaypoint } from "./Waypoint";

function route(over: Partial<Route> = {}): Route {
  return {
    id: "local-1",
    name: "Passage",
    createdAt: 100,
    color: "#4488cc",
    visible: true,
    waypoints: [
      { lat: 42.36, lon: -71.05, name: "A" },
      { lat: 42.35, lon: -71.03, name: "B" },
    ],
    ...over,
  };
}

function waypoint(over: Partial<StandaloneWaypoint> = {}): StandaloneWaypoint {
  return {
    id: "local-w",
    name: "Buoy",
    lat: 42.36,
    lon: -71.05,
    notes: "",
    icon: "default",
    createdAt: 100,
    updatedAt: 100,
    visible: true,
    ...over,
  };
}

function track(over: Partial<TrackMeta> = {}): TrackMeta {
  return {
    id: "local-t",
    name: "Sail",
    createdAt: 100,
    color: "#cc4444",
    visible: true,
    pointCount: 500,
    ...over,
  };
}

describe("planMerge — identity", () => {
  it("matches an incoming item by the id the file carries", () => {
    const stored = route({ id: "local-1", sourceId: "garmin-abc" });
    const incoming = route({ id: "fresh-uuid", sourceId: "garmin-abc" });

    const plan = planMerge([incoming], [stored], routeSignature);

    expect(countsOf(plan)).toEqual({ added: 0, updated: 0, unchanged: 1 });
  });

  it("matches our own export coming home, where the file's id is our local id", () => {
    const stored = route({ id: "local-1" });
    // routeToGpx writes pelorus:id = local id; parseGpx reads it as sourceId.
    const incoming = route({ id: "fresh-uuid", sourceId: "local-1" });

    const plan = planMerge([incoming], [stored], routeSignature);

    expect(plan.unchanged).toHaveLength(1);
  });

  it("matches by id even when the item was renamed and redrawn", () => {
    const stored = route({ id: "local-1", sourceId: "garmin-abc" });
    const incoming = route({
      id: "fresh",
      sourceId: "garmin-abc",
      name: "Renamed",
      waypoints: [{ lat: 43, lon: -70, name: "Z" }],
    });

    const plan = planMerge([incoming], [stored], routeSignature);

    expect(plan.update).toEqual([{ stored, incoming }]);
  });
});

describe("planMerge — content", () => {
  it("recognizes an identical item in a file carrying no ids", () => {
    const plan = planMerge([route({ id: "fresh" })], [route()], routeSignature);
    expect(plan.unchanged).toHaveLength(1);
  });

  it("treats a moved waypoint as an update when the file identifies it", () => {
    const stored = waypoint({ sourceId: "garmin-abc" });
    const moved = waypoint({ id: "fresh", sourceId: "garmin-abc", lat: 42.99 });

    const plan = planMerge([moved], [stored], waypointSignature);

    expect(plan.update).toHaveLength(1);
    expect(plan.add).toHaveLength(0);
  });

  it("cannot tell a move from a new mark in a file with no ids", () => {
    // The limit of content matching: nothing links the old position to the
    // new one, so a moved mark arrives as an addition. Files from Garmin (and
    // our own exports) carry ids, so this only bites hand-rolled GPX.
    const plan = planMerge(
      [waypoint({ id: "fresh", lat: 42.99 })],
      [waypoint()],
      waypointSignature,
    );

    expect(plan.add).toHaveLength(1);
  });

  it("ignores float noise below a metre", () => {
    const stored = waypoint({ lat: 42.36 });
    const wobbled = waypoint({ id: "fresh", lat: 42.360000000001 });

    expect(waypointSignature(stored)).toBe(waypointSignature(wobbled));
  });

  it("adds an item that matches nothing", () => {
    const plan = planMerge(
      [route({ id: "fresh", name: "New Passage" })],
      [route()],
      routeSignature,
    );
    expect(plan.add).toHaveLength(1);
  });

  it("never collapses two incoming items onto the same stored one", () => {
    const stored = route();
    const twins = [route({ id: "a" }), route({ id: "b" })];

    const plan = planMerge(twins, [stored], routeSignature);

    expect(countsOf(plan)).toEqual({ added: 1, updated: 0, unchanged: 1 });
  });

  it("matches an identical track on name and point count", () => {
    const plan = planMerge(
      [track({ id: "fresh" })],
      [track()],
      trackMetaSignature,
    );
    expect(plan.unchanged).toHaveLength(1);
  });

  it("updates a track that grew, when the file identifies it", () => {
    const stored = track({ sourceId: "src-1" });
    const longer = track({ id: "fresh", sourceId: "src-1", pointCount: 900 });

    const plan = planMerge([longer], [stored], trackMetaSignature);

    expect(plan.update).toHaveLength(1);
  });

  it("plans an empty file as nothing at all", () => {
    expect(countsOf(planMerge([], [route()], routeSignature))).toEqual({
      added: 0,
      updated: 0,
      unchanged: 0,
    });
  });
});

describe("merge keeps local organization", () => {
  it("keeps the folder, visibility, colour and id of the stored route", () => {
    const stored = route({
      id: "local-1",
      folder: "Maine Cruise",
      visible: false,
      color: "#123456",
      createdAt: 100,
    });
    const incoming = route({
      id: "fresh",
      sourceId: "garmin-abc",
      name: "Renamed",
      folder: "Imported Aug 1",
      visible: true,
      color: "#ffffff",
      createdAt: 999,
    });

    const merged = mergeRoute(stored, incoming);

    expect(merged.id).toBe("local-1");
    expect(merged.folder).toBe("Maine Cruise");
    expect(merged.visible).toBe(false);
    expect(merged.color).toBe("#123456");
    expect(merged.createdAt).toBe(100);
    // ...while taking the file's content.
    expect(merged.name).toBe("Renamed");
    expect(merged.sourceId).toBe("garmin-abc");
  });

  it("leaves an unfiled route unfiled rather than inventing a folder key", () => {
    const merged = mergeRoute(route(), route({ id: "fresh" }));
    expect("folder" in merged).toBe(false);
  });

  it("takes the file's geometry", () => {
    const incoming = route({
      id: "fresh",
      waypoints: [{ lat: 41, lon: -70, name: "Z" }],
    });
    expect(mergeRoute(route(), incoming).waypoints).toEqual(incoming.waypoints);
  });

  it("keeps a waypoint's folder and visibility, taking its new position", () => {
    const stored = waypoint({ folder: "Marks", visible: false });
    const incoming = waypoint({ id: "fresh", lat: 43, notes: "moved" });

    const merged = mergeWaypoint(stored, incoming);

    expect(merged.folder).toBe("Marks");
    expect(merged.visible).toBe(false);
    expect(merged.lat).toBe(43);
    expect(merged.notes).toBe("moved");
  });

  it("keeps a track's folder, colour and visibility", () => {
    const stored = track({ folder: "Deliveries", visible: false });
    const incoming = track({ id: "fresh", color: "#ffffff", pointCount: 900 });

    const merged = mergeTrackMeta(stored, incoming);

    expect(merged.folder).toBe("Deliveries");
    expect(merged.visible).toBe(false);
    expect(merged.color).toBe("#cc4444");
    expect(merged.pointCount).toBe(900);
  });

  it("remembers the source id once one is known, across a file that omits it", () => {
    const stored = route({ sourceId: "garmin-abc" });
    const merged = mergeRoute(stored, route({ id: "fresh", name: "Edited" }));
    expect(merged.sourceId).toBe("garmin-abc");
  });
});

/**
 * The everyday case for a file that carries no ids: a GPX hand-edited or
 * exported by an app that writes none, re-imported after a symbol change.
 * Keyed on content alone, every such edit arrived as a second copy of a mark
 * the user already had.
 */
describe("planMerge — editing an id-less file", () => {
  /** What the parser produces on re-import: a brand-new local id, no sourceId. */
  const reparsed = (over: Partial<StandaloneWaypoint> = {}) =>
    waypoint({ id: "fresh-uuid", ...over });

  it("updates the mark when its colour changes", () => {
    const stored = [waypoint({ icon: "triangle", color: "red" })];
    const incoming = [reparsed({ icon: "triangle", color: "green" })];

    const plan = planMerge(
      incoming,
      stored,
      waypointSignature,
      waypointIdentity,
    );

    expect(plan.add).toHaveLength(0);
    expect(plan.update).toHaveLength(1);
    expect(plan.update[0].stored.id).toBe("local-w");
    expect(plan.update[0].incoming.color).toBe("green");
  });

  it("updates the mark when its symbol or notes change", () => {
    const stored = [waypoint({ icon: "default", notes: "" })];
    const incoming = [reparsed({ icon: "anchorage", notes: "Good holding" })];

    const plan = planMerge(
      incoming,
      stored,
      waypointSignature,
      waypointIdentity,
    );

    expect(plan.add).toHaveLength(0);
    expect(plan.update).toHaveLength(1);
  });

  it("still writes nothing when the file has not changed at all", () => {
    const stored = [waypoint({ icon: "triangle", color: "red" })];
    const incoming = [reparsed({ icon: "triangle", color: "red" })];

    const plan = planMerge(
      incoming,
      stored,
      waypointSignature,
      waypointIdentity,
    );

    expect(plan.unchanged).toHaveLength(1);
    expect(plan.add).toHaveLength(0);
    expect(plan.update).toHaveLength(0);
  });

  /** Real exports do this: two marks called ROBISN half a mile apart. */
  it("keeps same-named marks at different positions apart", () => {
    const stored = [
      waypoint({ id: "w1", name: "ROBISN", lat: 41.443889, lon: -70.792407 }),
      waypoint({ id: "w2", name: "ROBISN", lat: 41.441002, lon: -70.781764 }),
    ];
    const incoming = [
      reparsed({
        name: "ROBISN",
        lat: 41.443889,
        lon: -70.792407,
        icon: "flag",
      }),
      reparsed({ name: "ROBISN", lat: 41.441002, lon: -70.781764 }),
    ];

    const plan = planMerge(
      incoming,
      stored,
      waypointSignature,
      waypointIdentity,
    );

    expect(plan.add).toHaveLength(0);
    // Only the one whose symbol changed is rewritten, and it's the one at its
    // own position — not its namesake.
    expect(plan.update).toHaveLength(1);
    expect(plan.update[0].stored.id).toBe("w1");
    expect(plan.unchanged).toHaveLength(1);
  });

  /**
   * Position is half of what identifies an id-less mark, so a moved one is a
   * new one. Nothing in the file can say otherwise — that is what ids are for.
   */
  it("treats a moved mark as a new one", () => {
    const stored = [waypoint({ lat: 42.36, lon: -71.05 })];
    const incoming = [reparsed({ lat: 42.4, lon: -71.05 })];

    const plan = planMerge(
      incoming,
      stored,
      waypointSignature,
      waypointIdentity,
    );

    expect(plan.add).toHaveLength(1);
    expect(plan.update).toHaveLength(0);
  });

  it("matches on the id when the file carries one, wherever the mark has moved to", () => {
    const stored = [waypoint({ sourceId: "gid-1" })];
    const incoming = [
      reparsed({ sourceId: "gid-1", lat: 42.4, name: "Renamed" }),
    ];

    const plan = planMerge(
      incoming,
      stored,
      waypointSignature,
      waypointIdentity,
    );

    expect(plan.add).toHaveLength(0);
    expect(plan.update).toHaveLength(1);
  });
});
