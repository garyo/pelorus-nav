/**
 * Tests for db.ts's connection lifecycle: multi-tab version-change handling
 * (a newer app version upgrading the schema from another tab) and the
 * blocked-upgrade error path, against a fake IndexedDB.
 */
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const DB_NAME = "pelorus-nav";

// Fresh fake IndexedDB + fresh db.ts module (its connection promise is
// cached at module scope) before every test.
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  vi.resetModules();
});

async function loadDb() {
  return import("./db");
}

/** Raw open outside db.ts; the caller wires up any versionchange handling. */
function rawOpen(
  version: number,
  onUpgrade?: (db: IDBDatabase) => void,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, version);
    req.onupgradeneeded = () => onUpgrade?.(req.result);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Create the stores a real version-1 database has, so db.ts's incremental
 * migrations (which reference them) can run against it. */
function createV1Stores(db: IDBDatabase): void {
  db.createObjectStore("tracks", { keyPath: "id" });
  const pts = db.createObjectStore("trackPoints", { autoIncrement: true });
  pts.createIndex("byTrack", "trackId");
  db.createObjectStore("routes", { keyPath: "id" });
}

describe("openDB multi-tab version handling", () => {
  it("closes its connection so a newer version's upgrade can proceed", async () => {
    const db = await loadDb();
    // Force the module to open its connection.
    await db.getAllTrackMetas();

    // Simulate a newer app version in another tab bumping the DB version.
    // This only resolves if the module's connection closes on versionchange;
    // otherwise the open stays blocked and the test times out.
    const upgraded = await rawOpen(1000);
    upgraded.close();
  });

  it("un-caches the closed connection so the next access reopens", async () => {
    const db = await loadDb();
    await db.getAllTrackMetas();

    const upgraded = await rawOpen(1000);
    upgraded.close();

    // The module must attempt a fresh open (its version is now too old,
    // so IndexedDB reports VersionError) rather than reuse the closed
    // connection (which would fail synchronously with InvalidStateError)
    // or hang forever.
    const err = await db.getAllTrackMetas().then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).name).toBe("VersionError");
  });

  it("rejects with a clear error when an older connection blocks its upgrade", async () => {
    // An "older app version" connection that ignores versionchange, so the
    // module's upgrade to the current DB version stays blocked.
    const older = await rawOpen(1, createV1Stores);

    const db = await loadDb();
    await expect(db.getAllTrackMetas()).rejects.toThrow(
      /close other Pelorus Nav tabs/,
    );

    // Once the blocker goes away, the next access succeeds (the failed
    // open cleared the cached promise, so this is a fresh attempt).
    older.close();
    await expect(db.getAllTrackMetas()).resolves.toEqual([]);
  });
});

describe("bug report outbox", () => {
  it("outboxAdd resolves with the auto-assigned key after the tx commits", async () => {
    const db = await loadDb();
    const key1 = await db.outboxAdd({ report: "first" });
    const key2 = await db.outboxAdd({ report: "second" });
    expect(key2).toBeGreaterThan(key1);
    const all = await db.outboxGetAll();
    expect(all).toEqual([
      { key: key1, record: { report: "first" } },
      { key: key2, record: { report: "second" } },
    ]);
  });
});
