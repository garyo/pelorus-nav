import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isNative: true,
  writeFile: vi.fn(),
  readFile: vi.fn(),
  deleteFile: vi.fn(),
  share: vi.fn(),
  convertFileSrc: vi.fn((url: string) => `converted:${url}`),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => mocks.isNative,
    convertFileSrc: mocks.convertFileSrc,
  },
}));
vi.mock("@capacitor/filesystem", () => ({
  Directory: { Cache: "CACHE" },
  Encoding: { UTF8: "utf8" },
  Filesystem: {
    writeFile: mocks.writeFile,
    readFile: mocks.readFile,
    deleteFile: mocks.deleteFile,
  },
}));
vi.mock("@capacitor/share", () => ({
  Share: { share: mocks.share },
}));

import {
  deleteInboxCopy,
  filenameFromUrl,
  GPX_ACCEPT,
  readFileUrl,
  shareOrDownloadFile,
} from "./file-io";

describe("GPX_ACCEPT", () => {
  // iOS has no UTI for .gpx, and WebKit's picker ignores extension entries
  // once any MIME type is listed — so a MIME type here greys out every real
  // GPX file on iPhone and iPad. Keep the picker unfiltered.
  it("lists no MIME types", () => {
    expect(GPX_ACCEPT).not.toMatch(/\//);
  });
});

describe("readFileUrl", () => {
  beforeEach(() => {
    mocks.readFile.mockReset();
    mocks.convertFileSrc.mockClear();
    vi.unstubAllGlobals();
  });

  it("reads a content:// URI as UTF-8 text", async () => {
    mocks.readFile.mockResolvedValue({ data: "<gpx/>" });

    await expect(readFileUrl("content://provider/1")).resolves.toBe("<gpx/>");
    // Without the encoding the plugin hands back base64.
    expect(mocks.readFile).toHaveBeenCalledWith({
      path: "content://provider/1",
      encoding: "utf8",
    });
  });

  it("falls back to fetching the converted URL", async () => {
    mocks.readFile.mockRejectedValue(new Error("unsupported"));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, text: async () => "<gpx/>" }),
    );

    await expect(readFileUrl("file:///doc.gpx")).resolves.toBe("<gpx/>");
    expect(mocks.convertFileSrc).toHaveBeenCalledWith("file:///doc.gpx");
  });

  it("reports the original failure when both paths fail", async () => {
    mocks.readFile.mockRejectedValue(new Error("permission denied"));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("no route")));

    await expect(readFileUrl("file:///doc.gpx")).rejects.toThrow(
      "permission denied",
    );
  });
});

describe("filenameFromUrl", () => {
  it("decodes the last path segment", () => {
    expect(filenameFromUrl("file:///docs/My%20Sail.gpx")).toBe("My Sail.gpx");
  });

  it("ignores query and fragment", () => {
    expect(filenameFromUrl("content://p/track.gpx?v=2#top")).toBe("track.gpx");
  });

  it("returns null when there is no filename", () => {
    expect(filenameFromUrl("content://provider/")).toBeNull();
  });
});

describe("deleteInboxCopy", () => {
  beforeEach(() => {
    mocks.deleteFile.mockReset();
    mocks.deleteFile.mockResolvedValue(undefined);
  });

  it("deletes an iOS Inbox copy", async () => {
    await deleteInboxCopy("file:///app/Documents/Inbox/sail.gpx");
    expect(mocks.deleteFile).toHaveBeenCalled();
  });

  it("leaves files opened in place alone", async () => {
    await deleteInboxCopy("file:///iCloud/sail.gpx");
    expect(mocks.deleteFile).not.toHaveBeenCalled();
  });

  it("swallows delete failures", async () => {
    mocks.deleteFile.mockRejectedValue(new Error("gone"));
    await expect(
      deleteInboxCopy("file:///app/Documents/Inbox/sail.gpx"),
    ).resolves.toBeUndefined();
  });
});

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
