/**
 * CRUD/persistence tests for standalone waypoints. `StandaloneWaypoint`
 * (./Waypoint.ts) is a pure interface with no logic, so these tests
 * exercise the waypoint persistence functions in ./db.ts (saveWaypoint,
 * getAllWaypoints, deleteWaypoint) against a fake IndexedDB, black-box —
 * only through their public save/list/delete contract.
 */
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StandaloneWaypoint } from "./Waypoint";

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  vi.resetModules();
});

async function loadDb() {
  return import("./db");
}

function makeWaypoint(
  over: Partial<StandaloneWaypoint> = {},
): StandaloneWaypoint {
  return {
    id: "w1",
    lat: 42.355,
    lon: -71.045,
    name: "Fuel Dock",
    notes: "Diesel only, call ahead on 16",
    icon: "fuel",
    createdAt: Date.parse("2026-01-01T00:00:00Z"),
    updatedAt: Date.parse("2026-01-01T00:00:00Z"),
    ...over,
  };
}

describe("waypoint persistence", () => {
  it("save then list returns the saved waypoint", async () => {
    const db = await loadDb();
    const wp = makeWaypoint();
    await db.saveWaypoint(wp);
    expect(await db.getAllWaypoints()).toEqual([wp]);
  });

  it("returns an empty list when nothing has been saved", async () => {
    const db = await loadDb();
    expect(await db.getAllWaypoints()).toEqual([]);
  });

  it("preserves every field through a roundtrip, including icon and notes", async () => {
    const db = await loadDb();
    const wp = makeWaypoint({ icon: "hazard", notes: "Submerged rock" });
    await db.saveWaypoint(wp);
    const [loaded] = await db.getAllWaypoints();
    expect(loaded).toEqual(wp);
  });

  it("lists multiple distinct waypoints independently", async () => {
    const db = await loadDb();
    const a = makeWaypoint({ id: "a", name: "Anchorage" });
    const b = makeWaypoint({ id: "b", name: "Hazard" });
    await db.saveWaypoint(a);
    await db.saveWaypoint(b);
    const all = await db.getAllWaypoints();
    expect(all).toHaveLength(2);
    expect(all.map((w) => w.id).sort()).toEqual(["a", "b"]);
  });

  it("saving a waypoint with an existing id updates it in place (put semantics)", async () => {
    const db = await loadDb();
    await db.saveWaypoint(makeWaypoint({ name: "Original", updatedAt: 1000 }));
    await db.saveWaypoint(
      makeWaypoint({ name: "Renamed", notes: "moved", updatedAt: 2000 }),
    );
    const all = await db.getAllWaypoints();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe("Renamed");
    expect(all[0].notes).toBe("moved");
    expect(all[0].updatedAt).toBe(2000);
  });

  it("deletes a waypoint by id", async () => {
    const db = await loadDb();
    await db.saveWaypoint(makeWaypoint({ id: "keep" }));
    await db.saveWaypoint(makeWaypoint({ id: "gone" }));
    await db.deleteWaypoint("gone");
    const all = await db.getAllWaypoints();
    expect(all.map((w) => w.id)).toEqual(["keep"]);
  });

  it("deleting a non-existent id is a silent no-op", async () => {
    const db = await loadDb();
    await db.saveWaypoint(makeWaypoint({ id: "keep" }));
    await expect(db.deleteWaypoint("never-existed")).resolves.toBeUndefined();
    expect(await db.getAllWaypoints()).toHaveLength(1);
  });
});
