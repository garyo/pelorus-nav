import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  getPluginSetting,
  getPluginSettingsSchemas,
  onSettingsChange,
  registerPluginSettingsSchema,
  setPluginSetting,
} from "./settings";

beforeAll(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  });
});

describe("plugin settings namespace", () => {
  it("persists and reads back per-plugin keys independently", () => {
    expect(getPluginSetting("test.p1", "k")).toBeUndefined();
    setPluginSetting("test.p1", "k", 42);
    setPluginSetting("test.p1", "k2", "hi");
    setPluginSetting("test.p2", "k", "other");
    expect(getPluginSetting<number>("test.p1", "k")).toBe(42);
    expect(getPluginSetting<string>("test.p1", "k2")).toBe("hi");
    expect(getPluginSetting<string>("test.p2", "k")).toBe("other");
  });

  it("notifies settings listeners on a plugin setting change", () => {
    let fired = 0;
    const off = onSettingsChange(() => {
      fired++;
    });
    setPluginSetting("test.p3", "x", 1);
    off();
    expect(fired).toBeGreaterThan(0);
  });

  it("registers a settings schema once per plugin", () => {
    registerPluginSettingsSchema("test.p4", "P4", [
      { key: "a", label: "A", type: "toggle" },
    ]);
    registerPluginSettingsSchema("test.p4", "P4 duplicate", []);
    const found = getPluginSettingsSchemas().filter(
      (s) => s.pluginId === "test.p4",
    );
    expect(found).toHaveLength(1);
    expect(found[0].name).toBe("P4");
  });
});
