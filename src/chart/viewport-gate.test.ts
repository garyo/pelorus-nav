import type maplibregl from "maplibre-gl";
import { describe, expect, it } from "vitest";
import {
  centerDeltaPx,
  createViewportGate,
  currentViewportSig,
  defaultGateOpts,
  type ViewportSig,
  viewportChangedMaterially,
} from "./viewport-gate";

const base: ViewportSig = { lng: -71.0, lat: 42.35, zoom: 13, bearing: 0 };

describe("viewportChangedMaterially", () => {
  it("null prev → true", () => {
    expect(viewportChangedMaterially(null, base)).toBe(true);
  });

  it("identical sig → false", () => {
    expect(viewportChangedMaterially(base, { ...base })).toBe(false);
  });

  it("zoom +0.02 → true; +0.005 → false", () => {
    expect(viewportChangedMaterially(base, { ...base, zoom: 13.02 })).toBe(
      true,
    );
    expect(viewportChangedMaterially(base, { ...base, zoom: 13.005 })).toBe(
      false,
    );
  });

  it("bearing is compared circularly", () => {
    const at350 = { ...base, bearing: 350 };
    expect(viewportChangedMaterially(at350, { ...at350, bearing: 10 })).toBe(
      true,
    ); // 20°
    expect(viewportChangedMaterially(at350, { ...at350, bearing: 355 })).toBe(
      false,
    ); // 5°
  });

  it("center move below/above centerEpsPx at fixed zoom", () => {
    // 0.01° lng at z13: worldSize = 512*2^13 = 4194304 px; 0.01/360 * that ≈ 116 px
    const moved = { ...base, lng: base.lng + 0.01 };
    expect(viewportChangedMaterially(base, moved, { centerEpsPx: 100 })).toBe(
      true,
    );
    expect(viewportChangedMaterially(base, moved, { centerEpsPx: 128 })).toBe(
      false,
    );
  });
});

describe("centerDeltaPx", () => {
  it("pins the mercator math: 0.001° lng at z13 ≈ 11.65 px", () => {
    const next = { ...base, lng: base.lng + 0.001 };
    expect(centerDeltaPx(base, next)).toBeCloseTo(
      (0.001 / 360) * 512 * 2 ** 13,
      0,
    );
  });

  it("latitude movement contributes via mercator projection", () => {
    const next = { ...base, lat: base.lat + 0.001 };
    expect(centerDeltaPx(base, next)).toBeGreaterThan(10);
  });

  it("higher zoom makes the same degree offset larger in px", () => {
    const nextLo = { ...base, lng: base.lng + 0.001, zoom: 10 };
    const nextHi = { ...base, lng: base.lng + 0.001, zoom: 14 };
    expect(centerDeltaPx({ ...base, zoom: 10 }, nextLo)).toBeLessThan(
      centerDeltaPx({ ...base, zoom: 14 }, nextHi),
    );
  });
});

function fakeMap(sig: ViewportSig, containerSize = { w: 1000, h: 800 }) {
  return {
    getCenter: () => ({ lng: sig.lng, lat: sig.lat }),
    getZoom: () => sig.zoom,
    getBearing: () => sig.bearing,
    getContainer: () => ({
      clientWidth: containerSize.w,
      clientHeight: containerSize.h,
    }),
  } as unknown as maplibregl.Map;
}

describe("currentViewportSig", () => {
  it("reads center/zoom/bearing off the map", () => {
    expect(currentViewportSig(fakeMap(base))).toEqual(base);
  });
});

describe("defaultGateOpts", () => {
  it("scales centerEpsPx to 10% of the smaller container dimension", () => {
    expect(defaultGateOpts(fakeMap(base, { w: 2000, h: 1000 }))).toEqual({
      centerEpsPx: 100,
    });
  });

  it("floors centerEpsPx at 64px for small containers", () => {
    expect(defaultGateOpts(fakeMap(base, { w: 300, h: 200 }))).toEqual({
      centerEpsPx: 64,
    });
  });
});

/** Fake map with a mutable container size and a real event-handler registry
 * (for `resize`), so tests can distinguish "container resized" from
 * "container size read again". */
function fakeMapWithResize(
  sig: ViewportSig,
  containerSize = { w: 1000, h: 800 },
) {
  const handlers: Record<string, Array<() => void>> = {};
  const size = { ...containerSize };
  const map = {
    getCenter: () => ({ lng: sig.lng, lat: sig.lat }),
    getZoom: () => sig.zoom,
    getBearing: () => sig.bearing,
    getContainer: () => ({ clientWidth: size.w, clientHeight: size.h }),
    on: (event: string, handler: () => void) => {
      handlers[event] ??= [];
      handlers[event].push(handler);
    },
    off: (event: string, handler: () => void) => {
      handlers[event] = (handlers[event] ?? []).filter((h) => h !== handler);
    },
  };
  return {
    map: map as unknown as maplibregl.Map,
    setSize(w: number, h: number) {
      size.w = w;
      size.h = h;
    },
    fireResize() {
      for (const h of handlers.resize ?? []) h();
    },
    resizeListenerCount() {
      return (handlers.resize ?? []).length;
    },
  };
}

describe("createViewportGate", () => {
  it("caches opts across calls and only refreshes on a resize event", () => {
    const { map, setSize, fireResize } = fakeMapWithResize(base, {
      w: 2000,
      h: 1000,
    });
    const gate = createViewportGate(map);
    expect(gate.opts()).toEqual({ centerEpsPx: 100 });

    // Container size changes but no resize event fires yet — cached opts
    // must not read the DOM again.
    setSize(700, 2000);
    expect(gate.opts()).toEqual({ centerEpsPx: 100 });

    fireResize();
    expect(gate.opts()).toEqual({ centerEpsPx: 70 });
  });

  it("sig() always reads the live viewport (not cached)", () => {
    const moving = { ...base };
    const { map } = fakeMapWithResize(moving);
    const gate = createViewportGate(map);
    expect(gate.sig()).toEqual(base);
    moving.lng += 1;
    expect(gate.sig()).toEqual({ ...base, lng: base.lng + 1 });
  });

  it("dispose() detaches the resize listener", () => {
    const { map, setSize, fireResize, resizeListenerCount } = fakeMapWithResize(
      base,
      { w: 2000, h: 1000 },
    );
    const gate = createViewportGate(map);
    expect(resizeListenerCount()).toBe(1);

    gate.dispose();
    expect(resizeListenerCount()).toBe(0);

    setSize(1000, 500);
    fireResize(); // no-op: listener was removed
    expect(gate.opts()).toEqual({ centerEpsPx: 100 });
  });
});
