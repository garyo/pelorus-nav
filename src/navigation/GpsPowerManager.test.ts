import { describe, expect, it } from "vitest";
import {
  DEFAULT_GPS_POWER_CONFIG as CFG,
  decideGpsPower,
  type GpsPowerInputs,
} from "./GpsPowerManager";

const base: GpsPowerInputs = {
  visible: true,
  recording: false,
  idle: false,
  eink: false,
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
});
