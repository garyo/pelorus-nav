import { describe, expect, it } from "vitest";
import {
  AdaptiveRateController,
  computeDRError,
  DEFAULT_ADAPTIVE_CONFIG,
  decideTier,
} from "./AdaptiveRate";
import type { NavigationData } from "./NavigationData";

function makeFix(
  overrides: Partial<NavigationData> & { timestamp: number },
): NavigationData {
  return {
    latitude: 42.35,
    longitude: -71.04,
    cog: 90,
    sog: 6,
    heading: 90,
    accuracy: 5,
    source: "test",
    ...overrides,
  };
}

describe("computeDRError", () => {
  it("returns ~0 for a vessel on steady course", () => {
    // 6 knots east for 2 seconds — project forward, actual matches
    const prevLat = 42.35;
    const prevLon = -71.04;
    const cog = 90;
    const sog = 6;
    const elapsedMs = 2000;
    // Approximate actual position after 2s at 6kn east
    const distNM = (6 * 2) / 3600; // ~0.00333 NM
    // At 42.35°N, 1 NM east ≈ 0.0225° longitude
    const actualLon =
      prevLon + (distNM * (1 / 60)) / Math.cos((42.35 * Math.PI) / 180);
    const error = computeDRError(
      prevLat,
      prevLon,
      cog,
      sog,
      elapsedMs,
      prevLat,
      actualLon,
    );
    expect(error).toBeLessThan(0.001);
  });

  it("returns significant error for a course change", () => {
    const error = computeDRError(42.35, -71.04, 90, 6, 5000, 42.351, -71.04);
    expect(error).toBeGreaterThan(0.01);
  });
});

describe("decideTier", () => {
  const config = DEFAULT_ADAPTIVE_CONFIG;

  it("returns slow for stationary vessel", () => {
    const result = decideTier("fast", 0.3, null, 0, config);
    expect(result.tier).toBe("slow");
    expect(result.steadyCount).toBe(0);
  });

  it("returns slow for null SOG", () => {
    const result = decideTier("medium", null, 0.001, 3, config);
    expect(result.tier).toBe("slow");
  });

  it("returns fast when no DR data yet", () => {
    const result = decideTier("slow", 6, null, 0, config);
    expect(result.tier).toBe("fast");
  });

  it("returns fast on maneuver (high DR error)", () => {
    const result = decideTier("medium", 6, 0.05, 10, config);
    expect(result.tier).toBe("fast");
    expect(result.steadyCount).toBe(0);
  });

  it("transitions fast → medium after steady samples", () => {
    const result = decideTier(
      "fast",
      6,
      0.001,
      config.steadySamplesRequired - 1,
      config,
    );
    expect(result.tier).toBe("medium");
  });

  it("stays fast when not enough steady samples", () => {
    const result = decideTier("fast", 6, 0.001, 2, config);
    expect(result.tier).toBe("fast");
    expect(result.steadyCount).toBe(3);
  });

  it("stays medium on continued steady course", () => {
    const result = decideTier("medium", 6, 0.005, 10, config);
    expect(result.tier).toBe("medium");
  });

  it("transitions slow → fast when SOG exceeds threshold", () => {
    const result = decideTier("slow", 3, null, 0, config);
    expect(result.tier).toBe("fast");
  });
});

describe("AdaptiveRateController", () => {
  it("starts in fast tier", () => {
    const ctrl = new AdaptiveRateController();
    expect(ctrl.getState().tier).toBe("fast");
  });

  it("first fix always broadcasts", () => {
    const ctrl = new AdaptiveRateController();
    expect(ctrl.shouldBroadcast(Date.now())).toBe(true);
  });

  it("transitions to slow for stationary fixes", () => {
    const ctrl = new AdaptiveRateController();
    const t = 1000000;
    ctrl.onFix(makeFix({ sog: 0, cog: null, timestamp: t }));
    ctrl.onFix(makeFix({ sog: 0, cog: null, timestamp: t + 2000 }));
    expect(ctrl.getState().tier).toBe("slow");
  });

  it("transitions fast → medium after steady samples", () => {
    const ctrl = new AdaptiveRateController();
    const t = 1000000;
    // First fix
    ctrl.onFix(makeFix({ timestamp: t }));
    // Steady fixes at 2s intervals — same position, COG, SOG
    for (let i = 1; i <= 6; i++) {
      ctrl.onFix(makeFix({ timestamp: t + i * 2000 }));
    }
    expect(ctrl.getState().tier).toBe("medium");
  });

  it("goes back to fast on course change", () => {
    const ctrl = new AdaptiveRateController();
    const t = 1000000;
    ctrl.onFix(makeFix({ timestamp: t }));
    // Build up steady count
    for (let i = 1; i <= 6; i++) {
      ctrl.onFix(makeFix({ timestamp: t + i * 2000 }));
    }
    expect(ctrl.getState().tier).toBe("medium");
    // Sudden position change (maneuver)
    ctrl.onFix(makeFix({ latitude: 42.36, timestamp: t + 14000 }));
    expect(ctrl.getState().tier).toBe("fast");
  });

  it("resets to fast after stale gap", () => {
    const ctrl = new AdaptiveRateController();
    const t = 1000000;
    ctrl.onFix(makeFix({ sog: 0, cog: null, timestamp: t }));
    ctrl.onFix(makeFix({ sog: 0, cog: null, timestamp: t + 2000 }));
    expect(ctrl.getState().tier).toBe("slow");
    // 60s gap
    ctrl.onFix(makeFix({ sog: 6, timestamp: t + 62000 }));
    expect(ctrl.getState().tier).toBe("fast");
  });

  it("reset() returns to initial state", () => {
    const ctrl = new AdaptiveRateController();
    ctrl.onFix(makeFix({ sog: 0, cog: null, timestamp: 1000 }));
    ctrl.onFix(makeFix({ sog: 0, cog: null, timestamp: 3000 }));
    ctrl.reset();
    expect(ctrl.getState().tier).toBe("fast");
    expect(ctrl.getState().steadyCount).toBe(0);
  });

  it("shouldBroadcast respects interval", () => {
    const ctrl = new AdaptiveRateController();
    const t = 1000000;
    ctrl.onFix(makeFix({ timestamp: t }));
    ctrl.markBroadcast(t);
    // 1s later — fast tier is 2s interval
    expect(ctrl.shouldBroadcast(t + 1000)).toBe(false);
    // 2s later — should broadcast
    expect(ctrl.shouldBroadcast(t + 2000)).toBe(true);
  });

  it("handles null COG with movement as fast", () => {
    const ctrl = new AdaptiveRateController();
    const t = 1000000;
    ctrl.onFix(makeFix({ cog: null, sog: 5, timestamp: t }));
    ctrl.onFix(makeFix({ cog: null, sog: 5, timestamp: t + 2000 }));
    // null COG means no DR → fast
    expect(ctrl.getState().tier).toBe("fast");
  });
});
