import { describe, expect, it } from "vitest";
import {
  isUpdateAvailable,
  type RemoteChartMeta,
  type StoredChartInfo,
} from "./tile-store";

const stored = (over: Partial<StoredChartInfo> = {}): StoredChartInfo => ({
  filename: "nautical-x.pmtiles",
  region: "nautical-x",
  sizeBytes: 1000,
  downloadedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

describe("isUpdateAvailable", () => {
  it("etag match = no update", () => {
    expect(
      isUpdateAvailable(stored({ etag: '"abc"' }), { etag: '"abc"' }),
    ).toBe(false);
  });

  it("etag differs = update", () => {
    expect(
      isUpdateAvailable(stored({ etag: '"abc"' }), { etag: '"def"' }),
    ).toBe(true);
  });

  it("ignores weak-validator prefix and quotes when comparing etags", () => {
    expect(
      isUpdateAvailable(stored({ etag: '"abc"' }), { etag: 'W/"abc"' }),
    ).toBe(false);
  });

  it("falls back to last-modified newer than download time", () => {
    const s = stored({ downloadedAt: "2026-01-01T00:00:00.000Z" });
    expect(
      isUpdateAvailable(s, { lastModified: "Wed, 02 Jan 2026 00:00:00 GMT" }),
    ).toBe(true);
    expect(
      isUpdateAvailable(s, { lastModified: "Wed, 31 Dec 2025 00:00:00 GMT" }),
    ).toBe(false);
  });

  it("etag takes priority over last-modified", () => {
    // etag matches → current, even though last-modified looks newer
    const s = stored({ etag: '"abc"' });
    const remote: RemoteChartMeta = {
      etag: '"abc"',
      lastModified: "Wed, 02 Jan 2030 00:00:00 GMT",
    };
    expect(isUpdateAvailable(s, remote)).toBe(false);
  });

  it("falls back to size difference when no etag/last-modified", () => {
    expect(
      isUpdateAvailable(stored({ sizeBytes: 1000 }), { sizeBytes: 2000 }),
    ).toBe(true);
    expect(
      isUpdateAvailable(stored({ sizeBytes: 1000 }), { sizeBytes: 1000 }),
    ).toBe(false);
  });

  it("no reliable signal = no update (don't nag)", () => {
    expect(isUpdateAvailable(stored(), {})).toBe(false);
  });
});
