import { beforeEach, describe, expect, it, vi } from "vitest";
import { type ConnectionEvent, ConnectionEventLog } from "./ConnectionEventLog";

function fakeStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> & {
  map: Map<string, string>;
} {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
}

describe("ConnectionEventLog", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("records entries in order with timestamps", () => {
    const log = new ConnectionEventLog({ storage: null });
    const before = Date.now();
    log.log("ble-nmea", "connect-request");
    log.log("ble-nmea", "connected");
    const entries = log.getEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0].type).toBe("connect-request");
    expect(entries[1].type).toBe("connected");
    expect(entries[0].t).toBeGreaterThanOrEqual(before);
    expect(entries[0].src).toBe("ble-nmea");
  });

  it("evicts the oldest entry beyond the cap", () => {
    const log = new ConnectionEventLog({ storage: null, max: 3 });
    log.log("a", "connect-request", "1");
    log.log("a", "connect-request", "2");
    log.log("a", "connect-request", "3");
    log.log("a", "connect-request", "4");
    const details = log.getEntries().map((e) => e.detail);
    expect(details).toEqual(["2", "3", "4"]);
    expect(log.entryCount).toBe(3);
  });

  it("persists to storage and a new instance reloads them", () => {
    const storage = fakeStorage();
    const log = new ConnectionEventLog({ storage });
    log.log("ble-nmea", "connected", "pod");
    const reloaded = new ConnectionEventLog({ storage });
    expect(reloaded.entryCount).toBe(1);
    expect(reloaded.getEntries()[0].detail).toBe("pod");
  });

  it("starts empty and clears the key on corrupt stored JSON", () => {
    const storage = fakeStorage();
    storage.map.set("pelorus-nav-conn-log", "not json");
    const log = new ConnectionEventLog({ storage });
    expect(log.entryCount).toBe(0);
    expect(storage.map.has("pelorus-nav-conn-log")).toBe(false);
  });

  it("rejects stored JSON with the wrong shape", () => {
    const storage = fakeStorage();
    storage.map.set("pelorus-nav-conn-log", JSON.stringify([{ bogus: 1 }]));
    const log = new ConnectionEventLog({ storage });
    expect(log.entryCount).toBe(0);
    expect(storage.map.has("pelorus-nav-conn-log")).toBe(false);
  });

  it("swallows storage setItem failures", () => {
    const storage = fakeStorage();
    storage.setItem = () => {
      throw new Error("quota");
    };
    const log = new ConnectionEventLog({ storage });
    expect(() => log.log("ble-nmea", "error", "boom")).not.toThrow();
    expect(log.entryCount).toBe(1);
  });

  it("works with no storage (in-memory only)", () => {
    const log = new ConnectionEventLog({ storage: null });
    log.log("ble-nmea", "connected");
    expect(log.entryCount).toBe(1);
  });

  it("toCSV escapes commas and quotes in detail", () => {
    const log = new ConnectionEventLog({ storage: null });
    log.log("ble-nmea", "error", 'failed, code "7"');
    const lines = log.toCSV().split("\n");
    expect(lines[0]).toBe("t_iso,t_ms,src,type,detail");
    expect(lines[1]).toContain('"failed, code ""7"""');
  });

  it("toText renders ISO time, src, type, detail", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-04T12:00:00Z"));
    const log = new ConnectionEventLog({ storage: null });
    log.log("ble-nmea", "reconnect-scheduled", "8000ms");
    expect(log.toText()).toBe(
      "2026-07-04T12:00:00.000Z ble-nmea reconnect-scheduled 8000ms",
    );
    vi.useRealTimers();
  });

  it("clear() empties memory and storage", () => {
    const storage = fakeStorage();
    const log = new ConnectionEventLog({ storage });
    log.log("ble-nmea", "connected");
    log.clear();
    expect(log.entryCount).toBe(0);
    expect(storage.map.size).toBe(0);
  });

  it("mirror callback receives each event", () => {
    const log = new ConnectionEventLog({ storage: null });
    const seen: ConnectionEvent[] = [];
    log.setMirror((e) => seen.push(e));
    log.log("ble-nmea", "bt-disabled", "at connect");
    expect(seen).toHaveLength(1);
    expect(seen[0].type).toBe("bt-disabled");
    expect(seen[0].detail).toBe("at connect");
  });

  it("truncates an over-cap stored log on load", () => {
    const storage = fakeStorage();
    const events = Array.from({ length: 10 }, (_, i) => ({
      t: i,
      src: "a",
      type: "connected",
      detail: String(i),
    }));
    storage.map.set("pelorus-nav-conn-log", JSON.stringify(events));
    const log = new ConnectionEventLog({ storage, max: 5 });
    expect(log.entryCount).toBe(5);
    expect(log.getEntries()[0].detail).toBe("5");
  });
});
