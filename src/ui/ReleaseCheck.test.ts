import { describe, expect, it } from "vitest";
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
