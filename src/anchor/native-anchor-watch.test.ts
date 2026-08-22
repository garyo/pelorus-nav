import { describe, expect, it, vi } from "vitest";
import type { NavigationData } from "../navigation/NavigationData";
import type { AnchorWatchNativeStatus } from "../plugins/BackgroundGPS";
import type { AnchorWatchSnapshot } from "./AnchorWatchManager";
import {
  ALARM_VOLUME_TEXT,
  armedAdvisoryLine,
  assessScreenOffCover,
  connectNativeAnchorWatch,
  getNativeAnchorStatus,
  LOW_ALARM_VOLUME,
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
    gnssAvailable: true,
    ...over,
  };
}

function makeHarness() {
  const plugin = {
    setAnchorWatch: vi.fn().mockResolvedValue(undefined),
    clearAnchorWatch: vi.fn().mockResolvedValue(undefined),
    acknowledgeAnchorAlarm: vi.fn().mockResolvedValue(undefined),
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

    it("stays quiet about the redundant watchdog's own state", () => {
      // Field-proven on a BOOX with no GNSS at all: the JS watch ran through
      // screen-off and a closed cover, because an armed watch keeps a
      // foreground service and wake lock that hold the process awake. So no
      // GNSS chip, no fix yet, and a service still starting all describe the
      // watchdog, not the watch — reporting them would alarm the user about
      // something working, with nothing to do about it.
      const noGnss = status({
        gnssAvailable: false,
        hadFix: false,
        armedMs: 0,
      });
      expect(assessScreenOffCover(noGnss, 0)).toEqual({ state: "covered" });
      expect(screenOffCoverLine(noGnss, 0)).toBeNull();

      const blind = status({
        hadFix: false,
        lastFixAgeMs: -1,
        armedMs: SCREEN_OFF_COVER_GRACE_MS,
      });
      expect(screenOffCoverLine(blind)).toBeNull();

      const starting = status({ serviceRunning: false, armedNatively: false });
      expect(
        screenOffCoverLine(starting, SCREEN_OFF_COVER_GRACE_MS),
      ).toBeNull();
    });

    it("names a missing permission, the one thing the user can fix", () => {
      // Without it the foreground service cannot start, and it is the service
      // — not its fixes — that keeps the process awake while the screen is off.
      const denied = status({ locationPermission: false });
      expect(assessScreenOffCover(denied)).toEqual({
        state: "none",
        reason: "permission",
      });
      expect(screenOffCoverLine(denied)).toBe(SCREEN_OFF_COVER_TEXT.permission);
    });

    it("does not flash the permission warning while arming", () => {
      // The status is read before the arm-time permission prompt resolves.
      const denied = status({ locationPermission: false });
      expect(assessScreenOffCover(denied, 1_500)).toEqual({ state: "unknown" });
      expect(screenOffCoverLine(denied, 1_500)).toBeNull();
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

    it("says nothing about a stream that can be heard, or can't be read", () => {
      expect(armedAdvisoryLine(status({ alarmVolume: 0.6 }))).toBeNull();
      expect(
        armedAdvisoryLine(status({ alarmVolume: LOW_ALARM_VOLUME })),
      ).toBeNull();
      // Older shells omit the field; an unanswered question is not a warning.
      expect(armedAdvisoryLine(status())).toBeNull();
      expect(armedAdvisoryLine(status({ alarmVolume: -1 }))).toBeNull();
    });

    it("warns about an alarm stream too quiet to wake anyone", () => {
      // The measured field failure: 2 of 15.
      expect(armedAdvisoryLine(status({ alarmVolume: 2 / 15 }))).toBe(
        ALARM_VOLUME_TEXT.low,
      );
      expect(
        armedAdvisoryLine(status({ alarmVolume: 0.6, alarmVolumeMuted: true })),
      ).toBe(ALARM_VOLUME_TEXT.muted);
    });

    it("carries both disclosures on one line when both apply", () => {
      const bad = status({ locationPermission: false, alarmVolume: 0 });
      expect(armedAdvisoryLine(bad)).toBe(
        `${SCREEN_OFF_COVER_TEXT.permission} ${ALARM_VOLUME_TEXT.low}`,
      );
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
