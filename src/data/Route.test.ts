/**
 * CRUD/persistence tests for routes. The `Route` type itself
 * (./Route.ts) is a pure interface with no logic, so these tests
 * exercise the route persistence functions in ./db.ts (saveRoute,
 * getAllRoutes, deleteRoute) against a fake IndexedDB, black-box —
 * only through their public save/list/delete contract, not db.ts's
 * connection-caching or migration internals.
 */
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Route } from "./Route";

// Fresh fake IndexedDB + fresh db.ts module (its connection promise is
// cached at module scope) before every test, so tests can't see each
// other's data or a stale connection to a torn-down database.
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  vi.resetModules();
});

async function loadDb() {
  return import("./db");
}

function makeRoute(over: Partial<Route> = {}): Route {
  return {
    id: "r1",
    name: "Boston Harbor Loop",
    createdAt: Date.parse("2026-01-01T00:00:00Z"),
    color: "#ff0000",
    visible: true,
    waypoints: [
      { lat: 42.363559, lon: -71.047973, name: "Inner Harbor" },
      { lat: 42.361406, lon: -71.045476, name: "Long Wharf" },
    ],
    ...over,
  };
}

describe("route persistence", () => {
  it("save then list returns the saved route", async () => {
    const db = await loadDb();
    const route = makeRoute();
    await db.saveRoute(route);
    expect(await db.getAllRoutes()).toEqual([route]);
  });

  it("returns an empty list when nothing has been saved", async () => {
    const db = await loadDb();
    expect(await db.getAllRoutes()).toEqual([]);
  });

  it("preserves waypoint order and fields through a roundtrip", async () => {
    const db = await loadDb();
    const route = makeRoute({
      waypoints: [
        { lat: 1, lon: 2, name: "A" },
        { lat: 3, lon: 4, name: "B" },
        { lat: 5, lon: 6, name: "C" },
      ],
    });
    await db.saveRoute(route);
    const [loaded] = await db.getAllRoutes();
    expect(loaded.waypoints.map((w) => w.name)).toEqual(["A", "B", "C"]);
    expect(loaded.waypoints).toEqual(route.waypoints);
  });

  it("lists multiple distinct routes independently", async () => {
    const db = await loadDb();
    const a = makeRoute({ id: "a", name: "Route A" });
    const b = makeRoute({ id: "b", name: "Route B" });
    await db.saveRoute(a);
    await db.saveRoute(b);
    const all = await db.getAllRoutes();
    expect(all).toHaveLength(2);
    expect(all.map((r) => r.id).sort()).toEqual(["a", "b"]);
  });

  it("saving a route with an existing id updates it in place (put semantics)", async () => {
    const db = await loadDb();
    await db.saveRoute(makeRoute({ name: "Original" }));
    await db.saveRoute(makeRoute({ name: "Renamed", color: "#00ff00" }));
    const all = await db.getAllRoutes();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe("Renamed");
    expect(all[0].color).toBe("#00ff00");
  });

  it("deletes a route by id", async () => {
    const db = await loadDb();
    await db.saveRoute(makeRoute({ id: "keep" }));
    await db.saveRoute(makeRoute({ id: "gone" }));
    await db.deleteRoute("gone");
    const all = await db.getAllRoutes();
    expect(all.map((r) => r.id)).toEqual(["keep"]);
  });

  it("deleting a non-existent id is a silent no-op", async () => {
    const db = await loadDb();
    await db.saveRoute(makeRoute({ id: "keep" }));
    await expect(db.deleteRoute("never-existed")).resolves.toBeUndefined();
    expect(await db.getAllRoutes()).toHaveLength(1);
  });
});
