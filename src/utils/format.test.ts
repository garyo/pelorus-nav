import { describe, expect, it } from "vitest";
import {
  formatBytes,
  formatDistanceShort,
  formatDurationShort,
  formatLocalDateTime,
} from "./format";

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

describe("formatLocalDateTime", () => {
  it("pads month, day, hour, and minute to two digits", () => {
    const d = new Date(2026, 0, 4, 9, 5); // Jan 4 2026, 09:05 local
    expect(formatLocalDateTime(d)).toBe("2026-01-04 09:05");
  });

  it("does not pad the four-digit year", () => {
    const d = new Date(2026, 10, 23, 14, 30); // Nov 23 2026, 14:30 local
    expect(formatLocalDateTime(d)).toBe("2026-11-23 14:30");
  });
});

describe("formatBytes", () => {
  it("formats across magnitudes using binary (1024) units", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(48 * 1024)).toBe("48 KB");
    expect(formatBytes(12.3 * 1024 * 1024)).toBe("12.3 MB");
    expect(formatBytes(1.2 * 1024 * 1024 * 1024)).toBe("1.20 GB");
  });
});
