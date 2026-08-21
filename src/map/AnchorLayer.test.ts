// @vitest-environment jsdom
import type * as maplibregl from "maplibre-gl";
import { describe, expect, it, vi } from "vitest";
import { s52Colour } from "../chart/s52-colours";
import {
  AnchorLayer,
  type AnchorLayerState,
  anchorZonePaint,
  EINK_ALERT_RED,
  EINK_GEOMETRY_MIN_INTERVAL_MS,
  firstRouteOrWaypointLayerId,
  shouldWriteGeometry,
} from "./AnchorLayer";

describe("anchorZonePaint", () => {
  it("gives each zone a distinct colour on colour themes", () => {
    const colours = (["ok", "warn", "outside", "gray"] as const).map(
      (z) => anchorZonePaint(z, "DAY").outlineColor,
    );
    expect(new Set(colours).size).toBe(4);
  });

  it("draws ok solid and gray dashed", () => {
    expect(anchorZonePaint("ok", "DAY").outlineDash).toEqual([1, 0]);
    expect(anchorZonePaint("gray", "DAY").outlineDash).not.toEqual([1, 0]);
  });

  it("uses only black on e-ink, escalating line weight instead of hue", () => {
    const ok = anchorZonePaint("ok", "EINK");
    const warn = anchorZonePaint("warn", "EINK");
    const outside = anchorZonePaint("outside", "EINK");
    const gray = anchorZonePaint("gray", "EINK");
    // Breached states carry red for colour e-ink; the rest stay black.
    expect(ok.outlineColor).toBe("#000000");
    expect(gray.outlineColor).toBe("#000000");
    expect(warn.outlineColor).toBe(EINK_ALERT_RED);
    expect(outside.outlineColor).toBe(EINK_ALERT_RED);
    // Weight and dash still distinguish every state without colour, for
    // greyscale panels where red reads as dark grey.
    expect(outside.outlineWidth).toBeGreaterThan(warn.outlineWidth);
    expect(warn.outlineWidth).toBeGreaterThan(ok.outlineWidth);
    expect(outside.outlineDash).toEqual([1, 0]);
    expect(gray.outlineDash).not.toEqual([1, 0]);
  });
});

describe("shouldWriteGeometry", () => {
  it("always writes on colour themes", () => {
    expect(shouldWriteGeometry(false, false, 1_000, 999)).toBe(true);
  });

  it("writes the first e-ink paint unconditionally", () => {
    expect(shouldWriteGeometry(true, false, 1_000, null)).toBe(true);
  });

  it("throttles steady e-ink repaints to the interval", () => {
    const last = 100_000;
    expect(shouldWriteGeometry(true, false, last + 1_000, last)).toBe(false);
    expect(
      shouldWriteGeometry(
        true,
        false,
        last + EINK_GEOMETRY_MIN_INTERVAL_MS,
        last,
      ),
    ).toBe(true);
  });

  it("lets immediate changes through the e-ink throttle", () => {
    expect(shouldWriteGeometry(true, true, 100_001, 100_000)).toBe(true);
  });
});

describe("firstRouteOrWaypointLayerId", () => {
  it("finds the lowest route or waypoint layer", () => {
    expect(
      firstRouteOrWaypointLayerId([
        "s57-depare",
        "_route-line-abc",
        "_waypoints-points",
        "_vessel-icon",
      ]),
    ).toBe("_route-line-abc");
    expect(
      firstRouteOrWaypointLayerId(["s57-depare", "_waypoint-halo-line"]),
    ).toBe("_waypoint-halo-line");
  });

  it("returns undefined when no overlays are present", () => {
    expect(
      firstRouteOrWaypointLayerId(["s57-depare", "_vessel-icon"]),
    ).toBeUndefined();
  });
});

// --- Class-level tests against a fake map ---

// jsdom has no 2D canvas; AnchorLayer already skips icon drawing on a null
// context, this just quiets jsdom's "Not implemented" stderr noise.
vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);

class FakeSource {
  data: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
  setData = vi.fn((d: GeoJSON.FeatureCollection) => {
    this.data = d;
  });
}

/** Just enough map for AnchorLayer's source/layer bookkeeping. */
class FakeMap {
  handlers: Record<string, () => void> = {};
  sources = new Map<string, FakeSource>();
  layerAdds: { id: string; beforeId: string | undefined }[] = [];
  preexistingLayers: string[] = [];

  on = vi.fn((ev: string, cb: () => void) => {
    this.handlers[ev] = cb;
  });
  isStyleLoaded = vi.fn(() => false);
  addSource = vi.fn((id: string) => {
    this.sources.set(id, new FakeSource());
  });
  getSource = vi.fn((id: string) => this.sources.get(id));
  addLayer = vi.fn((spec: { id: string }, beforeId?: string) => {
    this.layerAdds.push({ id: spec.id, beforeId });
  });
  getLayer = vi.fn((id: string) =>
    this.preexistingLayers.includes(id) ||
    this.layerAdds.some((l) => l.id === id)
      ? { id }
      : undefined,
  );
  setPaintProperty = vi.fn();
  getStyle = vi.fn(() => ({
    layers: [
      ...this.preexistingLayers.map((id) => ({ id })),
      ...this.layerAdds.map((l) => ({ id: l.id })),
    ],
  }));
  hasImage = vi.fn(() => false);
  addImage = vi.fn();
  removeImage = vi.fn();

  styleLoad(): void {
    this.handlers["style.load"]?.();
  }
  source(id: string): FakeSource {
    const s = this.sources.get(id);
    if (!s) throw new Error(`no source ${id}`);
    return s;
  }
}

function makeLayer(fake: FakeMap): AnchorLayer {
  return new AnchorLayer(fake as unknown as maplibregl.Map);
}

const STATE: AnchorLayerState = {
  anchor: { lat: 42.35, lon: -70.95 },
  radiusM: 60,
  warnM: 15,
  zone: "ok",
  scatter: [
    { lat: 42.3501, lon: -70.9501 },
    { lat: 42.3502, lon: -70.9502 },
  ],
};

describe("AnchorLayer", () => {
  it("creates its sources and layers on style load", () => {
    const fake = new FakeMap();
    makeLayer(fake);
    fake.styleLoad();
    expect([...fake.sources.keys()]).toEqual([
      "_anchor-watch-circle",
      "_anchor-watch-ring",
      "_anchor-watch-point",
      "_anchor-watch-scatter",
    ]);
    expect(fake.layerAdds.map((l) => l.id)).toEqual([
      "_anchor-watch-fill",
      "_anchor-watch-outline",
      "_anchor-watch-ring",
      "_anchor-watch-scatter",
      "_anchor-watch-icon",
    ]);
  });

  it("inserts below existing route layers", () => {
    const fake = new FakeMap();
    fake.preexistingLayers = ["_route-line-abc", "_vessel-icon"];
    makeLayer(fake);
    fake.styleLoad();
    for (const l of fake.layerAdds) {
      expect(l.beforeId).toBe("_route-line-abc");
    }
  });

  it("holds state given before style load and repaints once loaded", () => {
    const fake = new FakeMap();
    const layer = makeLayer(fake);
    layer.update(STATE); // style not loaded yet — must not throw
    fake.styleLoad();
    expect(fake.source("_anchor-watch-circle").data.features).toHaveLength(1);
    expect(fake.source("_anchor-watch-ring").data.features).toHaveLength(1);
    expect(fake.source("_anchor-watch-point").data.features).toHaveLength(1);
    expect(fake.source("_anchor-watch-scatter").data.features).toHaveLength(2);
  });

  it("repaints retained state after a style rebuild", () => {
    const fake = new FakeMap();
    const layer = makeLayer(fake);
    fake.styleLoad();
    layer.update(STATE);
    // Style rebuild: sources come back empty, then the handler re-fires.
    fake.sources.clear();
    fake.layerAdds = [];
    fake.styleLoad();
    expect(fake.source("_anchor-watch-circle").data.features).toHaveLength(1);
    expect(fake.source("_anchor-watch-scatter").data.features).toHaveLength(2);
  });

  it("update(null) clears every source", () => {
    const fake = new FakeMap();
    const layer = makeLayer(fake);
    fake.styleLoad();
    layer.update(STATE);
    layer.update(null);
    for (const src of fake.sources.values()) {
      expect(src.data.features).toHaveLength(0);
    }
  });

  it("applies zone paint to circle outline and fill on zone change", () => {
    const fake = new FakeMap();
    const layer = makeLayer(fake);
    fake.styleLoad();
    layer.update(STATE);
    fake.setPaintProperty.mockClear();
    layer.update({ ...STATE, zone: "outside" });
    // Default test theme is day.
    expect(fake.setPaintProperty).toHaveBeenCalledWith(
      "_anchor-watch-outline",
      "line-color",
      s52Colour("UINFR", "DAY"),
    );
    expect(fake.setPaintProperty).toHaveBeenCalledWith(
      "_anchor-watch-fill",
      "fill-color",
      s52Colour("UINFR", "DAY"),
    );
  });

  it("does not reapply paint when the zone is unchanged", () => {
    const fake = new FakeMap();
    const layer = makeLayer(fake);
    fake.styleLoad();
    layer.update(STATE);
    fake.setPaintProperty.mockClear();
    layer.update({ ...STATE, scatter: [...STATE.scatter] });
    expect(fake.setPaintProperty).not.toHaveBeenCalled();
  });

  it("omits the warning ring when warnM leaves no room for it", () => {
    const fake = new FakeMap();
    const layer = makeLayer(fake);
    fake.styleLoad();
    layer.update({ ...STATE, warnM: STATE.radiusM });
    expect(fake.source("_anchor-watch-ring").data.features).toHaveLength(0);
    expect(fake.source("_anchor-watch-circle").data.features).toHaveLength(1);
  });
});
