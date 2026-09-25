import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  platform: "android",
  getInstaller: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { getPlatform: () => mocks.platform },
}));
vi.mock("../plugins/InstallSource", () => ({
  InstallSource: { getInstaller: mocks.getInstaller },
}));

import { fetchNewerRelease } from "./ReleaseCheck";

function fakeFetch(body: unknown, ok = true): typeof fetch {
  return (async () =>
    ({ ok, json: async () => body }) as Response) as unknown as typeof fetch;
}

describe("fetchNewerRelease", () => {
  it("returns the release when its tag is newer than the running version", async () => {
    const fetchFn = fakeFetch({
      tag_name: "v0.25.0",
      html_url: "https://github.com/garyo/pelorus-nav/releases/tag/v0.25.0",
    });
    await expect(fetchNewerRelease("0.24.0", fetchFn)).resolves.toEqual({
      version: "0.25.0",
      url: "https://github.com/garyo/pelorus-nav/releases/tag/v0.25.0",
    });
  });

  it("returns null when up to date or ahead of the latest release", async () => {
    const fetchFn = fakeFetch({ tag_name: "v0.24.0", html_url: "x" });
    await expect(fetchNewerRelease("0.24.0", fetchFn)).resolves.toBeNull();
    await expect(fetchNewerRelease("0.25.0", fetchFn)).resolves.toBeNull();
  });

  it("returns null on HTTP errors, malformed bodies, and thrown fetches", async () => {
    await expect(
      fetchNewerRelease("0.24.0", fakeFetch({ tag_name: "v9.0.0" }, false)),
    ).resolves.toBeNull();
    await expect(
      fetchNewerRelease("0.24.0", fakeFetch({ html_url: "x" })),
    ).resolves.toBeNull();
    const throwing = (async () => {
      throw new TypeError("offline");
    }) as unknown as typeof fetch;
    await expect(fetchNewerRelease("0.24.0", throwing)).resolves.toBeNull();
  });
});

describe("isSideloadedAndroid", () => {
  /** A fresh module, so the memoized answer doesn't leak between tests. */
  async function check(): Promise<boolean> {
    vi.resetModules();
    const { isSideloadedAndroid } = await import("./ReleaseCheck");
    return isSideloadedAndroid();
  }

  beforeEach(() => {
    mocks.platform = "android";
    mocks.getInstaller.mockReset();
  });

  it("is false for a Play Store install", async () => {
    mocks.getInstaller.mockResolvedValue({ installer: "com.android.vending" });
    await expect(check()).resolves.toBe(false);
  });

  it("is true for an APK from a browser, file manager, or adb", async () => {
    for (const installer of ["com.android.chrome", null]) {
      mocks.getInstaller.mockResolvedValue({ installer });
      await expect(check()).resolves.toBe(true);
    }
  });

  it("is false when the installer can't be read", async () => {
    mocks.getInstaller.mockRejectedValue(new Error("not implemented"));
    await expect(check()).resolves.toBe(false);
  });

  it("is false on iOS and the web without asking the plugin", async () => {
    for (const platform of ["ios", "web"]) {
      mocks.platform = platform;
      await expect(check()).resolves.toBe(false);
    }
    expect(mocks.getInstaller).not.toHaveBeenCalled();
  });
});
