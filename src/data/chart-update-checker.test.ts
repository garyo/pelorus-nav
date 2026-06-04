import { describe, expect, it } from "vitest";
import {
  isSnoozed,
  isStaleUpdate,
  type SnoozeEntry,
  STALE_AFTER_DAYS,
  streamingVersionToken,
  updateToken,
} from "./chart-update-checker";
import type { RemoteChartMeta, StoredChartInfo } from "./tile-store";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-06-01T12:00:00Z");

function daysAgo(days: number): string {
  return new Date(NOW - days * DAY_MS).toISOString();
}

function stored(overrides: Partial<StoredChartInfo> = {}): StoredChartInfo {
  return {
    filename: "nautical-test.pmtiles",
    region: "nautical-test",
    sizeBytes: 1000,
    downloadedAt: daysAgo(30),
    etag: '"aaa"',
    ...overrides,
  };
}

describe("isStaleUpdate", () => {
  it("returns false when the stored copy is current", () => {
    const remote: RemoteChartMeta = {
      etag: '"aaa"',
      lastModified: daysAgo(10),
    };
    expect(isStaleUpdate(stored(), remote, NOW)).toBe(false);
  });

  it("returns false when the update is newer than the threshold", () => {
    const remote: RemoteChartMeta = { etag: '"bbb"', lastModified: daysAgo(1) };
    expect(isStaleUpdate(stored(), remote, NOW)).toBe(false);
  });

  it("returns true when the update has been out past the threshold", () => {
    const remote: RemoteChartMeta = {
      etag: '"bbb"',
      lastModified: daysAgo(STALE_AFTER_DAYS + 1),
    };
    expect(isStaleUpdate(stored(), remote, NOW)).toBe(true);
  });

  it("falls back to local copy age when last-modified is missing", () => {
    const remote: RemoteChartMeta = { etag: '"bbb"' };
    expect(
      isStaleUpdate(stored({ downloadedAt: daysAgo(10) }), remote, NOW),
    ).toBe(true);
    expect(
      isStaleUpdate(stored({ downloadedAt: daysAgo(1) }), remote, NOW),
    ).toBe(false);
  });
});

describe("updateToken", () => {
  it("prefers etag, then last-modified, then size", () => {
    const lastModified = daysAgo(5);
    expect(updateToken({ etag: '"x"', lastModified, sizeBytes: 9 })).toBe(
      '"x"',
    );
    expect(updateToken({ lastModified, sizeBytes: 9 })).toBe(lastModified);
    expect(updateToken({ sizeBytes: 9 })).toBe("9");
  });
});

describe("streamingVersionToken", () => {
  it("normalizes the etag for use in a URL", () => {
    expect(streamingVersionToken({ etag: 'W/"abc123"' })).toBe("abc123");
    expect(streamingVersionToken({ etag: '"abc123"' })).toBe("abc123");
  });

  it("falls back to last-modified epoch, then null", () => {
    const lastModified = "2026-05-30T00:00:00Z";
    expect(streamingVersionToken({ lastModified })).toBe(
      String(Date.parse(lastModified)),
    );
    expect(streamingVersionToken({ sizeBytes: 9 })).toBeNull();
    expect(streamingVersionToken({})).toBeNull();
  });
});

describe("isSnoozed", () => {
  const snoozes: Record<string, SnoozeEntry> = {
    "a.pmtiles": { token: '"v1"', until: NOW + DAY_MS },
  };

  it("matches an active snooze for the same version", () => {
    expect(isSnoozed(snoozes, "a.pmtiles", '"v1"', NOW)).toBe(true);
  });

  it("ignores a snooze once it expires", () => {
    expect(isSnoozed(snoozes, "a.pmtiles", '"v1"', NOW + 2 * DAY_MS)).toBe(
      false,
    );
  });

  it("re-offers when a newer version appears", () => {
    expect(isSnoozed(snoozes, "a.pmtiles", '"v2"', NOW)).toBe(false);
  });

  it("ignores regions with no snooze entry", () => {
    expect(isSnoozed(snoozes, "b.pmtiles", '"v1"', NOW)).toBe(false);
  });
});
