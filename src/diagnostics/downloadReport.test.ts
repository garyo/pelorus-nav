import { describe, expect, it } from "vitest";
import {
  formatDownloadDone,
  formatDownloadSection,
  formatDownloadStart,
  formatProgress,
  formatRate,
} from "./downloadReport";

const MB = 1024 * 1024;

describe("formatProgress", () => {
  it("shows bytes of total with a whole percentage", () => {
    expect(formatProgress(340 * MB, 800 * MB)).toBe(
      "340.0 MB / 800.0 MB (42%)",
    );
  });

  it("marks an unknown total", () => {
    expect(formatProgress(5 * MB, 0)).toBe("5.0 MB / ?");
  });
});

describe("formatRate", () => {
  it("shows bytes per second", () => {
    expect(formatRate(30 * MB, 10_000)).toBe("3.0 MB/s");
  });

  it("is unknown over no time", () => {
    expect(formatRate(MB, 0)).toBe("?");
  });
});

describe("formatDownloadStart", () => {
  it("describes a fresh download", () => {
    expect(formatDownloadStart(0, 800 * MB)).toBe("fresh, 800.0 MB");
    expect(formatDownloadStart(0, 0)).toBe("fresh, size unknown");
  });

  it("describes a resume by its starting byte", () => {
    expect(formatDownloadStart(200 * MB, 800 * MB)).toBe(
      "resume at 200.0 MB / 800.0 MB (25%)",
    );
  });
});

describe("formatDownloadDone", () => {
  it("rates a fresh download over its whole size", () => {
    expect(formatDownloadDone(600 * MB, 0, 200_000)).toBe(
      "600.0 MB in 3m @ 3.0 MB/s",
    );
  });

  it("rates a resumed download over the bytes it fetched", () => {
    expect(formatDownloadDone(800 * MB, 200 * MB, 200_000)).toBe(
      "800.0 MB (600.0 MB fetched) in 3m @ 3.0 MB/s",
    );
  });
});

describe("formatDownloadSection", () => {
  const now = Date.parse("2026-09-26T12:00:00Z");

  it("lists the queue, failures, updates and kept partials", () => {
    const text = formatDownloadSection(
      {
        queue: [
          {
            filename: "a.pmtiles",
            state: "downloading",
            attempts: 1,
            runs: 3,
            loaded: 340 * MB,
            total: 800 * MB,
          },
          {
            filename: "b.pmtiles",
            state: "queued",
            attempts: 0,
            runs: 0,
            loaded: 0,
            total: 0,
          },
        ],
        failures: [{ filename: "c.pmtiles", message: "HTTP 404 Not Found" }],
        pendingUpdates: 2,
      },
      [
        {
          filename: "a.pmtiles",
          bytes: 340 * MB,
          modifiedAt: now - 5_000,
          resume: null,
        },
        {
          filename: "d.pmtiles",
          bytes: 120 * MB,
          modifiedAt: now - 3 * 3_600_000,
          resume: {
            etag: '"x"',
            bytes: 120 * MB,
            total: 400 * MB,
            savedAt: now - 3 * 3_600_000,
          },
        },
      ],
      now,
    );
    expect(text.split("\n")).toEqual([
      "queue: 2",
      "  downloading a.pmtiles  340.0 MB / 800.0 MB (42%)  runs 3, retries 1",
      "  queued      b.pmtiles  not started  runs 0, retries 0",
      "failures shown: 1",
      "  c.pmtiles: HTTP 404 Not Found",
      "updates available: 2",
      "partial downloads: 2",
      "  a.pmtiles  340.0 MB, written 5s ago, no resume record",
      "  d.pmtiles  120.0 MB, written 3h ago, resume at 120.0 MB / 400.0 MB (30%)",
    ]);
  });

  it("still lists partials without the panel, and says when updates weren't checked", () => {
    expect(formatDownloadSection(null, [], now)).toBe(
      "(chart panel not wired)\npartial downloads: 0",
    );
    expect(
      formatDownloadSection(
        { queue: [], failures: [], pendingUpdates: null },
        [],
        now,
      ),
    ).toContain("updates available: (not checked this session)");
  });
});
