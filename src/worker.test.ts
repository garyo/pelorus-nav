import { describe, expect, it } from "vitest";
import worker, { parseRange, resolveRange } from "./worker";

type WorkerEnv = Parameters<typeof worker.fetch>[1];

const KEY = "nautical-test.pmtiles";
const DATA = new TextEncoder().encode("0123456789");

/** An R2 bucket holding DATA at KEY, with R2's range semantics: it throws
 *  for a range starting at or past the end and clamps one running past it. */
function fakeBucket(failure?: Error): R2Bucket {
  const size = DATA.length;
  const meta = {
    key: KEY,
    size,
    httpEtag: '"etag"',
    uploaded: new Date(0),
  };
  return {
    async head(key: string) {
      return key === KEY ? meta : null;
    },
    async get(key: string, options?: { range?: R2Range }) {
      if (failure) throw failure;
      if (key !== KEY) return null;
      const range = options?.range ?? { offset: 0 };
      let offset: number;
      let length: number;
      if ("suffix" in range) {
        length = Math.min(range.suffix, size);
        offset = size - length;
      } else {
        offset = range.offset ?? 0;
        length = range.length ?? size - offset;
      }
      if (offset >= size || length <= 0) {
        throw new Error("get: The requested range is not satisfiable (10039)");
      }
      const bytes = DATA.slice(offset, Math.min(offset + length, size));
      return { ...meta, body: new Response(bytes).body };
    },
  } as unknown as R2Bucket;
}

async function fetchRange(
  range: string,
  { key = KEY, bucket = fakeBucket() } = {},
): Promise<Response> {
  const request = new Request(`https://pelorus-nav.com/${key}`, {
    headers: { range, origin: "https://localhost" },
  });
  const env = { TILES: bucket } as unknown as WorkerEnv;
  return worker.fetch(request, env, {} as ExecutionContext);
}

describe("parseRange", () => {
  it("parses the three single-range forms", () => {
    expect(parseRange("bytes=2-5")).toEqual({ offset: 2, length: 4 });
    expect(parseRange("bytes=2-")).toEqual({ offset: 2 });
    expect(parseRange("bytes=-3")).toEqual({ suffix: 3 });
  });

  it("rejects malformed ranges", () => {
    for (const header of [
      "bytes=5-2",
      "bytes=-",
      "bytes=0-1,4-5",
      "items=0-1",
      "bytes=99999999999999999999-",
    ]) {
      expect(parseRange(header), header).toBeNull();
    }
  });
});

describe("resolveRange", () => {
  it("clamps to the object and rejects ranges past its end", () => {
    expect(resolveRange({ offset: 5, length: 100 }, 10)).toEqual({
      start: 5,
      end: 9,
    });
    expect(resolveRange({ suffix: 50 }, 10)).toEqual({ start: 0, end: 9 });
    expect(resolveRange({ offset: 10 }, 10)).toBeNull();
    expect(resolveRange({ suffix: 0 }, 10)).toBeNull();
    expect(resolveRange({ suffix: 1 }, 0)).toBeNull();
  });
});

describe("tile Range requests", () => {
  it.each([
    ["bytes=0-3", "bytes 0-3/10", "0123"],
    ["bytes=5-100", "bytes 5-9/10", "56789"],
    ["bytes=7-", "bytes 7-9/10", "789"],
    ["bytes=-4", "bytes 6-9/10", "6789"],
    ["bytes=-50", "bytes 0-9/10", "0123456789"],
  ])("serves %s as 206 %s", async (range, contentRange, body) => {
    const response = await fetchRange(range);
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(contentRange);
    expect(response.headers.get("content-length")).toBe(String(body.length));
    expect(await response.text()).toBe(body);
  });

  it.each([
    "bytes=999999999999-",
    "bytes=10-",
    "bytes=10-20",
    "bytes=-0",
    "bytes=5-2",
    "bytes=0-1,4-5",
  ])("answers %s with 416 and the object size", async (range) => {
    const response = await fetchRange(range);
    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe("bytes */10");
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://localhost",
    );
  });

  it("answers a missing object with 404 whatever the range", async () => {
    for (const range of ["bytes=0-3", "bytes=999999999999-", "bytes=5-2"]) {
      const response = await fetchRange(range, { key: "missing.pmtiles" });
      expect(response.status, range).toBe(404);
    }
  });

  it("propagates R2 failures unrelated to the range", async () => {
    const outage = new Error("R2 unavailable");
    await expect(
      fetchRange("bytes=0-3", { bucket: fakeBucket(outage) }),
    ).rejects.toBe(outage);
  });
});
