import { describe, expect, it, vi } from "vitest";
import {
  createAnchorAlarms,
  NativeAnchorAlarmSound,
} from "./native-anchor-alarm";

/** A native plugin whose service is up and takes every request. */
function fakePlugin() {
  return {
    setAnchorAlarmSound: vi.fn().mockResolvedValue({ serviceRunning: true }),
  };
}

describe("createAnchorAlarms", () => {
  it("sounds for itself on web — Web Audio is all there is", () => {
    const { drag, gpsLoss } = createAnchorAlarms({ isNative: false });
    // CobAlarm reports its own audio state; the native channels never can.
    expect(drag.isBlocked()).toBe(false);
    expect(drag).not.toBe(gpsLoss);
    drag.start(false);
    drag.stop();
    gpsLoss.stop();
  });

  it("asks the service for the noise on native", () => {
    const plugin = fakePlugin();
    const { drag } = createAnchorAlarms({ isNative: true, plugin });
    drag.start(false);
    expect(plugin.setAnchorAlarmSound).toHaveBeenCalledWith({
      sounding: true,
      muted: false,
    });
  });
});

describe("NativeAnchorAlarmSound", () => {
  it("keeps sounding while either alarm wants noise", () => {
    const plugin = fakePlugin();
    const sound = new NativeAnchorAlarmSound(plugin);
    const drag = sound.channel("drag");
    const gpsLoss = sound.channel("gps-loss");

    drag.start(false);
    gpsLoss.start(false);
    // One alarm ending doesn't silence the other.
    drag.stop();
    expect(plugin.setAnchorAlarmSound).toHaveBeenLastCalledWith({
      sounding: true,
      muted: false,
    });
    gpsLoss.stop();
    expect(plugin.setAnchorAlarmSound).toHaveBeenLastCalledWith({
      sounding: false,
      muted: false,
    });
  });

  it("carries the user's mute down to the service", () => {
    const plugin = fakePlugin();
    const sound = new NativeAnchorAlarmSound(plugin);
    const drag = sound.channel("drag");
    drag.start(true);
    expect(plugin.setAnchorAlarmSound).toHaveBeenLastCalledWith({
      sounding: true,
      muted: true,
    });
    drag.setMuted(false);
    expect(plugin.setAnchorAlarmSound).toHaveBeenLastCalledWith({
      sounding: true,
      muted: false,
    });
  });

  it("re-pushes rather than deduplicating", () => {
    // The notification's Silence action stops the sound behind this side's
    // back, so every state change has to re-state what is wanted.
    const plugin = fakePlugin();
    const drag = new NativeAnchorAlarmSound(plugin).channel("drag");
    drag.start(false);
    drag.start(false);
    expect(plugin.setAnchorAlarmSound).toHaveBeenCalledTimes(2);
  });

  it("reports no blocked audio while the service is sounding", () => {
    const drag = new NativeAnchorAlarmSound(fakePlugin()).channel("drag");
    expect(drag.isBlocked()).toBe(false);
    expect(() => {
      drag.onBlockedChange(() => {});
      drag.retryUnlock();
    }).not.toThrow();
  });

  it("sounds for itself when no service is there to take the request", async () => {
    // Arming without location permission cannot start a foreground service;
    // the JS watch still runs, so a quiet alarm beats no alarm.
    const sound = new NativeAnchorAlarmSound({
      setAnchorAlarmSound: vi.fn().mockResolvedValue({ serviceRunning: false }),
    });
    const drag = sound.channel("drag");
    drag.start(false);
    await Promise.resolve();
    expect(sound.soundingLocally()).toBe(true);

    drag.stop();
    await Promise.resolve();
    expect(sound.soundingLocally()).toBe(false);
  });

  it("stays quiet itself while the service has the alarm", async () => {
    const sound = new NativeAnchorAlarmSound(fakePlugin());
    sound.channel("drag").start(false);
    await Promise.resolve();
    expect(sound.soundingLocally()).toBe(false);
  });

  it("survives a native shell without the method, sounding for itself", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sound = new NativeAnchorAlarmSound({
      setAnchorAlarmSound: vi.fn().mockRejectedValue(new Error("no method")),
    });
    const drag = sound.channel("drag");
    expect(() => drag.start(false)).not.toThrow();
    await Promise.resolve();
    expect(warn).toHaveBeenCalled();
    expect(sound.soundingLocally()).toBe(true);
    drag.stop();
    warn.mockRestore();
  });
});
