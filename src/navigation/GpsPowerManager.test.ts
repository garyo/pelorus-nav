import { describe, expect, it } from "vitest";
import {
  DEFAULT_GPS_POWER_CONFIG as CFG,
  decideGpsPower,
  type GpsPowerInputs,
  needsResume,
  powerDecisionKey,
} from "./GpsPowerManager";

const base: GpsPowerInputs = {
  visible: true,
  recording: false,
  idle: false,
  eink: false,
  burst: false,
};

describe("decideGpsPower", () => {
  it("visible + active = fast normal rate", () => {
    expect(decideGpsPower(base)).toEqual({
      mode: "active",
      intervalMs: CFG.activeIntervalMs,
    });
  });

  it("visible + e-ink = slower e-ink rate", () => {
    expect(decideGpsPower({ ...base, eink: true })).toEqual({
      mode: "active",
      intervalMs: CFG.einkActiveIntervalMs,
    });
  });

  it("visible + idle backs off to the idle rate", () => {
    expect(decideGpsPower({ ...base, idle: true })).toEqual({
      mode: "active",
      intervalMs: CFG.idleIntervalMs,
    });
  });

  it("idle never speeds up the slower e-ink baseline", () => {
    // Regression: idle (3 s) must not override e-ink (5 s).
    expect(decideGpsPower({ ...base, idle: true, eink: true })).toEqual({
      mode: "active",
      intervalMs: CFG.einkActiveIntervalMs,
    });
  });

  it("hidden + recording = passive with grace", () => {
    expect(
      decideGpsPower({ ...base, visible: false, recording: true }),
    ).toEqual({
      mode: "passive",
      intervalMs: CFG.passiveIntervalMs,
      graceMs: CFG.hiddenGraceMs,
    });
  });

  it("hidden + not recording = stopped", () => {
    expect(
      decideGpsPower({ ...base, visible: false, recording: false }),
    ).toEqual({ mode: "stopped" });
  });

  it("visible takes priority over recording (snap back on focus)", () => {
    expect(decideGpsPower({ ...base, visible: true, recording: true })).toEqual(
      { mode: "active", intervalMs: CFG.activeIntervalMs },
    );
  });

  it("a burst speeds up the e-ink baseline", () => {
    expect(decideGpsPower({ ...base, eink: true, burst: true })).toEqual({
      mode: "active",
      intervalMs: CFG.burstActiveIntervalMs,
    });
  });

  it("a burst overrides the idle back-off (autopilot turn)", () => {
    expect(
      decideGpsPower({ ...base, eink: true, idle: true, burst: true }),
    ).toEqual({
      mode: "active",
      intervalMs: CFG.burstActiveIntervalMs,
    });
  });

  it("a burst never slows the fast normal-display rate", () => {
    expect(decideGpsPower({ ...base, burst: true })).toEqual({
      mode: "active",
      intervalMs: CFG.activeIntervalMs,
    });
  });

  it("a burst does not affect passive (screen-off) mode", () => {
    expect(
      decideGpsPower({ ...base, visible: false, recording: true, burst: true }),
    ).toEqual({
      mode: "passive",
      intervalMs: CFG.passiveIntervalMs,
      graceMs: CFG.hiddenGraceMs,
    });
  });
});

describe("powerDecisionKey (coalescing identity)", () => {
  it("identical decisions share a key (redundant repeats collapse)", () => {
    const k = powerDecisionKey(decideGpsPower(base));
    expect(powerDecisionKey(decideGpsPower({ ...base }))).toBe(k);
  });

  it("distinguishes mode, interval, and grace changes", () => {
    const active = powerDecisionKey({ mode: "active", intervalMs: 1000 });
    const activeSlow = powerDecisionKey({ mode: "active", intervalMs: 5000 });
    const passive = powerDecisionKey({
      mode: "passive",
      intervalMs: 15000,
      graceMs: 20000,
    });
    const passiveNoGrace = powerDecisionKey({
      mode: "passive",
      intervalMs: 15000,
      graceMs: 0,
    });
    const stopped = powerDecisionKey({ mode: "stopped" });
    const keys = [active, activeSlow, passive, passiveNoGrace, stopped];
    expect(new Set(keys).size).toBe(keys.length); // all distinct
  });

  it("e-ink idle vs normal produce different keys (re-applies on change)", () => {
    const normal = powerDecisionKey(decideGpsPower({ ...base }));
    const idleEink = powerDecisionKey(
      decideGpsPower({ ...base, idle: true, eink: true }),
    );
    expect(idleEink).not.toBe(normal);
  });
});

describe("needsResume (avoid redundant native restarts)", () => {
  const active = (intervalMs: number) =>
    powerDecisionKey({ mode: "active", intervalMs });

  it("resumes on first apply (no prior decision)", () => {
    expect(needsResume(null, { mode: "active", intervalMs: 1000 })).toBe(true);
  });

  it("resumes when coming back from stopped (service was killed)", () => {
    expect(needsResume("stopped", { mode: "active", intervalMs: 1000 })).toBe(
      true,
    );
  });

  it("does NOT resume on an active→active rate change (burst toggle)", () => {
    // The 2000↔5000 ms burst flips must not restart the foreground service.
    expect(
      needsResume(active(5000), { mode: "active", intervalMs: 2000 }),
    ).toBe(false);
  });

  it("does NOT resume on passive→active (service was never stopped)", () => {
    expect(
      needsResume(
        powerDecisionKey({
          mode: "passive",
          intervalMs: 15000,
          graceMs: 20000,
        }),
        {
          mode: "active",
          intervalMs: 1000,
        },
      ),
    ).toBe(false);
  });

  it("is irrelevant for non-active decisions", () => {
    expect(
      needsResume("stopped", {
        mode: "passive",
        intervalMs: 15000,
        graceMs: 0,
      }),
    ).toBe(false);
    expect(needsResume(active(1000), { mode: "stopped" })).toBe(false);
  });
});
