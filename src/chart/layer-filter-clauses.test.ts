import type * as maplibregl from "maplibre-gl";
import { describe, expect, it } from "vitest";
import {
  getLayerFilterClauses,
  LayerFilterClauses,
} from "./layer-filter-clauses";

type Filter = maplibregl.FilterSpecification;

/** Minimal map double: layers with filters, plus style.load listeners. */
function fakeMap(layers: Record<string, Filter | null>) {
  const filters = new Map(Object.entries(layers));
  const listeners: (() => void)[] = [];
  let setFilterCalls = 0;
  const map = {
    getLayer: (id: string) => (filters.has(id) ? { id } : undefined),
    getFilter: (id: string) => filters.get(id) ?? undefined,
    setFilter: (id: string, f: Filter | null) => {
      setFilterCalls++;
      filters.set(id, f);
    },
    on: (_event: string, cb: () => void) => listeners.push(cb),
  } as unknown as maplibregl.Map;
  return {
    map,
    filters,
    styleLoad: () => {
      for (const cb of listeners) cb();
    },
    get setFilterCalls() {
      return setFilterCalls;
    },
  };
}

const A: Filter = ["==", ["get", "x"], 1] as unknown as Filter;
const B: Filter = ["==", ["get", "y"], 2] as unknown as Filter;
const ORIGINAL: Filter = [">=", ["zoom"], 10] as unknown as Filter;

describe("LayerFilterClauses", () => {
  it("composes clauses onto the style-time filter", () => {
    const m = fakeMap({ lights: ORIGINAL });
    const c = new LayerFilterClauses(m.map);
    expect(c.set("lights", "a", A)).toBe(true);
    expect(m.filters.get("lights")).toEqual(["all", ORIGINAL, A]);
    c.set("lights", "b", B);
    expect(m.filters.get("lights")).toEqual(["all", ORIGINAL, A, B]);
  });

  it("removes one clause without touching the others", () => {
    const m = fakeMap({ lights: ORIGINAL });
    const c = new LayerFilterClauses(m.map);
    c.set("lights", "a", A);
    c.set("lights", "b", B);
    c.set("lights", "a", null);
    expect(m.filters.get("lights")).toEqual(["all", ORIGINAL, B]);
    c.set("lights", "b", null);
    expect(m.filters.get("lights")).toEqual(ORIGINAL);
  });

  it("uses a lone clause as the whole filter on a layer with none", () => {
    const m = fakeMap({ glow: null });
    const c = new LayerFilterClauses(m.map);
    c.set("glow", "a", A);
    expect(m.filters.get("glow")).toEqual(A);
    c.set("glow", "a", null);
    expect(m.filters.get("glow")).toBeNull();
  });

  it("is a no-op for an identical clause or an unknown layer", () => {
    const m = fakeMap({ lights: ORIGINAL });
    const c = new LayerFilterClauses(m.map);
    c.set("lights", "a", A);
    const calls = m.setFilterCalls;
    expect(c.set("lights", "a", structuredClone(A))).toBe(false);
    expect(c.set("missing", "a", A)).toBe(false);
    expect(m.setFilterCalls).toBe(calls);
  });

  it("keeps its clauses through style.load and restores them on reassert", () => {
    const m = fakeMap({ lights: ORIGINAL });
    const c = new LayerFilterClauses(m.map);
    c.set("lights", "a", A);
    // The reloaded style comes back with a (possibly new) style-time filter.
    const NEW_ORIGINAL = [">=", ["zoom"], 8] as unknown as Filter;
    m.filters.set("lights", NEW_ORIGINAL);
    m.styleLoad();
    expect(c.reassert(["lights"])).toBe(1);
    expect(m.filters.get("lights")).toEqual(["all", NEW_ORIGINAL, A]);
    // A fresh set after the load composes onto the new style-time filter too.
    c.set("lights", "b", B);
    expect(m.filters.get("lights")).toEqual(["all", NEW_ORIGINAL, A, B]);
  });

  it("re-applies every clause after a diffed style refresh reset the filter", () => {
    const m = fakeMap({ lights: ORIGINAL });
    const c = new LayerFilterClauses(m.map);
    c.set("lights", "a", A);
    c.set("lights", "b", B);
    // A diffed setStyle puts a new style-time filter back without style.load.
    const NEW_ORIGINAL = [">=", ["zoom"], 8] as unknown as Filter;
    m.filters.set("lights", NEW_ORIGINAL);
    // The next set, even with an unchanged clause, restores everything.
    expect(c.set("lights", "a", A)).toBe(true);
    expect(m.filters.get("lights")).toEqual(["all", NEW_ORIGINAL, A, B]);
  });

  it("reassert restores held clauses after a refresh, and is a no-op otherwise", () => {
    const m = fakeMap({ lights: ORIGINAL, glow: null });
    const c = new LayerFilterClauses(m.map);
    c.set("lights", "a", A);
    c.set("glow", "a", A);
    expect(c.reassert(["lights", "glow"])).toBe(0);
    const NEW_ORIGINAL = [">=", ["zoom"], 8] as unknown as Filter;
    m.filters.set("lights", NEW_ORIGINAL);
    expect(c.reassert(["lights", "glow", "missing"])).toBe(1);
    expect(m.filters.get("lights")).toEqual(["all", NEW_ORIGINAL, A]);
    expect(m.filters.get("glow")).toEqual(A);
  });

  it("hands out one composer per map", () => {
    const m = fakeMap({});
    expect(getLayerFilterClauses(m.map)).toBe(getLayerFilterClauses(m.map));
  });
});
