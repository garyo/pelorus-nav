import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isNative: true,
  addListener: vi.fn(),
  readFileUrl: vi.fn(),
}));

vi.mock("@capacitor/app", () => ({
  App: { addListener: mocks.addListener },
}));
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => mocks.isNative },
}));
vi.mock("../data/file-io", () => ({
  readFileUrl: mocks.readFileUrl,
  filenameFromUrl: (url: string) => url.split("/").pop() ?? null,
}));

import {
  installFileOpenCapture,
  type OpenedFile,
  onFileOpen,
  resetFileOpenQueue,
} from "./fileOpenQueue";

/** Fire an appUrlOpen event through the registered listener. */
function emit(url: string): void {
  const handler = mocks.addListener.mock.calls[0]?.[1];
  handler({ url });
}

describe("fileOpenQueue", () => {
  beforeEach(() => {
    resetFileOpenQueue();
    mocks.isNative = true;
    mocks.addListener.mockReset();
    mocks.readFileUrl.mockReset();
    mocks.readFileUrl.mockResolvedValue("<gpx/>");
  });

  it("delivers events captured before the handler registers, in order", () => {
    installFileOpenCapture();
    emit("content://a/one.gpx");
    emit("content://a/two.gpx");

    const seen: string[] = [];
    onFileOpen((f) => {
      seen.push(f.url);
    });

    expect(seen).toEqual(["content://a/one.gpx", "content://a/two.gpx"]);
  });

  it("delivers events after the handler registers", () => {
    installFileOpenCapture();
    const seen: string[] = [];
    onFileOpen((f) => {
      seen.push(f.url);
    });

    emit("content://a/late.gpx");
    expect(seen).toEqual(["content://a/late.gpx"]);
  });

  // The Android URI grant is scoped to the receiving activity, so the bytes
  // must be secured at capture — not after the disclaimer finally clears.
  it("reads the file at capture time, not at drain time", () => {
    installFileOpenCapture();
    emit("content://a/eager.gpx");

    expect(mocks.readFileUrl).toHaveBeenCalledTimes(1);
    expect(mocks.readFileUrl).toHaveBeenCalledWith("content://a/eager.gpx");

    onFileOpen(() => {});
    expect(mocks.readFileUrl).toHaveBeenCalledTimes(1);
  });

  it("collapses duplicate URLs while queued, but not once draining", () => {
    installFileOpenCapture();
    emit("content://a/same.gpx");
    emit("content://a/same.gpx");

    const seen: string[] = [];
    onFileOpen((f) => {
      seen.push(f.url);
    });
    expect(seen).toHaveLength(1);

    // A genuine re-open of the same file must still import.
    emit("content://a/same.gpx");
    expect(seen).toHaveLength(2);
  });

  it("ignores navigation and deep-link URLs", () => {
    installFileOpenCapture();
    const seen: string[] = [];
    onFileOpen((f) => {
      seen.push(f.url);
    });

    emit("https://pelorus-nav.com/app");
    emit("http://example.com/x.gpx");
    emit("nav.pelorus.app://route/42");
    expect(seen).toEqual([]);

    emit("file:///tmp/real.gpx");
    expect(seen).toEqual(["file:///tmp/real.gpx"]);
  });

  it("does nothing on the web", () => {
    mocks.isNative = false;
    installFileOpenCapture();
    expect(mocks.addListener).not.toHaveBeenCalled();
  });

  it("delivers a file whose read failed, without an unhandled rejection", async () => {
    mocks.readFileUrl.mockRejectedValue(new Error("permission denied"));
    installFileOpenCapture();
    emit("content://a/denied.gpx");

    let delivered: OpenedFile | null = null;
    onFileOpen((f) => {
      delivered = f;
    });

    expect(delivered).not.toBeNull();
    await expect((delivered as unknown as OpenedFile).text).rejects.toThrow(
      "permission denied",
    );
  });

  it("registers the listener only once", () => {
    installFileOpenCapture();
    installFileOpenCapture();
    expect(mocks.addListener).toHaveBeenCalledTimes(1);
  });
});
