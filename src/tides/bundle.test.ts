import { afterEach, describe, expect, it, vi } from "vitest";
import { buildIndex, stationsInBounds } from "./bundle";
import type { TidesBundle } from "./schema";

const station = (id: string, lat: number, lng: number) => ({
  id,
  name: id,
  lat,
  lng,
});

const bundle: TidesBundle = {
  version: 1,
  generated: "2026-06-05",
  constituents: ["M2"],
  tideRef: [
    { ...station("ref1", 42.0, -71.0), datum: 1.5, amp: [1], phase: [100] },
  ],
  tideSub: [
    {
      ...station("sub1", 42.1, -70.9),
      refId: "ref1",
      tHigh: 5,
      tLow: 7,
      hHigh: 0.9,
      hLow: 0.9,
      hAdjType: "R",
    },
  ],
  currentRef: [
    {
      ...station("c1", 42.3, -70.9),
      bin: 14,
      binDepth: 2.4,
      floodDir: 264,
      ebbDir: 112,
      disp: 1,
      amp: [50],
      phase: [20],
    },
    {
      ...station("c1", 42.3, -70.9),
      bin: 8,
      binDepth: 8.5,
      floodDir: 260,
      ebbDir: 110,
      amp: [40],
      phase: [25],
    },
  ],
  currentSub: [
    {
      ...station("cs1", 42.4, -70.91),
      refId: "c1",
      refBin: 8,
      floodDir: 259,
      ebbDir: 66,
      mfcTime: 85,
      sbeTime: 53,
      mecTime: -26,
      sbfTime: -31,
      mfcAmp: 0.6,
      mecAmp: 0.6,
    },
  ],
};

describe("buildIndex", () => {
  const index = buildIndex(bundle);

  it("indexes tide references by id", () => {
    expect(index.tideRefById.get("ref1")?.datum).toBe(1.5);
  });

  it("indexes current references by id and bin", () => {
    expect(index.currentRefByKey.get("c1_14")?.floodDir).toBe(264);
    expect(index.currentRefByKey.get("c1_8")?.floodDir).toBe(260);
  });

  it("shows only display bins plus subordinates on the chart", () => {
    expect(index.currentStations.map((s) => s.id)).toEqual(["c1", "cs1"]);
    expect(index.tideStations.map((s) => s.id)).toEqual(["ref1", "sub1"]);
  });
});

describe("stationsInBounds", () => {
  const stations = [
    station("boston", 42.36, -71.05),
    station("seattle", 47.6, -122.3),
    station("adak", 51.86, -176.63),
    station("attu", 52.85, 173.18),
  ];

  it("filters to a simple box", () => {
    const hits = stationsInBounds(stations, {
      west: -72,
      south: 41,
      east: -70,
      north: 43,
    });
    expect(hits.map((s) => s.id)).toEqual(["boston"]);
  });

  it("handles antimeridian-crossing boxes", () => {
    const hits = stationsInBounds(stations, {
      west: 170,
      south: 50,
      east: -175 + 360,
      north: 54,
    });
    expect(hits.map((s) => s.id).sort()).toEqual(["adak", "attu"]);
  });

  it("excludes stations outside latitude range", () => {
    const hits = stationsInBounds(stations, {
      west: -130,
      south: 45,
      east: -70,
      north: 50,
    });
    expect(hits.map((s) => s.id)).toEqual(["seattle"]);
  });
});

describe("loadTidesIndex", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("retries after a failed fetch instead of caching the rejection", async () => {
    vi.resetModules();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(new Response(JSON.stringify(bundle)));
    vi.stubGlobal("fetch", fetchMock);

    const { loadTidesIndex } = await import("./bundle");

    await expect(loadTidesIndex()).rejects.toThrow("offline");
    const index = await loadTidesIndex();
    expect(index.tideRefById.get("ref1")?.datum).toBe(1.5);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight/cached result across concurrent calls", async () => {
    vi.resetModules();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(bundle)));
    vi.stubGlobal("fetch", fetchMock);

    const { loadTidesIndex } = await import("./bundle");

    const [a, b] = await Promise.all([loadTidesIndex(), loadTidesIndex()]);
    expect(a).toBe(b);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
