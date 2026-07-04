import { describe, expect, it, vi } from "vitest";

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    getPlatform: () => "web",
    isNativePlatform: () => false,
  },
}));
vi.mock("../data/tile-store", () => ({
  listStoredCharts: () => Promise.resolve([]),
}));
vi.mock("../plugins/BackgroundGPS", () => ({
  BackgroundGPS: {
    readDiag: () => Promise.reject(new Error("not implemented")),
  },
}));

import type { Settings } from "../settings";
import {
  collectDiagnostics,
  type DiagnosticSection,
  diagnosticsFilename,
  redactSettings,
} from "./collectDiagnostics";

describe("collectDiagnostics", () => {
  it("renders sections in order with === TITLE === delimiters", async () => {
    const out = await collectDiagnostics([
      { title: "ONE", collect: () => "alpha" },
      { title: "TWO", collect: () => Promise.resolve("beta") },
    ]);
    expect(out).toBe("=== ONE ===\nalpha\n\n=== TWO ===\nbeta\n");
  });

  it("a throwing collector yields a failure note and later sections render", async () => {
    const out = await collectDiagnostics([
      {
        title: "BAD",
        collect: () => {
          throw new Error("boom");
        },
      },
      { title: "GOOD", collect: () => "fine" },
    ]);
    expect(out).toContain("=== BAD ===\n(section failed: Error: boom)");
    expect(out).toContain("=== GOOD ===\nfine");
  });

  it("a rejecting async collector is caught", async () => {
    const out = await collectDiagnostics([
      { title: "REJ", collect: () => Promise.reject(new Error("nope")) },
    ]);
    expect(out).toContain("(section failed: Error: nope)");
  });

  it("a hanging collector is cut off by the per-section timeout", async () => {
    vi.useFakeTimers();
    const hang: DiagnosticSection = {
      title: "HANG",
      collect: () => new Promise<string>(() => {}),
    };
    const resultP = collectDiagnostics([hang], 1000);
    await vi.advanceTimersByTimeAsync(1001);
    const out = await resultP;
    expect(out).toContain("(section failed: Error: timed out after 1000ms)");
    vi.useRealTimers();
  });

  it("diagnosticsFilename formats a sortable timestamped name", () => {
    const name = diagnosticsFilename(new Date("2026-07-04T15:30:12Z"));
    expect(name).toBe("pelorus-diagnostics-20260704-153012.txt");
  });
});

describe("redactSettings", () => {
  const base = {
    plugins: {
      weather: { apiKey: "sk-live-123", units: "metric" },
      other: { myToken: "abc", normal: "keep-me" },
    },
    signalkUrl: "ws://192.168.0.53:3000",
  } as unknown as Settings;

  it("redacts schema-flagged secrets and key-like names, keeps the rest", () => {
    const out = redactSettings(base, [
      {
        pluginId: "weather",
        name: "Weather",
        schema: [
          { key: "apiKey", label: "API key", type: "text", secret: true },
          { key: "units", label: "Units", type: "text" },
        ],
      },
    ]);
    const plugins = out.plugins as Record<string, Record<string, unknown>>;
    expect(plugins.weather.apiKey).toBe("(redacted)");
    expect(plugins.weather.units).toBe("metric");
    expect(plugins.other.myToken).toBe("(redacted)"); // name-based match
    expect(plugins.other.normal).toBe("keep-me");
    expect((out as unknown as { signalkUrl: string }).signalkUrl).toBe(
      "ws://192.168.0.53:3000",
    );
  });

  it("does not mutate the input", () => {
    redactSettings(base, []);
    const plugins = base.plugins as Record<string, Record<string, unknown>>;
    expect(plugins.weather.apiKey).toBe("sk-live-123");
  });
});
