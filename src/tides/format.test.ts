import { describe, expect, it } from "vitest";
import {
  formatCurrentEvent,
  formatEventTime,
  formatSpeed,
  formatTideEvent,
  formatTideHeight,
} from "./format";

describe("formatEventTime", () => {
  // Construct in local time so date comparisons are timezone-independent
  const now = new Date(2026, 5, 5, 10, 0);

  it("shows clock only for same-day times", () => {
    const sameDay = new Date(2026, 5, 5, 14, 32);
    const text = formatEventTime(sameDay, now);
    expect(text).toBe(
      sameDay.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      }),
    );
  });

  it("prefixes the weekday for other days", () => {
    const tomorrow = new Date(2026, 5, 6, 2, 10);
    const text = formatEventTime(tomorrow, now);
    expect(text).toContain(
      tomorrow.toLocaleDateString(undefined, { weekday: "short" }),
    );
  });
});

describe("formatTideEvent / formatTideHeight", () => {
  it("formats highs and lows with one decimal in the depth unit", () => {
    const high = {
      time: new Date(),
      type: "high" as const,
      heightMeters: 2.957,
    };
    expect(formatTideEvent(high, "feet")).toBe("High 9.7ft");
    expect(
      formatTideEvent({ ...high, type: "low", heightMeters: 0.245 }, "meters"),
    ).toBe("Low 0.2m");
    expect(formatTideHeight(2.957, "feet")).toBe("9.7ft");
  });
});

describe("formatSpeed / formatCurrentEvent", () => {
  it("formats speeds in the chosen unit", () => {
    expect(formatSpeed(1.12, "knots")).toBe("1.1 Kt");
    expect(formatSpeed(1, "mph")).toBe("1.2 mph");
  });

  it("labels current events, omitting speed for slack", () => {
    const t = new Date();
    expect(
      formatCurrentEvent({ time: t, type: "maxFlood", speedKn: 1.12 }, "knots"),
    ).toBe("Max Flood 1.1 Kt");
    expect(
      formatCurrentEvent(
        { time: t, type: "slackBeforeEbb", speedKn: 0 },
        "knots",
      ),
    ).toBe("Slack");
  });
});
