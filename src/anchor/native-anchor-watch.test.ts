import { describe, expect, it, vi } from "vitest";
import type { NavigationData } from "../navigation/NavigationData";
import type { AnchorWatchNativeStatus } from "../plugins/BackgroundGPS";
import type { AnchorWatchSnapshot } from "./AnchorWatchManager";
import {
  assessScreenOffCover,
  connectNativeAnchorWatch,
  getNativeAnchorStatus,
  type NativeAnchorAlarm,
  type NativeAnchorManager,
  type NativeAnchorPlugin,
  SCREEN_OFF_COVER_GRACE_MS,
  SCREEN_OFF_COVER_TEXT,
  screenOffCoverLine,
} from "./native-anchor-watch";

const ANCHOR = { lat: 42, lon: -71 };

function snapshot(
  over: Partial<AnchorWatchSnapshot> = {},
): AnchorWatchSnapshot {
  return {
    armedAt: 0,
    anchor: { ...ANCHOR },
    radiusM: 50,
    warnM: 8,
    warnRingM: 42,
    zone: "ok",
    alarming: false,
    alarmKind: null,
    acknowledged: false,
    alarmInS: null,
    muted: false,
    distanceM: 0,
    bearingDeg: null,
    gpsState: "ok",
    scatter: [],
    ...over,
  };
}

/** A native status describing a watch that is fully covered. */
function status(
  over: Partial<AnchorWatchNativeStatus> = {},
): AnchorWatchNativeStatus {
  return {
    serviceRunning: true,
    armedNatively: true,
    hadFix: true,
    lastFixAgeMs: 4_000,
    armedMs: 600_000,
    wakeLockHeld: true,
    locationPermission: true,
    ...over,
  };
}

/** A CobAlarm stand-in whose blocked state the test drives. */
function fakeAlarm(blocked = false) {
  const listeners: Array<(blocked: boolean) => void> = [];
  return {
    isBlocked: () => blocked,
    onBlockedChange: (cb: (blocked: boolean) => void) => {
      listeners.push(cb);
    },
    /** Simulate the audio unlock (or loss) CobAlarm reports. */
    setBlocked(next: boolean) {
      blocked = next;
      for (const cb of listeners) cb(next);
    },
  };
}

function makeHarness() {
  const plugin = {
    setAnchorWatch: vi.fn().mockResolvedValue(undefined),
    clearAnchorWatch: vi.fn().mockResolvedValue(undefined),
    acknowledgeAnchorAlarm: vi.fn().mockResolvedValue(undefined),
    handOffAnchorAlarm: vi.fn().mockResolvedValue(undefined),
    noteExternalFix: vi.fn().mockResolvedValue(undefined),
    getAnchorWatchStatus: vi.fn().mockResolvedValue(status()),
    addListener: vi.fn().mockResolvedValue(undefined),
  } satisfies NativeAnchorPlugin;
  let emit: (snap: AnchorWatchSnapshot | null) => void = () => {};
  let state: AnchorWatchSnapshot | null = null;
  const manager: NativeAnchorManager = {
    subscribe: (cb) => {
      emit = cb;
    },
    getState: () => state,
    noteNativeAlarm: vi.fn(),
  };
  let emitFix: (fix: NavigationData) => void = () => {};
  const navManager = {
    subscribe: (cb: (fix: NavigationData) => void) => {
      emitFix = cb;
    },
  };
  return {
    plugin,
    manager,
    navManager,
    emit: (snap: AnchorWatchSnapshot | null) => {
      state = snap;
      emit(snap);
    },
    /** Manager state that never reached a subscriber — the restore case. */
    setState: (snap: AnchorWatchSnapshot | null) => {
      state = snap;
    },
    emitFix: () => emitFix({} as NavigationData),
    /** The anchorAlarm handler the module registered. */
    fireAlarm(kind: "drag" | "gps-loss") {
      const handler = plugin.addListener.mock.calls[0][1] as (d: {
        kind: "drag" | "gps-loss";
        distanceM: number;
        at: number;
      }) => void;
      handler({ kind, distanceM: 61, at: 1000 });
    },
  };
}

function connect(
  h: ReturnType<typeof makeHarness>,
  over: {
    alarms?: readonly NativeAnchorAlarm[];
    isForeground?: () => boolean;
    now?: () => number;
    navManager?: { subscribe: (cb: (fix: NavigationData) => void) => void };
  } = {},
) {
  return connectNativeAnchorWatch(h.manager, {
    plugin: h.plugin,
    isNative: true,
    ...over,
  });
}

describe("connectNativeAnchorWatch", () => {
  it("does nothing on web", () => {
    const h = makeHarness();
    connectNativeAnchorWatch(h.manager, { plugin: h.plugin, isNative: false });
    h.emit(snapshot());
    expect(h.plugin.setAnchorWatch).not.toHaveBeenCalled();
    expect(h.plugin.addListener).not.toHaveBeenCalled();
  });

  it("pushes the armed geometry with the JS timing constants", () => {
    const h = makeHarness();
    connect(h);
    h.emit(snapshot());
    expect(h.plugin.setAnchorWatch).toHaveBeenCalledWith({
      lat: 42,
      lon: -71,
      radiusM: 50,
      alarmDelayS: 15,
      gpsLossAlarmS: 120,
      warnM: 8,
    });
  });

  it("re-pushes on anchor move or radius change, not on unrelated updates", () => {
    const h = makeHarness();
    connect(h);
    h.emit(snapshot());
    h.emit(snapshot({ zone: "warn", distanceM: 45 }));
    expect(h.plugin.setAnchorWatch).toHaveBeenCalledTimes(1);

    h.emit(snapshot({ radiusM: 70 }));
    expect(h.plugin.setAnchorWatch).toHaveBeenCalledTimes(2);
    h.emit(snapshot({ radiusM: 70, anchor: { lat: 42.001, lon: -71 } }));
    expect(h.plugin.setAnchorWatch).toHaveBeenCalledTimes(3);
  });

  it("clears on disarm, once", () => {
    const h = makeHarness();
    connect(h);
    h.emit(snapshot());
    h.emit(null);
    h.emit(null);
    expect(h.plugin.clearAnchorWatch).toHaveBeenCalledTimes(1);
  });

  it("forwards an in-app acknowledgment, on the edge only", () => {
    const h = makeHarness();
    connect(h);
    h.emit(snapshot({ alarming: true, alarmKind: "drag" }));
    expect(h.plugin.acknowledgeAnchorAlarm).not.toHaveBeenCalled();

    h.emit(snapshot({ acknowledged: true }));
    h.emit(snapshot({ acknowledged: true, zone: "outside" }));
    expect(h.plugin.acknowledgeAnchorAlarm).toHaveBeenCalledTimes(1);
  });

  it("reconciles a native alarm into the manager", () => {
    const h = makeHarness();
    connect(h);
    h.fireAlarm("gps-loss");
    expect(h.manager.noteNativeAlarm).toHaveBeenCalledWith("gps-loss");
  });

  it("survives a native shell without the anchor methods", async () => {
    const h = makeHarness();
    h.plugin.setAnchorWatch.mockRejectedValue(new Error("not implemented"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    connect(h);
    expect(() => h.emit(snapshot())).not.toThrow();
    await Promise.resolve();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  describe("alarm handoff", () => {
    const alarming = () => snapshot({ alarming: true, alarmKind: "drag" });

    it("hands off once when the JS alarm is audible", () => {
      const h = makeHarness();
      connect(h, { alarms: [fakeAlarm(false)], isForeground: () => true });
      h.emit(alarming());
      h.emit(alarming());
      expect(h.plugin.handOffAnchorAlarm).toHaveBeenCalledTimes(1);
    });

    it("does not hand off while the JS alarm is blocked", () => {
      const h = makeHarness();
      connect(h, { alarms: [fakeAlarm(true)], isForeground: () => true });
      h.emit(alarming());
      expect(h.plugin.handOffAnchorAlarm).not.toHaveBeenCalled();
    });

    it("hands off on the blocked→unblocked edge (the user tapped)", () => {
      const h = makeHarness();
      const alarm = fakeAlarm(true);
      connect(h, { alarms: [alarm], isForeground: () => true });
      h.emit(alarming());
      expect(h.plugin.handOffAnchorAlarm).not.toHaveBeenCalled();

      alarm.setBlocked(false);
      expect(h.plugin.handOffAnchorAlarm).toHaveBeenCalledTimes(1);
    });

    it("never hands off in the background, however good the audio", () => {
      const h = makeHarness();
      connect(h, { alarms: [fakeAlarm(false)], isForeground: () => false });
      h.emit(alarming());
      expect(h.plugin.handOffAnchorAlarm).not.toHaveBeenCalled();
    });

    it("never hands off with no JS alarm wired up", () => {
      const h = makeHarness();
      connect(h, { isForeground: () => true });
      h.emit(alarming());
      expect(h.plugin.handOffAnchorAlarm).not.toHaveBeenCalled();
    });

    it("hands off again for the next alarm event", () => {
      const h = makeHarness();
      connect(h, { alarms: [fakeAlarm(false)], isForeground: () => true });
      h.emit(alarming());
      h.emit(snapshot()); // alarm cleared, still armed
      h.emit(alarming());
      expect(h.plugin.handOffAnchorAlarm).toHaveBeenCalledTimes(2);
    });

    it("does not hand off when only one of two alarms is audible", () => {
      const h = makeHarness();
      connect(h, {
        alarms: [fakeAlarm(false), fakeAlarm(true)],
        isForeground: () => true,
      });
      h.emit(alarming());
      expect(h.plugin.handOffAnchorAlarm).not.toHaveBeenCalled();
    });
  });

  describe("reconcile", () => {
    it("stands down a native watch this side has no record of", () => {
      const h = makeHarness();
      const handle = connect(h);
      // Nothing restored: the JS watch is disarmed, so a native watch that
      // survived a process kill has to end — it would otherwise alarm for a
      // watch the user can no longer see or disarm.
      handle.reconcile();
      expect(h.plugin.clearAnchorWatch).toHaveBeenCalledTimes(1);
      // Idempotent: a second pass has nothing left to clear.
      handle.reconcile();
      expect(h.plugin.clearAnchorWatch).toHaveBeenCalledTimes(1);
    });

    it("re-pushes a restored watch that never notified", () => {
      const h = makeHarness();
      const handle = connect(h);
      h.setState(snapshot());
      handle.reconcile();
      expect(h.plugin.setAnchorWatch).toHaveBeenCalledTimes(1);
      expect(h.plugin.clearAnchorWatch).not.toHaveBeenCalled();
    });

    it("does not re-push a watch restore already pushed down", () => {
      const h = makeHarness();
      const handle = connect(h);
      h.emit(snapshot());
      handle.reconcile();
      expect(h.plugin.setAnchorWatch).toHaveBeenCalledTimes(1);
      expect(h.plugin.clearAnchorWatch).not.toHaveBeenCalled();
    });

    it("still clears once when a watch was armed and then disarmed", () => {
      const h = makeHarness();
      const handle = connect(h);
      h.emit(snapshot());
      h.emit(null);
      handle.reconcile();
      expect(h.plugin.clearAnchorWatch).toHaveBeenCalledTimes(1);
    });
  });

  describe("screen-off cover", () => {
    it("says nothing when the native side cannot answer", () => {
      // Web, or a native shell without the status method: an unanswered
      // question is not evidence of a problem.
      expect(assessScreenOffCover(null)).toEqual({ state: "unknown" });
      expect(screenOffCoverLine(null)).toBeNull();
    });

    it("is covered once the service's own GPS has seen the boat", () => {
      expect(assessScreenOffCover(status())).toEqual({ state: "covered" });
      expect(screenOffCoverLine(status())).toBeNull();
    });

    it("holds its verdict while the watch is still acquiring", () => {
      const acquiring = status({
        hadFix: false,
        lastFixAgeMs: -1,
        armedMs: 20_000,
      });
      expect(assessScreenOffCover(acquiring)).toEqual({ state: "unknown" });
    });

    it("discloses a watch still blind past the acquisition grace", () => {
      const blind = status({
        hadFix: false,
        lastFixAgeMs: -1,
        armedMs: SCREEN_OFF_COVER_GRACE_MS,
      });
      expect(assessScreenOffCover(blind)).toEqual({
        state: "none",
        reason: "no-fix",
      });
      expect(screenOffCoverLine(blind)).toBe(SCREEN_OFF_COVER_TEXT["no-fix"]);
    });

    it("names a missing permission immediately, without waiting out the grace", () => {
      const denied = status({
        locationPermission: false,
        hadFix: false,
        armedMs: 0,
      });
      expect(assessScreenOffCover(denied)).toEqual({
        state: "none",
        reason: "permission",
      });
    });

    it("reports a watch that is not running natively at all", () => {
      expect(assessScreenOffCover(status({ serviceRunning: false }))).toEqual({
        state: "none",
        reason: "service",
      });
      expect(assessScreenOffCover(status({ armedNatively: false }))).toEqual({
        state: "none",
        reason: "service",
      });
    });

    it("reads the status from the plugin, and null on web", async () => {
      const h = makeHarness();
      expect(
        await getNativeAnchorStatus({ plugin: h.plugin, isNative: true }),
      ).toEqual(status());
      expect(
        await getNativeAnchorStatus({ plugin: h.plugin, isNative: false }),
      ).toBeNull();
    });

    it("resolves null rather than throwing on an older native shell", async () => {
      const h = makeHarness();
      h.plugin.getAnchorWatchStatus.mockRejectedValue(new Error("no method"));
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      expect(
        await getNativeAnchorStatus({ plugin: h.plugin, isNative: true }),
      ).toBeNull();
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });
  });

  describe("external fix reporting", () => {
    it("reports the app's own fixes to the native watch, throttled", () => {
      const h = makeHarness();
      let clock = 100_000;
      connect(h, { navManager: h.navManager, now: () => clock });
      h.emit(snapshot());

      h.emitFix();
      h.emitFix();
      expect(h.plugin.noteExternalFix).toHaveBeenCalledTimes(1);

      clock += 10_000;
      h.emitFix();
      expect(h.plugin.noteExternalFix).toHaveBeenCalledTimes(2);
    });

    it("stays quiet when no watch is armed", () => {
      const h = makeHarness();
      connect(h, { navManager: h.navManager });
      h.emitFix();
      expect(h.plugin.noteExternalFix).not.toHaveBeenCalled();

      h.emit(snapshot());
      h.emit(null);
      h.emitFix();
      expect(h.plugin.noteExternalFix).not.toHaveBeenCalled();
    });
  });
});
