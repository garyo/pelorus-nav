import { describe, expect, it, vi } from "vitest";
import type { NavigationData } from "../navigation/NavigationData";
import type { AnchorWatchSnapshot } from "./AnchorWatchManager";
import {
  connectNativeAnchorWatch,
  type NativeAnchorAlarm,
  type NativeAnchorManager,
  type NativeAnchorPlugin,
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
    addListener: vi.fn().mockResolvedValue(undefined),
  } satisfies NativeAnchorPlugin;
  let emit: (snap: AnchorWatchSnapshot | null) => void = () => {};
  const manager: NativeAnchorManager = {
    subscribe: (cb) => {
      emit = cb;
    },
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
    emit: (snap: AnchorWatchSnapshot | null) => emit(snap),
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
): void {
  connectNativeAnchorWatch(h.manager, {
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
