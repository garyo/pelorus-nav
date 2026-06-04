import { describe, expect, it } from "vitest";
import { formatDistanceShort, formatDurationShort } from "./format";

describe("formatDurationShort", () => {
  it("formats across magnitudes", () => {
    expect(formatDurationShort(47_000)).toBe("47s");
    expect(formatDurationShort(12 * 60_000)).toBe("12m");
    expect(formatDurationShort((60 + 47) * 60_000)).toBe("1h 47m");
    expect(formatDurationShort(2 * 3_600_000)).toBe("2h");
    expect(formatDurationShort(-5)).toBe("0s");
  });
});

describe("formatDistanceShort", () => {
  it("formats across magnitudes", () => {
    expect(formatDistanceShort(0.3)).toBe("0.30 nm");
    expect(formatDistanceShort(12.44)).toBe("12.4 nm");
    expect(formatDistanceShort(127.4)).toBe("127 nm");
    expect(formatDistanceShort(-1)).toBe("0.00 nm");
  });
});
