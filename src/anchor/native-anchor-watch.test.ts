import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NavigationData } from "../navigation/NavigationData";
import type { AnchorWatchNativeStatus } from "../plugins/BackgroundGPS";
import type { AnchorWatchSnapshot } from "./AnchorWatchManager";
import {
  ALARM_VOLUME_TEXT,
  armedAdvisoryLine,
  assessScreenOffCover,
  connectNativeAnchorWatch,
  getNativeAnchorStatus,
  KEEPALIVE_INTERVAL_MS,
  LOW_ALARM_VOLUME,
  type NativeAnchorManager,
  type NativeAnchorPlugin,
  SCREEN_OFF_COVER_GRACE_MS,
  SCREEN_OFF_COVER_TEXT,
  screenOffCoverLine,
} from "./native-anchor-watch";

// Fake timers file-wide: arming starts the keepalive interval, and a real one
// leaking out of a test would outlive it.
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

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
    watchFailureReason: null,
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
    anchorKeepalive: vi.fn().mockResolvedValue(undefined),
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
    noteNativeAlarmCleared: vi.fn(),
    acknowledge: vi.fn(),
  };
  let emitFix: (fix: NavigationData) => void = () => {};
  const navManager = {
    subscribe: (cb: (fix: NavigationData) => void) => {
      emitFix = cb;
    },
  };
  /** The handler the module registered for a plugin event. */
  const listenerFor = (eventName: string): ((...args: never[]) => void) => {
    const call = plugin.addListener.mock.calls.find(
      ([name]) => name === eventName,
    );
    if (!call) throw new Error(`no listener registered for ${eventName}`);
    return call[1] as (...args: never[]) => void;
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
    fireAlarm(
      kind: "drag" | "gps-loss" | "watch-failure",
      reason?: "nothing-watching" | "device-battery",
    ) {
      const handler = listenerFor("anchorAlarm") as (d: {
        kind: "drag" | "gps-loss" | "watch-failure";
        distanceM: number;
        at: number;
        reason?: "nothing-watching" | "device-battery";
      }) => void;
      handler({ kind, distanceM: 61, at: 1000, reason });
    },
    /** A watch-failure condition ended on its own, as a retained event. */
    fireAlarmCleared(kind: "drag" | "gps-loss" | "watch-failure") {
      const handler = listenerFor("anchorAlarmCleared") as (d: {
        kind: "drag" | "gps-loss" | "watch-failure";
      }) => void;
      handler({ kind });
    },
    /** The notification's Silence action, arriving as a retained event. */
    fireAcknowledged() {
      (listenerFor("anchorAcknowledged") as () => void)();
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
    h.emit(snapshot());
    h.fireAlarm("gps-loss");
    expect(h.manager.noteNativeAlarm).toHaveBeenCalledWith(
      "gps-loss",
      undefined,
    );
  });

  it("passes a watch-failure alarm through with its reason", () => {
    const h = makeHarness();
    connect(h);
    h.emit(snapshot());
    h.fireAlarm("watch-failure", "nothing-watching");
    expect(h.manager.noteNativeAlarm).toHaveBeenCalledWith(
      "watch-failure",
      "nothing-watching",
    );
    h.fireAlarm("watch-failure", "device-battery");
    expect(h.manager.noteNativeAlarm).toHaveBeenLastCalledWith(
      "watch-failure",
      "device-battery",
    );
  });

  it("forwards a native cleared event into the manager", () => {
    const h = makeHarness();
    connect(h);
    h.emit(snapshot());
    h.fireAlarmCleared("watch-failure");
    expect(h.manager.noteNativeAlarmCleared).toHaveBeenCalledWith(
      "watch-failure",
    );
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
    it("holds retained events for an unarmed manager until reconcile", () => {
      // Retained events replay as soon as listeners register — before
      // restore() has re-armed the manager on a cold start. Delivering
      // then would drop them (noteNativeAlarm ignores an unarmed manager)
      // and retained events are consumed on delivery, so the loss would be
      // permanent. They must wait for reconcile and land in order.
      const h = makeHarness();
      const handle = connect(h);
      h.fireAlarm("watch-failure", "nothing-watching");
      h.fireAlarmCleared("watch-failure");
      expect(h.manager.noteNativeAlarm).not.toHaveBeenCalled();
      h.setState(snapshot());
      handle.reconcile();
      expect(h.manager.noteNativeAlarm).toHaveBeenCalledWith(
        "watch-failure",
        "nothing-watching",
      );
      expect(h.manager.noteNativeAlarmCleared).toHaveBeenCalledWith(
        "watch-failure",
      );
    });

    it("delivers events immediately once the manager is armed", () => {
      const h = makeHarness();
      connect(h);
      h.emit(snapshot());
      h.fireAlarm("drag");
      expect(h.manager.noteNativeAlarm).toHaveBeenCalledWith("drag", undefined);
    });

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

  describe("keepalive heartbeat", () => {
    it("beats immediately on arm and every interval after", () => {
      const h = makeHarness();
      connect(h);
      expect(h.plugin.anchorKeepalive).not.toHaveBeenCalled();

      h.emit(snapshot());
      expect(h.plugin.anchorKeepalive).toHaveBeenCalledTimes(1);
      expect(h.plugin.anchorKeepalive).toHaveBeenLastCalledWith({
        sinceLastMs: 0,
      });

      vi.advanceTimersByTime(KEEPALIVE_INTERVAL_MS);
      expect(h.plugin.anchorKeepalive).toHaveBeenCalledTimes(2);
      expect(h.plugin.anchorKeepalive).toHaveBeenLastCalledWith({
        sinceLastMs: KEEPALIVE_INTERVAL_MS,
      });
    });

    it("keeps one interval across repeated armed snapshots", () => {
      const h = makeHarness();
      connect(h);
      h.emit(snapshot());
      h.emit(snapshot({ zone: "warn", distanceM: 45 }));
      expect(h.plugin.anchorKeepalive).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(KEEPALIVE_INTERVAL_MS);
      expect(h.plugin.anchorKeepalive).toHaveBeenCalledTimes(2);
    });

    it("stops on disarm and starts fresh on re-arm", () => {
      const h = makeHarness();
      connect(h);
      h.emit(snapshot());
      h.emit(null);
      vi.advanceTimersByTime(6 * KEEPALIVE_INTERVAL_MS);
      expect(h.plugin.anchorKeepalive).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(5000);
      h.emit(snapshot());
      // A fresh watch, a fresh curve: the first beat is 0 again, not the
      // elapsed time since the previous watch's last beat.
      expect(h.plugin.anchorKeepalive).toHaveBeenLastCalledWith({
        sinceLastMs: 0,
      });
    });

    it("stops on dispose", () => {
      const h = makeHarness();
      const handle = connect(h);
      h.emit(snapshot());
      handle.dispose();
      vi.advanceTimersByTime(6 * KEEPALIVE_INTERVAL_MS);
      expect(h.plugin.anchorKeepalive).toHaveBeenCalledTimes(1);
    });

    it("reports throttling as drift in sinceLastMs", () => {
      const h = makeHarness();
      let clock = 0;
      connect(h, { now: () => clock });
      h.emit(snapshot());

      // The interval fires once, but the wall clock says 25 s passed — a
      // throttled WebView. The beat must report the truth, not the schedule.
      clock = 25_000;
      vi.advanceTimersByTime(KEEPALIVE_INTERVAL_MS);
      expect(h.plugin.anchorKeepalive).toHaveBeenLastCalledWith({
        sinceLastMs: 25_000,
      });
    });

    it("warns once and keeps beating on an older shell", async () => {
      const h = makeHarness();
      h.plugin.anchorKeepalive.mockRejectedValue(new Error("not implemented"));
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      connect(h);
      h.emit(snapshot());
      await vi.advanceTimersByTimeAsync(2 * KEEPALIVE_INTERVAL_MS);
      expect(h.plugin.anchorKeepalive).toHaveBeenCalledTimes(3);
      expect(warn).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    });
  });

  describe("anchorAcknowledged event", () => {
    it("forwards the notification's Silence into the manager", () => {
      const h = makeHarness();
      connect(h);
      h.emit(snapshot({ alarming: true, alarmKind: "drag" }));
      h.fireAcknowledged();
      expect(h.manager.acknowledge).toHaveBeenCalledTimes(1);
    });

    it("settles without looping when the acknowledge round-trips", () => {
      const h = makeHarness();
      connect(h);
      h.emit(snapshot({ alarming: true, alarmKind: "drag" }));
      // A real manager notifies an acknowledged snapshot, which this module
      // pushes back down as acknowledgeAnchorAlarm — the native side fires
      // anchorAcknowledged only for the notification path, so the cycle ends
      // there. Model that notify to prove one pass is all that happens.
      vi.mocked(h.manager.acknowledge).mockImplementation(() => {
        h.emit(snapshot({ acknowledged: true }));
      });
      h.fireAcknowledged();
      expect(h.plugin.acknowledgeAnchorAlarm).toHaveBeenCalledTimes(1);

      // A duplicate retained event is idempotent: same snapshot, no new push.
      h.fireAcknowledged();
      expect(h.plugin.acknowledgeAnchorAlarm).toHaveBeenCalledTimes(1);
      expect(h.manager.acknowledge).toHaveBeenCalledTimes(2);
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

    it("stays quiet while the watchdog is merely starting up", () => {
      // A service still coming up, and a watch still acquiring, are both
      // transient — reporting them flashed a warning on every arm.
      const starting = status({ serviceRunning: false, armedNatively: false });
      expect(screenOffCoverLine(starting, 1_000)).toBeNull();
      const acquiring = status({ hadFix: false, lastFixAgeMs: -1 });
      expect(screenOffCoverLine(acquiring, 1_000)).toBeNull();
    });

    it("warns while the background watch has never had a GNSS fix", () => {
      // Measured on a phone: about a minute after the screen goes off
      // Android freezes the WebView, so the JS watch stops detecting and the
      // native watchdog is the only cover. Until it has a fix of its own,
      // the watch is awake-only — actionable by moving to open sky.
      const blind = status({ hadFix: false, lastFixAgeMs: -1 });
      expect(assessScreenOffCover(blind)).toEqual({
        state: "none",
        reason: "no-fix",
      });
      expect(screenOffCoverLine(blind)).toBe(SCREEN_OFF_COVER_TEXT["no-fix"]);
    });

    it("never warns a device that has no GNSS to get a fix with", () => {
      // A GNSS-less tablet on an external GPS: hadFix stays false forever,
      // but "no fix — move where the sky is clear" beside a healthy GPS
      // readout is a contradiction with no action behind it. The JS watch
      // is the watch there, and the watch-failure alarm covers its loss.
      const noChip = status({
        hadFix: false,
        lastFixAgeMs: -1,
        gnssAvailable: false,
      });
      expect(assessScreenOffCover(noChip)).toEqual({ state: "covered" });
      expect(screenOffCoverLine(noChip)).toBeNull();
    });

    it("says nothing once the background watch has seen the boat", () => {
      expect(assessScreenOffCover(status({ hadFix: true }))).toEqual({
        state: "covered",
      });
      expect(screenOffCoverLine(status({ hadFix: true }))).toBeNull();
    });

    it("holds the no-fix warning through the acquisition grace", () => {
      const acquiring = status({ hadFix: false, lastFixAgeMs: -1 });
      expect(assessScreenOffCover(acquiring, 1_500)).toEqual({
        state: "unknown",
      });
      expect(screenOffCoverLine(acquiring, 1_500)).toBeNull();
      // …and speaks up once the grace has passed with still no fix.
      expect(
        assessScreenOffCover(acquiring, SCREEN_OFF_COVER_GRACE_MS),
      ).toEqual({ state: "none", reason: "no-fix" });
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

    it("delivered fixes also beat the keepalive, floored", () => {
      // Chromium can throttle a hidden page's timers while still executing
      // bridge-delivered events, so a fix arriving is proof of life even
      // when setInterval never fires.
      const h = makeHarness();
      let clock = 100_000;
      connect(h, { navManager: h.navManager, now: () => clock });
      h.emit(snapshot());
      const beatsAfterArm = h.plugin.anchorKeepalive.mock.calls.length;

      clock += 5_000;
      h.emitFix();
      expect(h.plugin.anchorKeepalive.mock.calls.length).toBe(
        beatsAfterArm + 1,
      );
      // Floored: an immediate second fix does not beat again.
      h.emitFix();
      expect(h.plugin.anchorKeepalive.mock.calls.length).toBe(
        beatsAfterArm + 1,
      );
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
