// @vitest-environment jsdom

import type { Map as MapLibreMap } from "maplibre-gl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DraggablePoints } from "./DraggablePoints";
import type { GeoPoint } from "./point-hit-test";

/**
 * Focused lifecycle tests. The concern is not the happy-path drag (covered by
 * E2E) but the interruption edges where a drag can end without a normal
 * touchend/mouseup and leave `dragPan` disabled — the map then can't be
 * panned for the rest of the session.
 */

type MapHandler = (e: { point: { x: number; y: number } }) => void;

/** Minimal map: identity-ish projection, a tracked dragPan, a real canvas,
 *  and captured mouse handlers so tests can drive the mouse path. */
function makeMap(): {
  map: MapLibreMap;
  canvas: HTMLCanvasElement;
  dragPanEnabled: () => boolean;
  fire: (type: string, x: number, y: number) => void;
} {
  const canvas = document.createElement("canvas");
  // getBoundingClientRect is 0×0 in jsdom by default — fine, screen coords
  // equal client coords, which is all the geometric hit test needs.
  let dragPanEnabled = true;
  const handlers = new Map<string, MapHandler>();
  const map = {
    getCanvas: () => canvas,
    getLayer: () => ({}),
    project: (ll: [number, number]) => ({ x: ll[0], y: -ll[1] }),
    unproject: ([x, y]: [number, number]) => ({ lng: x, lat: -y }),
    dragPan: {
      enable: () => {
        dragPanEnabled = true;
      },
      disable: () => {
        dragPanEnabled = false;
      },
    },
    on: (type: string, handler: MapHandler) => handlers.set(type, handler),
    off: () => {},
  } as unknown as MapLibreMap;
  const fire = (type: string, x: number, y: number) =>
    handlers.get(type)?.({
      point: { x, y },
      preventDefault: () => {},
    } as never);
  return { map, canvas, dragPanEnabled: () => dragPanEnabled, fire };
}

/** Dispatch a touch event with the given touch points (as changedTouches
 *  and touches both), since jsdom lacks the Touch/TouchEvent constructors. */
function touch(
  canvas: HTMLElement,
  type: string,
  points: { id: number; x: number; y: number }[],
): void {
  const list = points.map((p) => ({
    identifier: p.id,
    clientX: p.x,
    clientY: p.y,
  }));
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, "touches", { value: list });
  Object.defineProperty(e, "changedTouches", { value: list });
  canvas.dispatchEvent(e);
}

const POINT: GeoPoint = { lat: 0, lon: 0 }; // projects to (0, 0)

function makeDraggable(map: MapLibreMap) {
  const onDrag = vi.fn();
  const onTap = vi.fn();
  const dp = new DraggablePoints(map, "layer", onDrag, onTap, null, null, {
    getPoints: () => [POINT],
    hitRadius: 20,
  });
  return { dp, onDrag, onTap };
}

describe("DraggablePoints drag lifecycle", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("re-enables dragPan when a drag is interrupted by touchcancel", () => {
    const { map, canvas, dragPanEnabled } = makeMap();
    makeDraggable(map);

    touch(canvas, "touchstart", [{ id: 1, x: 0, y: 0 }]);
    expect(dragPanEnabled()).toBe(false); // grabbed → pan suspended

    touch(canvas, "touchcancel", [{ id: 1, x: 0, y: 0 }]);
    expect(dragPanEnabled()).toBe(true); // interruption must restore it
  });

  it("does not fire a tap when a drag is cancelled", () => {
    const { map, canvas } = makeMap();
    const { onTap } = makeDraggable(map);

    touch(canvas, "touchstart", [{ id: 1, x: 0, y: 0 }]);
    touch(canvas, "touchcancel", [{ id: 1, x: 0, y: 0 }]);
    expect(onTap).not.toHaveBeenCalled();
  });

  it("re-enables dragPan when destroyed mid-drag", () => {
    const { map, canvas, dragPanEnabled } = makeMap();
    const { dp } = makeDraggable(map);

    touch(canvas, "touchstart", [{ id: 1, x: 0, y: 0 }]);
    expect(dragPanEnabled()).toBe(false);

    dp.destroy();
    expect(dragPanEnabled()).toBe(true);
  });

  it("ignores a second finger's touchend during a drag", () => {
    const { map, canvas, dragPanEnabled } = makeMap();
    const { onTap } = makeDraggable(map);

    touch(canvas, "touchstart", [{ id: 1, x: 0, y: 0 }]); // finger 1 grabs
    // Finger 2 taps elsewhere and lifts — its touchend must not end the drag.
    touch(canvas, "touchend", [{ id: 2, x: 200, y: 200 }]);
    expect(dragPanEnabled()).toBe(false); // still dragging
    expect(onTap).not.toHaveBeenCalled();

    // Finger 1 lifting (no movement) ends the drag and taps.
    touch(canvas, "touchend", [{ id: 1, x: 0, y: 0 }]);
    expect(dragPanEnabled()).toBe(true);
    expect(onTap).toHaveBeenCalledWith(0);
  });

  it("ends a drag on a mouseup received outside the canvas", () => {
    const { map, canvas, dragPanEnabled } = makeMap();
    makeDraggable(map);

    // Grab via touch (mousedown path needs a MapMouseEvent), then release the
    // mouse on the window — the drag must still end.
    touch(canvas, "touchstart", [{ id: 1, x: 0, y: 0 }]);
    expect(dragPanEnabled()).toBe(false);

    window.dispatchEvent(new Event("mouseup"));
    expect(dragPanEnabled()).toBe(true);
  });

  it("absorbs a sub-slop mouse jiggle without dragging", () => {
    const { map, fire } = makeMap();
    const { onDrag } = makeDraggable(map);

    fire("mousedown", 0, 0); // grab the point at (0,0)
    fire("mousemove", 3, 3); // 4.2 px — under the 6 px tap slop
    expect(onDrag).not.toHaveBeenCalled();

    fire("mousemove", 8, 0); // now past slop
    expect(onDrag).toHaveBeenCalledTimes(1);
  });
});
