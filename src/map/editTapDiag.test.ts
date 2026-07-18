// @vitest-environment jsdom

import type maplibregl from "maplibre-gl";
import { beforeEach, describe, expect, it } from "vitest";
import { editTapLog, startEditTapDiag } from "./editTapDiag";

const LAYERS = { points: "pts", midpoints: "mids" };

/** Fake map: one canvas, configurable layers/features, identity-ish project. */
function fakeMap(opts: {
  layers?: string[];
  featuresAt?: (layer: string, boxed: boolean) => number;
}) {
  const canvas = document.createElement("canvas");
  canvas.width = 800;
  canvas.height = 600;
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 50, width: 400, height: 300 }) as DOMRect;
  const layers = new Set(opts.layers ?? [LAYERS.points, LAYERS.midpoints]);
  return {
    canvas,
    map: {
      getCanvas: () => canvas,
      getLayer: (id: string) => (layers.has(id) ? { id } : undefined),
      queryRenderedFeatures: (
        geom: unknown,
        o: { layers: string[] },
      ): unknown[] => {
        const n = opts.featuresAt?.(o.layers[0], Array.isArray(geom)) ?? 0;
        return new Array(n).fill({});
      },
      // 100 px per degree from origin — close waypoints project close.
      project: ([lon, lat]: [number, number]) => ({
        x: lon * 100,
        y: lat * 100,
      }),
    } as unknown as maplibregl.Map,
  };
}

function tap(canvas: HTMLCanvasElement, clientX: number, clientY: number) {
  const touch = { clientX, clientY } as Touch;
  const event = new Event("touchstart", { bubbles: true }) as TouchEvent;
  Object.defineProperty(event, "touches", { value: [touch] });
  canvas.dispatchEvent(event);
}

describe("startEditTapDiag", () => {
  beforeEach(() => {
    editTapLog.clear();
  });

  it("logs an environment line on start and a stop line on stop", () => {
    const { map } = fakeMap({});
    const stop = startEditTapDiag(map, LAYERS, () => []);
    stop();
    const text = editTapLog.toText();
    expect(text).toContain("start rect=0,50 400x300");
    expect(text).toContain("dpr=");
    expect(text).toContain("stop");
  });

  it("records tap position, hit counts, and nearest-waypoint distance", () => {
    const { map, canvas } = fakeMap({
      featuresAt: (layer, boxed) =>
        layer === LAYERS.points ? (boxed ? 1 : 5) : 0,
    });
    // Waypoint at lon=1, lat=1 → projects to (100, 100).
    const stop = startEditTapDiag(map, LAYERS, () => [{ lat: 1, lon: 1 }]);
    tap(canvas, 103, 154); // canvas-relative (103, 104): 5px from the waypoint
    stop();
    const text = editTapLog.toText();
    expect(text).toContain("touch (103,104) hits=1 mid=0 rendered=5/1");
    expect(text).toContain("near#0=5px");
  });

  it("reports a missing layer as -1, not a crash", () => {
    const { map, canvas } = fakeMap({ layers: [] });
    const stop = startEditTapDiag(map, LAYERS, () => []);
    tap(canvas, 10, 60);
    stop();
    expect(editTapLog.toText()).toContain("hits=-1 mid=-1 rendered=-1/0");
  });

  it("stops observing after the stop function runs", () => {
    const { map, canvas } = fakeMap({});
    const stop = startEditTapDiag(map, LAYERS, () => []);
    stop();
    const before = editTapLog.entryCount;
    tap(canvas, 10, 60);
    expect(editTapLog.entryCount).toBe(before);
  });
});
