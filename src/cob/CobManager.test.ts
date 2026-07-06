import { describe, expect, it, vi } from "vitest";
import type { StandaloneWaypoint } from "../data/Waypoint";
import type { ActiveNavigationState } from "../navigation/ActiveNavigation";
import type { NavigationData } from "../navigation/NavigationData";
import type { StorageLike } from "../utils/json-storage-slot";
import { CobManager, type CobManagerDeps } from "./CobManager";
import { COB_STORAGE_KEY } from "./cob-state";

const FIX: NavigationData = {
  latitude: 42.3635,
  longitude: -71.0479,
  cog: 90,
  sog: 5,
  heading: null,
  accuracy: 5,
  timestamp: 1700000000000,
  source: "simulator",
};

function memoryStorage(): StorageLike & { dump(): Record<string, string> } {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    dump: () => Object.fromEntries(map),
  };
}

interface Harness {
  manager: CobManager;
  deps: CobManagerDeps;
  storage: ReturnType<typeof memoryStorage>;
  savedWaypoints: StandaloneWaypoint[];
  updatedWaypoints: StandaloneWaypoint[];
  navState: { value: ActiveNavigationState };
  alarm: {
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    setMuted: ReturnType<typeof vi.fn>;
  };
  ensureRecording: ReturnType<typeof vi.fn>;
  emergencyChange: ReturnType<typeof vi.fn>;
  clock: { now: number };
}

function makeHarness(opts?: {
  fix?: NavigationData | null;
  stale?: boolean;
  storage?: ReturnType<typeof memoryStorage>;
}): Harness {
  const storage = opts?.storage ?? memoryStorage();
  const savedWaypoints: StandaloneWaypoint[] = [];
  const updatedWaypoints: StandaloneWaypoint[] = [];
  const navState: { value: ActiveNavigationState } = {
    value: { type: "idle" },
  };
  const alarm = { start: vi.fn(), stop: vi.fn(), setMuted: vi.fn() };
  const ensureRecording = vi.fn();
  const emergencyChange = vi.fn();
  const clock = { now: 1700000005000 };

  const deps: CobManagerDeps = {
    navManager: {
      getLastData: () => (opts?.fix === undefined ? FIX : opts.fix),
      isFixStale: () => opts?.stale ?? false,
      getFixAgeMs: () => (opts?.stale ? 12000 : 500),
    },
    activeNav: {
      startGoto: vi.fn((wp) => {
        navState.value = { type: "goto", waypoint: wp };
      }),
      stop: vi.fn(() => {
        navState.value = { type: "idle" };
      }),
      getState: () => navState.value,
    },
    saveWaypoint: vi.fn(async (wp: StandaloneWaypoint) => {
      savedWaypoints.push(wp);
    }),
    updateWaypoint: vi.fn(async (wp: StandaloneWaypoint) => {
      updatedWaypoints.push(wp);
    }),
    getWaypointById: async (id) =>
      savedWaypoints.find((w) => w.id === id) ?? null,
    alarm,
    onEnsureRecording: ensureRecording,
    onEmergencyChange: emergencyChange,
    now: () => clock.now,
    storage,
  };
  return {
    manager: new CobManager(deps),
    deps,
    storage,
    savedWaypoints,
    updatedWaypoints,
    navState,
    alarm,
    ensureRecording,
    emergencyChange,
    clock,
  };
}

describe("CobManager.activate", () => {
  it("drops a cob waypoint, starts goto, persists, and fires side effects", () => {
    const h = makeHarness();
    const states: unknown[] = [];
    h.manager.subscribe((s) => states.push(s));

    expect(h.manager.activate()).toBe("ok");
    expect(h.manager.isActive()).toBe(true);

    const wp = h.savedWaypoints[0];
    expect(wp.icon).toBe("cob");
    expect(wp.lat).toBe(FIX.latitude);
    expect(wp.lon).toBe(FIX.longitude);
    expect(wp.name).toMatch(/^COB \d\d:\d\d:\d\d$/);

    expect(h.deps.activeNav.startGoto).toHaveBeenCalledWith(wp);
    expect(h.alarm.start).toHaveBeenCalledWith(false);
    expect(h.ensureRecording).toHaveBeenCalled();
    expect(h.emergencyChange).toHaveBeenCalledWith(true);
    expect(states).toHaveLength(1);

    const persisted = JSON.parse(h.storage.dump()[COB_STORAGE_KEY]);
    expect(persisted.waypointId).toBe(wp.id);
    expect(persisted.staleAtDrop).toBe(false);
    expect(h.manager.isCobNavigation()).toBe(true);
    expect(h.manager.isCobWaypoint(wp.id)).toBe(true);
  });

  it("returns no-fix and stays idle without any fix", () => {
    const h = makeHarness({ fix: null });
    expect(h.manager.activate()).toBe("no-fix");
    expect(h.manager.isActive()).toBe(false);
    expect(h.savedWaypoints).toHaveLength(0);
    expect(h.storage.dump()[COB_STORAGE_KEY]).toBeUndefined();
    expect(h.alarm.start).not.toHaveBeenCalled();
  });

  it("flags a stale fix but still activates at last known position", () => {
    const h = makeHarness({ stale: true });
    expect(h.manager.activate()).toBe("ok-stale");
    const state = h.manager.getState();
    expect(state?.staleAtDrop).toBe(true);
    expect(state?.fixAgeAtDropMs).toBe(12000);
    expect(h.savedWaypoints[0].lat).toBe(FIX.latitude);
  });

  it("never double-fires while already active", () => {
    const h = makeHarness();
    h.manager.activate();
    expect(h.manager.activate()).toBe("ok");
    expect(h.savedWaypoints).toHaveLength(1);
  });
});

describe("CobManager.setMuted", () => {
  it("persists the mute flag and forwards to the alarm", () => {
    const h = makeHarness();
    h.manager.activate();
    h.manager.setMuted(true);
    expect(h.alarm.setMuted).toHaveBeenCalledWith(true);
    expect(JSON.parse(h.storage.dump()[COB_STORAGE_KEY]).muted).toBe(true);
  });
});

describe("CobManager.resolve", () => {
  it("stops alarm and cob goto, keeps + annotates the waypoint, clears the slot", async () => {
    const h = makeHarness();
    h.manager.activate();
    h.clock.now += 15 * 60_000;
    await h.manager.resolve();

    expect(h.manager.isActive()).toBe(false);
    expect(h.alarm.stop).toHaveBeenCalled();
    expect(h.deps.activeNav.stop).toHaveBeenCalled();
    expect(h.emergencyChange).toHaveBeenLastCalledWith(false);
    expect(h.storage.dump()[COB_STORAGE_KEY]).toBeUndefined();
    expect(h.updatedWaypoints[0].notes).toMatch(/Crew overboard .* resolved/);
  });

  it("leaves navigation alone when the user retargeted elsewhere", async () => {
    const h = makeHarness();
    h.manager.activate();
    const other: StandaloneWaypoint = {
      ...h.savedWaypoints[0],
      id: "other-wp",
      name: "Elsewhere",
    };
    h.navState.value = { type: "goto", waypoint: other };
    expect(h.manager.isCobNavigation()).toBe(false);

    await h.manager.resolve();
    expect(h.deps.activeNav.stop).not.toHaveBeenCalled();
  });

  it("renavigate re-engages goto to the cob point", () => {
    const h = makeHarness();
    h.manager.activate();
    h.navState.value = { type: "idle" };
    h.manager.renavigate();
    expect(h.deps.activeNav.startGoto).toHaveBeenLastCalledWith(
      h.savedWaypoints[0],
    );
  });
});

describe("CobManager.noteWaypointDeleted", () => {
  it("ends the event when the cob waypoint is deleted", () => {
    const h = makeHarness();
    h.manager.activate();
    h.manager.noteWaypointDeleted(h.savedWaypoints[0].id);
    expect(h.manager.isActive()).toBe(false);
    expect(h.alarm.stop).toHaveBeenCalled();
    expect(h.storage.dump()[COB_STORAGE_KEY]).toBeUndefined();
    expect(h.updatedWaypoints).toHaveLength(0); // no annotation on delete
  });

  it("ignores deletion of unrelated waypoints", () => {
    const h = makeHarness();
    h.manager.activate();
    h.manager.noteWaypointDeleted("some-other-id");
    expect(h.manager.isActive()).toBe(true);
  });
});

describe("CobManager.restore", () => {
  it("restores the event and re-engages goto when nav is idle", async () => {
    const first = makeHarness();
    first.manager.activate();
    first.manager.setMuted(true);

    // Fresh manager over the same storage — nav restored idle.
    const second = makeHarness({ storage: first.storage });
    second.savedWaypoints.push(...first.savedWaypoints);
    await second.manager.restore();

    expect(second.manager.isActive()).toBe(true);
    expect(second.manager.getState()?.startedAt).toBe(1700000005000);
    expect(second.deps.activeNav.startGoto).toHaveBeenCalled();
    expect(second.alarm.start).toHaveBeenCalledWith(true); // mute survives
    expect(second.emergencyChange).toHaveBeenCalledWith(true);
  });

  it("does not double-goto when activeNav already restored the same goto", async () => {
    const first = makeHarness();
    first.manager.activate();

    const second = makeHarness({ storage: first.storage });
    second.savedWaypoints.push(...first.savedWaypoints);
    second.navState.value = {
      type: "goto",
      waypoint: first.savedWaypoints[0],
    };
    await second.manager.restore();

    expect(second.manager.isActive()).toBe(true);
    expect(second.deps.activeNav.startGoto).not.toHaveBeenCalled();
    expect(second.manager.isCobNavigation()).toBe(true);
  });

  it("clears the slot when the waypoint is missing", async () => {
    const first = makeHarness();
    first.manager.activate();

    const second = makeHarness({ storage: first.storage });
    // savedWaypoints left empty — waypoint not found
    await second.manager.restore();

    expect(second.manager.isActive()).toBe(false);
    expect(first.storage.dump()[COB_STORAGE_KEY]).toBeUndefined();
    expect(second.alarm.start).not.toHaveBeenCalled();
  });

  it("is a no-op with no persisted event", async () => {
    const h = makeHarness();
    await h.manager.restore();
    expect(h.manager.isActive()).toBe(false);
    expect(h.emergencyChange).not.toHaveBeenCalled();
  });
});
