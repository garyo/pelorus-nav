import type * as maplibregl from "maplibre-gl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginHost, PluginMap } from "../types";
import { WindOverlay } from "./WindOverlay";

// Barb glyphs are rasterised through a canvas at construction; none here.
vi.mock("./wind-barb", () => ({
  barbImage: () => ({
    width: 1,
    height: 1,
    data: new Uint8ClampedArray(4),
    pixelRatio: 1,
  }),
}));

/** A fake map whose bounds the test can shift, plus the source it paints into. */
function createFakeMap(west = -71, south = 42) {
  const bounds = { west, south };
  const setData = vi.fn();
  return {
    bounds,
    setData,
    getZoom: () => 8,
    getBounds: () => ({
      getWest: () => bounds.west,
      getEast: () => bounds.west + 1,
      getSouth: () => bounds.south,
      getNorth: () => bounds.south + 0.5,
    }),
    getSource: () => ({ setData }),
    hasImage: () => true,
    addImage: vi.fn(),
    getLayer: () => undefined,
    setLayoutProperty: vi.fn(),
  };
}

function createFakeHost() {
  const moveHandlers: (() => void)[] = [];
  const tickHandlers: (() => void)[] = [];
  const timeHandlers: (() => void)[] = [];
  const setStatus = vi.fn();
  const host = {
    settings: {
      isLayerGroupEnabled: () => true,
      onChange: () => () => {},
    },
    events: {
      onMapMove: (fn: () => void) => {
        moveHandlers.push(fn);
        return () => {};
      },
      onTimeTick: (fn: () => void) => {
        tickHandlers.push(fn);
        return () => {};
      },
    },
    time: {
      now: () => new Date(),
      offsetMs: () => 0,
      onChange: (fn: () => void) => {
        timeHandlers.push(fn);
        return () => {};
      },
    },
    ui: { setStatus, setLegend: vi.fn(), registerAction: vi.fn() },
    log: vi.fn(),
  };
  return {
    host: host as unknown as PluginHost,
    setStatus,
    move: () => {
      for (const fn of moveHandlers) fn();
    },
    timeChange: () => {
      for (const fn of timeHandlers) fn();
    },
  };
}

/** Open-Meteo reply: one hourly series per requested location. */
function stubFetch() {
  const fetchMock = vi.fn(async (url: string) => {
    const count =
      new URL(url).searchParams.get("latitude")?.split(",").length ?? 0;
    const baseSec = Math.floor(Date.now() / 3_600_000) * 3600;
    const series = () => ({
      hourly: {
        time: Array.from({ length: 96 }, (_, i) => baseSec + i * 3600),
        wind_speed_10m: Array.from({ length: 96 }, () => 12),
        wind_direction_10m: Array.from({ length: 96 }, () => 270),
      },
    });
    const body = count === 1 ? series() : Array.from({ length: count }, series);
    return { ok: true, status: 200, json: async () => body };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function settle(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

describe("WindOverlay fetch scheduling", () => {
  let map: ReturnType<typeof createFakeMap>;
  let fetchMock: ReturnType<typeof stubFetch>;
  let fake: ReturnType<typeof createFakeHost>;
  let overlay: WindOverlay;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.stubGlobal("navigator", { onLine: true });
    fetchMock = stubFetch();
    map = createFakeMap();
    fake = createFakeHost();
    overlay = new WindOverlay(fake.host);
    overlay.setup({
      raw: map as unknown as maplibregl.Map,
      addSource: vi.fn(),
      addLayer: vi.fn(),
    } as unknown as PluginMap);
    // Layer toggled on / style loaded: a view with nothing cached fetches now.
    overlay.update();
    await settle(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("a burst of moves into a half-cached area repaints at once but fetches once the map settles", async () => {
    map.bounds.west += 0.5; // half the old columns still cached
    const paintsBefore = map.setData.mock.calls.length;
    for (let i = 0; i < 8; i++) {
      fake.move();
      await settle(375);
    }
    expect(map.setData.mock.calls.length).toBeGreaterThan(paintsBefore);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await settle(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a view with no cached barbs at all fetches immediately", async () => {
    map.bounds.west += 10;
    fake.move();
    await settle(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not fetch while offline, and says so", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    map.bounds.west += 10;
    fake.move();
    await settle(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fake.setStatus).toHaveBeenLastCalledWith(
      "Wind barbs need Internet connectivity",
    );
  });

  it("a time-bar change repaints without fetching", async () => {
    const paintsBefore = map.setData.mock.calls.length;
    fake.timeChange();
    await settle(200);
    expect(map.setData.mock.calls.length).toBe(paintsBefore + 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
