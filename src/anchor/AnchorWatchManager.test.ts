import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NavigationData } from "../navigation/NavigationData";
import type { StorageLike } from "../utils/json-storage-slot";
import {
  AnchorWatchManager,
  type AnchorWatchManagerDeps,
  type AnchorWatchSnapshot,
  warnRingRadiusM,
} from "./AnchorWatchManager";
import { ANCHOR_WATCH_STORAGE_KEY, SCATTER_MAX_POINTS } from "./anchor-state";

const T0 = 1700000000000;
const ANCHOR = { lat: 42.0, lon: -71.0 };
/** Meters per degree of latitude at haversineDistanceNM's earth radius. */
const M_PER_DEG_LAT = 111194.93;

/** A fix `meters` due north of the anchor. */
function fixAt(
  meters: number,
  timestamp: number,
  accuracy: number | null = 5,
): NavigationData {
  return {
    latitude: ANCHOR.lat + meters / M_PER_DEG_LAT,
    longitude: ANCHOR.lon,
    cog: null,
    sog: 0,
    heading: null,
    accuracy,
    timestamp,
    source: "simulator",
  };
}

function memoryStorage(): StorageLike & {
  dump(): Record<string, string>;
  writes(): number;
} {
  const map = new Map<string, string>();
  let writes = 0;
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      writes++;
      map.set(k, v);
    },
    removeItem: (k) => void map.delete(k),
    dump: () => Object.fromEntries(map),
    writes: () => writes,
  };
}

interface Harness {
  manager: AnchorWatchManager;
  storage: ReturnType<typeof memoryStorage>;
  clock: { now: number };
  nav: { lastFix: NavigationData | null; stale: boolean };
  alarm: {
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    setMuted: ReturnType<typeof vi.fn>;
  };
  gpsLossAlarm: {
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    setMuted: ReturnType<typeof vi.fn>;
  };
  /** Broadcast a fix (marks GPS fresh) and advance the clock to its time. */
  emitFix(fix: NavigationData): void;
  /** Advance the injected clock and fake timers together, 1 s steps. */
  tickSeconds(secs: number): void;
  snapshot(): AnchorWatchSnapshot;
}

function makeHarness(opts?: {
  storage?: ReturnType<typeof memoryStorage>;
}): Harness {
  const storage = opts?.storage ?? memoryStorage();
  const clock = { now: T0 };
  const nav = { lastFix: null as NavigationData | null, stale: false };
  const subscribers: Array<(d: NavigationData) => void> = [];
  const alarm = { start: vi.fn(), stop: vi.fn(), setMuted: vi.fn() };
  const gpsLossAlarm = { start: vi.fn(), stop: vi.fn(), setMuted: vi.fn() };

  const deps: AnchorWatchManagerDeps = {
    navManager: {
      getLastData: () => nav.lastFix,
      isFixStale: () => nav.stale,
      subscribe: (cb) => subscribers.push(cb),
      unsubscribe: (cb) => {
        const idx = subscribers.indexOf(cb);
        if (idx >= 0) subscribers.splice(idx, 1);
      },
    },
    alarm,
    gpsLossAlarm,
    now: () => clock.now,
    storage,
  };
  const manager = new AnchorWatchManager(deps);
  return {
    manager,
    storage,
    clock,
    nav,
    alarm,
    gpsLossAlarm,
    emitFix(fix) {
      nav.lastFix = fix;
      nav.stale = false;
      clock.now = Math.max(clock.now, fix.timestamp);
      for (const cb of [...subscribers]) cb(fix);
    },
    tickSeconds(secs) {
      for (let i = 0; i < secs; i++) {
        clock.now += 1000;
        vi.advanceTimersByTime(1000);
      }
    },
    snapshot() {
      const s = manager.getState();
      if (!s) throw new Error("expected an armed snapshot");
      return s;
    },
  };
}

/** Arm at the anchor with a fresh on-anchor fix (radius 50, warn 8 → ring 42). */
function armAtAnchor(h: Harness, radiusM = 50): void {
  h.nav.lastFix = fixAt(0, T0);
  h.manager.arm({ ...ANCHOR, radiusM });
}

/** Drive the default watch from armed to a sounding drag alarm at ~57 m. */
function driveToDragAlarm(h: Harness): void {
  h.emitFix(fixAt(55, h.clock.now));
  h.emitFix(fixAt(57, h.clock.now + 15_000));
  expect(h.snapshot().alarmKind).toBe("drag");
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("AnchorWatchManager.arm", () => {
  it("arms, seeds scatter, persists, and reports an ok zone at the anchor", () => {
    const h = makeHarness();
    const states: Array<AnchorWatchSnapshot | null> = [];
    h.manager.subscribe((s) => states.push(s));
    armAtAnchor(h);

    expect(h.manager.isArmed()).toBe(true);
    const s = h.snapshot();
    expect(s.armedAt).toBe(T0);
    expect(s.anchor).toEqual(ANCHOR);
    expect(s.radiusM).toBe(50);
    expect(s.warnM).toBe(8);
    expect(s.warnRingM).toBe(42);
    expect(s.zone).toBe("ok");
    expect(s.gpsState).toBe("ok");
    expect(s.distanceM).toBeCloseTo(0, 3);
    expect(s.alarming).toBe(false);
    expect(s.scatter).toHaveLength(1);
    expect(states).toHaveLength(1);

    const persisted = JSON.parse(h.storage.dump()[ANCHOR_WATCH_STORAGE_KEY]);
    expect(persisted.version).toBe(1);
    expect(persisted.anchor).toEqual(ANCHOR);
    expect(persisted.radiusM).toBe(50);
    expect(persisted.alarming).toBe(false);
    expect(persisted.scatter).toHaveLength(1);
  });

  it("arms without a fix: gray zone, null distance/bearing", () => {
    const h = makeHarness();
    h.nav.stale = true;
    h.manager.arm({ ...ANCHOR, radiusM: 50 });
    const s = h.snapshot();
    expect(s.zone).toBe("gray");
    // Armed before any fix arrived: waiting, not stale — see AnchorGpsState.
    expect(s.gpsState).toBe("waiting");
    expect(s.distanceM).toBeNull();
    expect(s.bearingDeg).toBeNull();
  });

  it("re-arming replaces the watch and stops a sounding alarm", () => {
    const h = makeHarness();
    armAtAnchor(h);
    driveToDragAlarm(h);
    h.clock.now += 60_000;
    h.manager.arm({ ...ANCHOR, radiusM: 80 });
    expect(h.alarm.stop).toHaveBeenCalled();
    const s = h.snapshot();
    expect(s.armedAt).toBe(h.clock.now);
    expect(s.radiusM).toBe(80);
    expect(s.alarming).toBe(false);
    expect(s.scatter.length).toBeLessThanOrEqual(1);
  });
});

describe("AnchorWatchManager.disarm", () => {
  it("clears the slot, stops the poll, and notifies null", () => {
    const h = makeHarness();
    armAtAnchor(h);
    driveToDragAlarm(h);
    const states: Array<AnchorWatchSnapshot | null> = [];
    h.manager.subscribe((s) => states.push(s));

    h.manager.disarm();
    expect(h.manager.isArmed()).toBe(false);
    expect(h.manager.getState()).toBeNull();
    expect(h.alarm.stop).toHaveBeenCalled();
    expect(h.storage.dump()[ANCHOR_WATCH_STORAGE_KEY]).toBeUndefined();
    expect(states).toEqual([null]);

    // Detached from the fix stream: later fixes change nothing.
    h.emitFix(fixAt(500, h.clock.now + 1000));
    expect(h.manager.getState()).toBeNull();
  });
});

describe("zone transitions", () => {
  it("moves ok → warn → outside with distance", () => {
    const h = makeHarness();
    armAtAnchor(h);
    h.emitFix(fixAt(10, T0 + 1000));
    expect(h.snapshot().zone).toBe("ok");
    h.emitFix(fixAt(45, T0 + 2000));
    expect(h.snapshot().zone).toBe("warn");
    h.emitFix(fixAt(55, T0 + 3000));
    expect(h.snapshot().zone).toBe("outside");
    expect(h.snapshot().alarming).toBe(false); // delay not yet elapsed
  });

  it("clamps the warning ring on small radii so it never inverts", () => {
    expect(warnRingRadiusM(50, 8)).toBe(42);
    expect(warnRingRadiusM(10, 8)).toBe(5);
    const h = makeHarness();
    h.nav.lastFix = fixAt(0, T0);
    h.manager.arm({ ...ANCHOR, radiusM: 10 });
    h.emitFix(fixAt(4, T0 + 1000));
    expect(h.snapshot().zone).toBe("ok");
    h.emitFix(fixAt(6, T0 + 2000));
    expect(h.snapshot().zone).toBe("warn");
  });

  it("goes gray on poor accuracy", () => {
    const h = makeHarness();
    armAtAnchor(h);
    h.emitFix(fixAt(10, T0 + 1000, 60));
    const s = h.snapshot();
    expect(s.zone).toBe("gray");
    expect(s.gpsState).toBe("poor");
    expect(s.distanceM).toBeCloseTo(10, 1);
  });

  it("reports bearing from the vessel back to the anchor", () => {
    const h = makeHarness();
    armAtAnchor(h);
    h.emitFix(fixAt(30, T0 + 1000)); // vessel north of anchor
    expect(h.snapshot().bearingDeg).toBeCloseTo(180, 0);
  });
});

describe("drag alarm hysteresis", () => {
  it("fires only after the full delay outside, using fix timestamps", () => {
    const h = makeHarness();
    armAtAnchor(h);
    h.emitFix(fixAt(55, T0 + 1000));
    h.emitFix(fixAt(56, T0 + 14_000));
    expect(h.alarm.start).not.toHaveBeenCalled();

    h.emitFix(fixAt(57, T0 + 16_000));
    expect(h.alarm.start).toHaveBeenCalledWith(false);
    const s = h.snapshot();
    expect(s.alarming).toBe(true);
    expect(s.alarmKind).toBe("drag");
    expect(
      JSON.parse(h.storage.dump()[ANCHOR_WATCH_STORAGE_KEY]).alarming,
    ).toBe(true);
  });

  it("re-entry during the delay cancels and restarts the excursion timer", () => {
    const h = makeHarness();
    armAtAnchor(h);
    h.emitFix(fixAt(55, T0 + 1000));
    h.emitFix(fixAt(30, T0 + 10_000)); // back inside
    h.emitFix(fixAt(55, T0 + 20_000)); // new excursion
    h.emitFix(fixAt(56, T0 + 34_000)); // 14 s into it
    expect(h.alarm.start).not.toHaveBeenCalled();
    h.emitFix(fixAt(57, T0 + 35_000)); // 15 s
    expect(h.alarm.start).toHaveBeenCalledTimes(1);
  });
});

describe("acknowledge semantics", () => {
  it("silences the alarm but keeps the watch armed", () => {
    const h = makeHarness();
    armAtAnchor(h);
    driveToDragAlarm(h);
    h.manager.acknowledge();
    expect(h.alarm.stop).toHaveBeenCalled();
    const s = h.snapshot();
    expect(s.alarming).toBe(false);
    expect(s.acknowledged).toBe(true);
    expect(s.zone).toBe("outside");
    expect(h.manager.isArmed()).toBe(true);
  });

  it("re-alarms when the boat drags a further warnM beyond the ack distance", () => {
    const h = makeHarness();
    armAtAnchor(h);
    driveToDragAlarm(h); // ~57 m out
    h.manager.acknowledge();

    h.emitFix(fixAt(64, h.clock.now + 1000)); // < 57 + 8
    expect(h.alarm.start).toHaveBeenCalledTimes(1);
    h.emitFix(fixAt(66, h.clock.now + 2000)); // ≥ 57 + 8
    expect(h.alarm.start).toHaveBeenCalledTimes(2);
    expect(h.snapshot().alarming).toBe(true);
  });

  it("re-alarms after re-entry and a fresh exit past the delay", () => {
    const h = makeHarness();
    armAtAnchor(h);
    driveToDragAlarm(h);
    h.manager.acknowledge();

    h.emitFix(fixAt(20, h.clock.now + 1000)); // back inside — event over
    expect(h.snapshot().acknowledged).toBe(false);

    const t1 = h.clock.now + 10_000;
    h.emitFix(fixAt(55, t1));
    h.emitFix(fixAt(56, t1 + 15_000));
    expect(h.alarm.start).toHaveBeenCalledTimes(2);
  });
});

describe("GPS-loss alarm", () => {
  it("fires the distinct alarm on sustained staleness and clears on fresh data", () => {
    const h = makeHarness();
    armAtAnchor(h);
    h.nav.stale = true;
    h.tickSeconds(120);
    expect(h.gpsLossAlarm.start).not.toHaveBeenCalled();
    expect(h.snapshot().gpsState).toBe("stale");

    h.tickSeconds(2);
    expect(h.gpsLossAlarm.start).toHaveBeenCalledWith(false);
    const s = h.snapshot();
    expect(s.alarmKind).toBe("gps-loss");
    expect(s.gpsState).toBe("lost");
    expect(s.zone).toBe("gray");

    h.emitFix(fixAt(5, h.clock.now));
    expect(h.gpsLossAlarm.stop).toHaveBeenCalled();
    expect(h.snapshot().gpsState).toBe("ok");
    expect(h.snapshot().alarming).toBe(false);
  });

  it("never alarms before the first fix — waiting is not lost", () => {
    // A cold external GPS (or one that never acquires) leaves the watch
    // armed but blind from the start. That is the user's own doing and is
    // shown persistently; it must not wake anyone.
    const h = makeHarness();
    h.nav.stale = true;
    armAtAnchor(h);
    h.tickSeconds(600);
    expect(h.gpsLossAlarm.start).not.toHaveBeenCalled();
    expect(h.snapshot().gpsState).toBe("waiting");
    expect(h.snapshot().alarming).toBe(false);
  });

  it("alarms once a fix has arrived and is then lost", () => {
    const h = makeHarness();
    h.nav.stale = true;
    armAtAnchor(h);
    h.tickSeconds(300);
    expect(h.gpsLossAlarm.start).not.toHaveBeenCalled();

    // First acquisition proves the watch works…
    h.nav.stale = false;
    h.emitFix(fixAt(0, h.clock.now));
    expect(h.snapshot().gpsState).toBe("ok");

    // …so a later outage is a genuine loss.
    h.nav.stale = true;
    h.tickSeconds(122);
    expect(h.gpsLossAlarm.start).toHaveBeenCalledWith(false);
    expect(h.snapshot().gpsState).toBe("lost");
  });

  it("acknowledge silences it; continued staleness does not re-fire", () => {
    const h = makeHarness();
    armAtAnchor(h);
    h.nav.stale = true;
    h.tickSeconds(122);
    expect(h.gpsLossAlarm.start).toHaveBeenCalledTimes(1);

    h.manager.acknowledge();
    expect(h.gpsLossAlarm.stop).toHaveBeenCalled();
    expect(h.snapshot().acknowledged).toBe(true);

    h.tickSeconds(300);
    expect(h.gpsLossAlarm.start).toHaveBeenCalledTimes(1);
  });

  it("does not run the staleness poll after disarm", () => {
    const h = makeHarness();
    armAtAnchor(h);
    h.manager.disarm();
    h.nav.stale = true;
    h.tickSeconds(300);
    expect(h.gpsLossAlarm.start).not.toHaveBeenCalled();
  });
});

describe("swing scatter", () => {
  it("samples at most once per 10 s of fix time", () => {
    const h = makeHarness();
    armAtAnchor(h);
    for (let s = 1; s <= 30; s++) {
      h.emitFix(fixAt(5, T0 + s * 1000));
    }
    // Seed sample at T0 plus samples at +10 s, +20 s, +30 s.
    expect(h.snapshot().scatter).toHaveLength(4);
  });

  it("caps the buffer at SCATTER_MAX_POINTS, dropping the oldest", () => {
    const h = makeHarness();
    armAtAnchor(h);
    for (let i = 1; i <= 800; i++) {
      h.emitFix(fixAt(5, T0 + i * 10_000));
    }
    const scatter = h.snapshot().scatter;
    expect(scatter).toHaveLength(SCATTER_MAX_POINTS);
    // 801 samples taken (seed + 800); the first 81 fell off the front.
    expect(scatter[0].t).toBe(T0 + 81 * 10_000);
  });

  it("throttles scatter-only slot writes to once per 60 s", () => {
    const h = makeHarness();
    armAtAnchor(h);
    const writesAfterArm = h.storage.writes();
    for (let s = 10; s <= 50; s += 10) {
      h.emitFix(fixAt(5, T0 + s * 1000));
    }
    expect(h.storage.writes()).toBe(writesAfterArm);
    h.emitFix(fixAt(5, T0 + 60_000));
    expect(h.storage.writes()).toBe(writesAfterArm + 1);
  });
});

describe("mute", () => {
  it("persists, forwards to both alarms, and applies to later alarm starts", () => {
    const h = makeHarness();
    armAtAnchor(h);
    h.manager.setMuted(true);
    expect(h.alarm.setMuted).toHaveBeenCalledWith(true);
    expect(h.gpsLossAlarm.setMuted).toHaveBeenCalledWith(true);
    expect(JSON.parse(h.storage.dump()[ANCHOR_WATCH_STORAGE_KEY]).muted).toBe(
      true,
    );

    h.emitFix(fixAt(55, T0 + 1000));
    h.emitFix(fixAt(57, T0 + 16_000));
    expect(h.alarm.start).toHaveBeenCalledWith(true);
  });
});

describe("anchor and radius updates", () => {
  it("moving the anchor under the vessel ends an active alarm", () => {
    const h = makeHarness();
    armAtAnchor(h);
    driveToDragAlarm(h);
    const fix = h.nav.lastFix;
    if (!fix) throw new Error("expected a fix");
    h.manager.updateAnchor(fix.latitude, fix.longitude);
    expect(h.alarm.stop).toHaveBeenCalled();
    const s = h.snapshot();
    expect(s.zone).toBe("ok");
    expect(s.alarming).toBe(false);
    expect(s.anchor.lat).toBeCloseTo(fix.latitude, 10);
  });

  it("shrinking the radius restarts the excursion delay before alarming", () => {
    const h = makeHarness();
    armAtAnchor(h);
    h.emitFix(fixAt(45, T0 + 1000)); // warn zone
    h.manager.updateRadius(40);
    expect(h.snapshot().zone).toBe("outside");
    expect(h.alarm.start).not.toHaveBeenCalled();
    h.emitFix(fixAt(45, T0 + 16_000)); // 15 s after the fix that seeded the timer
    expect(h.alarm.start).toHaveBeenCalledTimes(1);
  });

  it("ignores invalid values and does nothing while disarmed", () => {
    const h = makeHarness();
    h.manager.updateAnchor(1, 2);
    h.manager.updateRadius(30);
    expect(h.manager.getState()).toBeNull();
    armAtAnchor(h);
    h.manager.updateRadius(0);
    h.manager.updateRadius(Number.NaN);
    expect(h.snapshot().radiusM).toBe(50);
  });
});

describe("AnchorWatchManager.restore", () => {
  it("re-arms from the slot with params and scatter intact", () => {
    const first = makeHarness();
    armAtAnchor(first);
    first.emitFix(fixAt(20, T0 + 10_000));
    first.emitFix(fixAt(20, T0 + 70_000)); // crosses the 60 s persist throttle

    const second = makeHarness({ storage: first.storage });
    second.nav.lastFix = fixAt(20, T0 + 90_000);
    second.manager.restore();

    expect(second.manager.isArmed()).toBe(true);
    const s = second.snapshot();
    expect(s.armedAt).toBe(T0);
    expect(s.anchor).toEqual(ANCHOR);
    expect(s.radiusM).toBe(50);
    expect(s.scatter).toHaveLength(3);
    expect(s.zone).toBe("ok");
    expect(second.alarm.start).not.toHaveBeenCalled();

    // The restored watch is live: it reacts to new fixes.
    second.emitFix(fixAt(45, T0 + 91_000));
    expect(second.snapshot().zone).toBe("warn");
  });

  it("resumes a mid-alarm watch, respecting mute", () => {
    const first = makeHarness();
    armAtAnchor(first);
    first.manager.setMuted(true);
    first.emitFix(fixAt(55, T0 + 1000));
    first.emitFix(fixAt(57, T0 + 16_000));
    expect(first.snapshot().alarming).toBe(true);

    const second = makeHarness({ storage: first.storage });
    second.manager.restore();
    expect(second.alarm.start).toHaveBeenCalledWith(true);
    const s = second.snapshot();
    expect(s.alarming).toBe(true);
    expect(s.alarmKind).toBe("drag");
    expect(s.muted).toBe(true);
  });

  it("stops a resumed alarm when the vessel is back inside", () => {
    const first = makeHarness();
    armAtAnchor(first);
    driveToDragAlarm(first);

    const second = makeHarness({ storage: first.storage });
    second.manager.restore();
    second.emitFix(fixAt(10, second.clock.now + 1000));
    expect(second.alarm.stop).toHaveBeenCalled();
    expect(second.snapshot().alarming).toBe(false);
  });

  it("clamps an oversized persisted scatter buffer", () => {
    const h = makeHarness();
    const scatter = Array.from({ length: 725 }, (_, i) => ({
      lat: ANCHOR.lat,
      lon: ANCHOR.lon,
      t: T0 + i * 10_000,
    }));
    h.storage.setItem(
      ANCHOR_WATCH_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        armedAt: T0,
        anchor: ANCHOR,
        radiusM: 50,
        warnM: 8,
        muted: false,
        alarming: false,
        scatter,
      }),
    );
    h.manager.restore();
    expect(h.snapshot().scatter).toHaveLength(SCATTER_MAX_POINTS);
  });

  it("ignores corrupt or old-format slots and clears them", () => {
    const corrupt = makeHarness();
    corrupt.storage.setItem(ANCHOR_WATCH_STORAGE_KEY, "{not json");
    corrupt.manager.restore();
    expect(corrupt.manager.isArmed()).toBe(false);
    expect(corrupt.storage.dump()[ANCHOR_WATCH_STORAGE_KEY]).toBeUndefined();

    const oldFormat = makeHarness();
    oldFormat.storage.setItem(
      ANCHOR_WATCH_STORAGE_KEY,
      JSON.stringify({ version: 0, anchorLat: 42, anchorLon: -71 }),
    );
    oldFormat.manager.restore();
    expect(oldFormat.manager.isArmed()).toBe(false);
    expect(oldFormat.storage.dump()[ANCHOR_WATCH_STORAGE_KEY]).toBeUndefined();
    expect(oldFormat.alarm.start).not.toHaveBeenCalled();
  });

  it("is a no-op with an empty slot", () => {
    const h = makeHarness();
    h.manager.restore();
    expect(h.manager.isArmed()).toBe(false);
    expect(h.alarm.start).not.toHaveBeenCalled();
  });
});
