import { describe, expect, it } from "vitest";
import type { TideEvent } from "../tides/predictor";
import {
  dropToLow,
  formatScopeRatio,
  highestHighWithin,
  lowestLowWithin,
  riseToHigh,
  SCOPE_GOOD,
  SCOPE_MARGINAL,
  scopeAdvice,
  scopeAtTide,
  scopeRatio,
  worstAdvice,
} from "./anchor-scope";

const HOUR_MS = 3600 * 1000;
const NOW = new Date("2026-08-21T12:00:00Z");

function high(hoursFromNow: number, heightMeters: number): TideEvent {
  return {
    time: new Date(NOW.getTime() + hoursFromNow * HOUR_MS),
    type: "high",
    heightMeters,
  };
}

function low(hoursFromNow: number, heightMeters: number): TideEvent {
  return { ...high(hoursFromNow, heightMeters), type: "low" };
}

describe("scopeRatio", () => {
  it("divides rode by depth plus bow height", () => {
    expect(scopeRatio({ rodeM: 30, depthM: 4, bowHeightM: 1 })).toBeCloseTo(6);
    expect(scopeRatio({ rodeM: 45, depthM: 8, bowHeightM: 1 })).toBeCloseTo(5);
  });

  it("counts a missing bow height as zero", () => {
    expect(scopeRatio({ rodeM: 30, depthM: 5 })).toBeCloseTo(6);
    expect(scopeRatio({ rodeM: 30, depthM: 5, bowHeightM: null })).toBeCloseTo(
      6,
    );
  });

  it("returns null without a usable rode", () => {
    expect(scopeRatio({ rodeM: undefined, depthM: 5 })).toBeNull();
    expect(scopeRatio({ rodeM: 0, depthM: 5 })).toBeNull();
    expect(scopeRatio({ rodeM: -10, depthM: 5 })).toBeNull();
    expect(scopeRatio({ rodeM: Number.NaN, depthM: 5 })).toBeNull();
  });

  it("returns null without a usable depth", () => {
    expect(scopeRatio({ rodeM: 30, depthM: undefined })).toBeNull();
    expect(scopeRatio({ rodeM: 30, depthM: Number.NaN })).toBeNull();
    expect(scopeRatio({ rodeM: 30, depthM: Number.POSITIVE_INFINITY })).toBe(
      null,
    );
  });

  it("returns null when the vertical distance is not positive", () => {
    expect(scopeRatio({ rodeM: 30, depthM: 0, bowHeightM: 0 })).toBeNull();
    expect(scopeRatio({ rodeM: 30, depthM: -2, bowHeightM: 1 })).toBeNull();
  });
});

describe("scopeAtTide", () => {
  it("shrinks the ratio as the water rises", () => {
    const base = { rodeM: 30, depthM: 4, bowHeightM: 1 };
    expect(scopeAtTide({ ...base, tideRiseM: 0 })).toBeCloseTo(6);
    expect(scopeAtTide({ ...base, tideRiseM: 3 })).toBeCloseTo(3.75);
  });

  it("treats a missing rise as no rise", () => {
    const base = { rodeM: 30, depthM: 4, bowHeightM: 1 };
    expect(scopeAtTide({ ...base, tideRiseM: null })).toBeCloseTo(6);
    expect(scopeAtTide({ ...base, tideRiseM: Number.NaN })).toBeCloseTo(6);
  });

  it("guards a fall that would zero the vertical distance", () => {
    expect(
      scopeAtTide({ rodeM: 30, depthM: 4, bowHeightM: 1, tideRiseM: -5 }),
    ).toBeNull();
  });
});

describe("scopeAdvice", () => {
  it("classifies against the documented thresholds", () => {
    expect(scopeAdvice(7)).toBe("good");
    expect(scopeAdvice(SCOPE_GOOD)).toBe("good");
    expect(scopeAdvice(4.9)).toBe("marginal");
    expect(scopeAdvice(SCOPE_MARGINAL)).toBe("marginal");
    expect(scopeAdvice(2.9)).toBe("poor");
    expect(scopeAdvice(0)).toBe("poor");
  });

  it("has no opinion on an unknown ratio", () => {
    expect(scopeAdvice(null)).toBeNull();
    expect(scopeAdvice(Number.NaN)).toBeNull();
  });
});

describe("worstAdvice", () => {
  it("keeps the more cautious of the two", () => {
    expect(worstAdvice("good", "marginal")).toBe("marginal");
    expect(worstAdvice("poor", "good")).toBe("poor");
    expect(worstAdvice("good", "good")).toBe("good");
  });

  it("falls back to whichever side is known", () => {
    expect(worstAdvice(null, "marginal")).toBe("marginal");
    expect(worstAdvice("good", null)).toBe("good");
    expect(worstAdvice(null, null)).toBeNull();
  });
});

describe("formatScopeRatio", () => {
  it("shows one decimal", () => {
    expect(formatScopeRatio(5.238)).toBe("5.2:1");
    expect(formatScopeRatio(6)).toBe("6.0:1");
  });
});

describe("highestHighWithin", () => {
  const window = 12 * HOUR_MS;

  it("picks the highest high in the window, not the soonest", () => {
    const events = [high(2, 2.4), low(8, 0.3), high(11, 3.1)];
    expect(highestHighWithin(events, NOW, window)?.heightMeters).toBe(3.1);
  });

  it("ignores lows, past events, and events beyond the window", () => {
    const events = [low(1, 0.1), high(-1, 9), high(13, 9), high(3, 2.2)];
    expect(highestHighWithin(events, NOW, window)?.heightMeters).toBe(2.2);
  });

  it("keeps the earlier of two equal highs", () => {
    const events = [high(2, 3), high(10, 3)];
    expect(highestHighWithin(events, NOW, window)?.time).toEqual(
      events[0].time,
    );
  });

  it("returns null when no high qualifies", () => {
    expect(highestHighWithin([], NOW, window)).toBeNull();
    expect(highestHighWithin([low(3, 0.2)], NOW, window)).toBeNull();
  });
});

describe("riseToHigh", () => {
  it("measures the rise still to come", () => {
    expect(riseToHigh(1.2, 3.4)).toBeCloseTo(2.2);
  });

  it("floors at zero when the high is already past its peak level", () => {
    expect(riseToHigh(3.4, 3.4)).toBe(0);
    expect(riseToHigh(3.6, 3.4)).toBe(0);
  });
});

describe("lowestLowWithin / dropToLow", () => {
  const t = (h: number) => new Date(Date.UTC(2026, 0, 1, h));
  const events = [
    { type: "low" as const, time: t(2), heightMeters: 0.6 },
    { type: "high" as const, time: t(8), heightMeters: 3.2 },
    { type: "low" as const, time: t(14), heightMeters: 0.2 },
    { type: "low" as const, time: t(26), heightMeters: -0.3 },
  ];

  it("picks the lowest low in the window, not the soonest", () => {
    // Window spans both lows: 0.6 at t+2 and the deeper 0.2 at t+14.
    const low = lowestLowWithin(events, t(0), 16 * 3600_000);
    expect(low?.heightMeters).toBe(0.2);
  });

  it("ignores lows outside the window and past events", () => {
    expect(lowestLowWithin(events, t(0), 3600_000)).toBeNull();
    expect(lowestLowWithin(events, t(20), 12 * 3600_000)?.heightMeters).toBe(
      -0.3,
    );
  });

  it("drop is the fall from current height, floored at zero", () => {
    expect(dropToLow(2.0, 0.2)).toBeCloseTo(1.8, 6);
    expect(dropToLow(0.2, 1.5)).toBe(0);
  });
});
