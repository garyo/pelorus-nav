import { describe, expect, it } from "vitest";
import { isCompleteDownload } from "./download-completeness";

describe("isCompleteDownload", () => {
  it("treats an unknown total (0) as always complete", () => {
    expect(isCompleteDownload(0, 0)).toBe(true);
    expect(isCompleteDownload(12345, 0)).toBe(true);
  });

  it("is complete when received bytes match the expected total", () => {
    expect(isCompleteDownload(1000, 1000)).toBe(true);
  });

  it("is incomplete when the stream ended short of the expected total", () => {
    expect(isCompleteDownload(900, 1000)).toBe(false);
  });

  it("is incomplete when somehow more bytes arrived than expected", () => {
    expect(isCompleteDownload(1100, 1000)).toBe(false);
  });
});
