import { describe, expect, it, vi } from "vitest";
import type { AnchorWatchSnapshot } from "./AnchorWatchManager";
import {
  connectNativeAnchorWatch,
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

function makeHarness() {
  const plugin = {
    setAnchorWatch: vi.fn().mockResolvedValue(undefined),
    clearAnchorWatch: vi.fn().mockResolvedValue(undefined),
    acknowledgeAnchorAlarm: vi.fn().mockResolvedValue(undefined),
    addListener: vi.fn().mockResolvedValue(undefined),
  } satisfies NativeAnchorPlugin;
  let emit: (snap: AnchorWatchSnapshot | null) => void = () => {};
  const manager: NativeAnchorManager = {
    subscribe: (cb) => {
      emit = cb;
    },
    noteNativeAlarm: vi.fn(),
  };
  return {
    plugin,
    manager,
    emit: (snap: AnchorWatchSnapshot | null) => emit(snap),
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

function connect(h: ReturnType<typeof makeHarness>): void {
  connectNativeAnchorWatch(h.manager, { plugin: h.plugin, isNative: true });
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
});
