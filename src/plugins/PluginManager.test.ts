import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChartProvider } from "../chart/ChartProvider";
import { activatePlugin, type HostDeps } from "./host";
import { PluginManager } from "./PluginManager";
import { PLUGIN_API_VERSION, type Plugin } from "./types";

/** Minimal stub deps; overlay setup never runs because style is "not loaded". */
function makeDeps(): {
  deps: HostDeps;
  charts: string[];
  navs: string[];
} {
  const charts: string[] = [];
  const navs: string[] = [];
  const map = {
    on: () => {},
    off: () => {},
    isStyleLoaded: () => false,
    getContainer: () => ({}) as HTMLElement,
    getLayer: () => undefined,
    getSource: () => undefined,
    addSource: () => {},
    addLayer: () => {},
    removeLayer: () => {},
    queryRenderedFeatures: () => [],
  };
  const deps = {
    map,
    chartManager: { registerProvider: (p: ChartProvider) => charts.push(p.id) },
    navManager: { registerProvider: (p: { id: string }) => navs.push(p.id) },
    picks: { register: () => () => {} },
  } as unknown as HostDeps;
  return { deps, charts, navs };
}

function plugin(
  id: string,
  activate: Plugin["activate"],
  opts: {
    apiVersion?: string;
    capabilities?: Plugin["manifest"]["capabilities"];
  } = {},
): Plugin {
  return {
    manifest: {
      id,
      name: id,
      version: "1.0.0",
      apiVersion: opts.apiVersion ?? PLUGIN_API_VERSION,
      capabilities: opts.capabilities ?? [],
    },
    activate,
  };
}

describe("PluginManager", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("activates registered plugins in registration order", () => {
    const { deps } = makeDeps();
    const order: string[] = [];
    const mgr = new PluginManager(deps);
    for (const id of ["a", "b", "c"]) {
      mgr.register(plugin(id, () => void order.push(id)));
    }
    mgr.activateAll();
    expect(order).toEqual(["a", "b", "c"]);
    expect(mgr.activeCount).toBe(3);
  });

  it("rejects plugins targeting an incompatible API major version", () => {
    const { deps } = makeDeps();
    const mgr = new PluginManager(deps);
    mgr.register(plugin("ok", () => {}, { apiVersion: "1.9.0" }));
    mgr.register(plugin("future", () => {}, { apiVersion: "2.0.0" }));
    expect(mgr.registeredIds()).toEqual(["ok"]);
  });

  it("ignores duplicate plugin ids", () => {
    const { deps } = makeDeps();
    const mgr = new PluginManager(deps);
    mgr.register(plugin("dup", () => {}));
    mgr.register(plugin("dup", () => {}));
    expect(mgr.registeredIds()).toEqual(["dup"]);
  });

  it("grants only declared capabilities, throwing otherwise", () => {
    const { deps } = makeDeps();
    const provider = { id: "p" } as unknown as ChartProvider;
    const undeclared = plugin("bad", (host) => host.charts.register(provider));
    expect(() => activatePlugin(undeclared, deps)).toThrow(/capability/);

    const { deps: deps2, charts } = makeDeps();
    const declared = plugin("good", (host) => host.charts.register(provider), {
      capabilities: ["chart.provider"],
    });
    activatePlugin(declared, deps2);
    expect(charts).toEqual(["p"]);
  });

  it("survives a plugin that throws during activation", () => {
    const { deps } = makeDeps();
    const mgr = new PluginManager(deps);
    mgr.register(
      plugin("boom", () => {
        throw new Error("kaboom");
      }),
    );
    mgr.register(plugin("fine", () => {}));
    mgr.activateAll();
    expect(mgr.activeCount).toBe(1);
  });
});
