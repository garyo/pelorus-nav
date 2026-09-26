import { describe, expect, it } from "vitest";
import {
  continuesDownload,
  isTransientDownloadError,
  parseContentRange,
  parseResumeState,
  RESUME_MAX_AGE_MS,
  type ResumeState,
  resumeStateAfterFailure,
} from "./download-resume";
import { STALL_ERROR_NAME } from "./download-watchdog";

const ETAG = '"abc123-2"';
const NOW = 1_800_000_000_000;

describe("isTransientDownloadError", () => {
  it("retries network drops and stalls", () => {
    expect(isTransientDownloadError("TypeError")).toBe(true);
    expect(isTransientDownloadError(STALL_ERROR_NAME)).toBe(true);
  });

  it("does not retry cancels, HTTP errors or storage failures", () => {
    expect(isTransientDownloadError("AbortError")).toBe(false);
    expect(isTransientDownloadError("Error")).toBe(false);
    expect(isTransientDownloadError("QuotaExceededError")).toBe(false);
  });
});

describe("resumeStateAfterFailure", () => {
  it("records the bytes so far against a strong etag", () => {
    expect(resumeStateAfterFailure(ETAG, 400, 1000, NOW)).toEqual({
      etag: ETAG,
      bytes: 400,
      total: 1000,
      savedAt: NOW,
    });
  });

  it.each<[string, string | undefined, number, number]>([
    ["no etag", undefined, 400, 1000],
    ["a weak etag", `W/${ETAG}`, 400, 1000],
    ["no bytes yet", ETAG, 0, 1000],
    ["an unknown total", ETAG, 400, 0],
    ["every byte already there", ETAG, 1000, 1000],
  ])("is null with %s", (_case, etag, bytes, total) => {
    expect(resumeStateAfterFailure(etag, bytes, total, NOW)).toBeNull();
  });
});

describe("parseResumeState", () => {
  const state: ResumeState = {
    etag: ETAG,
    bytes: 400,
    total: 1000,
    savedAt: NOW,
  };
  const text = JSON.stringify(state);

  it("accepts a sidecar that matches its temp", () => {
    expect(parseResumeState(text, 400, NOW + 1000)).toEqual(state);
    // Bytes past the recorded point are unflushed leftovers, truncated on resume.
    expect(parseResumeState(text, 512, NOW)).toEqual(state);
  });

  it("rejects a sidecar claiming more bytes than the temp holds", () => {
    expect(parseResumeState(text, 399, NOW)).toBeNull();
  });

  it("rejects an expired sidecar", () => {
    expect(parseResumeState(text, 400, NOW + RESUME_MAX_AGE_MS + 1)).toBeNull();
  });

  it.each([
    ["torn JSON", '{"etag":"x","by'],
    ["not an object", "42"],
    [
      "a missing field",
      JSON.stringify({ etag: ETAG, bytes: 400, total: 1000 }),
    ],
    ["a weak etag", JSON.stringify({ ...state, etag: `W/${ETAG}` })],
  ])("rejects %s", (_case, bad) => {
    expect(parseResumeState(bad, 400, NOW)).toBeNull();
  });
});

describe("parseContentRange", () => {
  it("reads the start and total", () => {
    expect(parseContentRange("bytes 400-999/1000")).toEqual({
      start: 400,
      total: 1000,
    });
  });

  it.each([
    null,
    "bytes */1000",
    "bytes 400-999/*",
    "items 1-2/3",
  ])("is null for %s", (header) => {
    expect(parseContentRange(header)).toBeNull();
  });
});

describe("continuesDownload", () => {
  const resume: ResumeState = {
    etag: ETAG,
    bytes: 400,
    total: 1000,
    savedAt: NOW,
  };

  it("continues a 206 of the same build from the recorded byte", () => {
    expect(continuesDownload(resume, 206, ETAG, "bytes 400-999/1000")).toBe(
      true,
    );
  });

  it.each<[string, number, string | null, string | null]>([
    ["the whole file (Range ignored)", 200, ETAG, null],
    ["a different build", 206, '"def456-2"', "bytes 400-999/1000"],
    ["no etag", 206, null, "bytes 400-999/1000"],
    ["a different offset", 206, ETAG, "bytes 0-999/1000"],
    ["a different size", 206, ETAG, "bytes 400-1199/1200"],
    ["a server error for a range past the end", 500, null, null],
  ])("does not continue on %s", (_case, status, etag, range) => {
    expect(continuesDownload(resume, status, etag, range)).toBe(false);
  });
});
