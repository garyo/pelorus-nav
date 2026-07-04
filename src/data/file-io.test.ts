import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isNative: true,
  writeFile: vi.fn(),
  share: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => mocks.isNative },
}));
vi.mock("@capacitor/filesystem", () => ({
  Directory: { Cache: "CACHE" },
  Encoding: { UTF8: "utf8" },
  Filesystem: { writeFile: mocks.writeFile },
}));
vi.mock("@capacitor/share", () => ({
  Share: { share: mocks.share },
}));

import { shareOrDownloadFile } from "./file-io";

describe("shareOrDownloadFile (native)", () => {
  beforeEach(() => {
    mocks.isNative = true;
    mocks.writeFile.mockReset();
    mocks.share.mockReset();
    mocks.writeFile.mockResolvedValue({ uri: "file:///cache/x.txt" });
    mocks.share.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes the temp file and shares it, resolving 'shared'", async () => {
    const outcome = await shareOrDownloadFile(
      "hello",
      "diag.txt",
      "text/plain",
    );
    expect(outcome).toBe("shared");
    expect(mocks.writeFile).toHaveBeenCalledWith(
      expect.objectContaining({ path: "diag.txt", data: "hello" }),
    );
    expect(mocks.share).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "file:///cache/x.txt",
        title: "diag.txt",
      }),
    );
  });

  it("resolves 'cancelled' when Share rejects with 'Share canceled'", async () => {
    mocks.share.mockRejectedValue(new Error("Share canceled"));
    const outcome = await shareOrDownloadFile(
      "hello",
      "diag.txt",
      "text/plain",
    );
    expect(outcome).toBe("cancelled");
  });

  it("rethrows Filesystem.writeFile failures", async () => {
    mocks.writeFile.mockRejectedValue(new Error("disk full"));
    await expect(
      shareOrDownloadFile("hello", "diag.txt", "text/plain"),
    ).rejects.toThrow("disk full");
    expect(mocks.share).not.toHaveBeenCalled();
  });

  it("rethrows non-cancel Share failures", async () => {
    mocks.share.mockRejectedValue(new Error("no share targets"));
    await expect(
      shareOrDownloadFile("hello", "diag.txt", "text/plain"),
    ).rejects.toThrow("no share targets");
  });
});
