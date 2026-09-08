import { describe, expect, it } from "vitest";
import { isNewerVersion } from "./version";

describe("isNewerVersion", () => {
  it("compares numerically, component by component", () => {
    expect(isNewerVersion("0.25.0", "0.24.0")).toBe(true);
    expect(isNewerVersion("0.24.1", "0.24.0")).toBe(true);
    expect(isNewerVersion("1.0.0", "0.99.9")).toBe(true);
    expect(isNewerVersion("0.24.0", "0.24.0")).toBe(false);
    expect(isNewerVersion("0.23.9", "0.24.0")).toBe(false);
    expect(isNewerVersion("0.9.0", "0.10.0")).toBe(false);
  });

  it("ignores a leading v and a pre-release suffix", () => {
    expect(isNewerVersion("v0.25.0", "0.24.0")).toBe(true);
    expect(isNewerVersion("0.25.0", "0.25.0-beta.1")).toBe(false);
    expect(isNewerVersion("v0.24.0", "0.24.0")).toBe(false);
  });

  it("treats missing or garbage components as 0", () => {
    expect(isNewerVersion("0.25", "0.24.3")).toBe(true);
    expect(isNewerVersion("0.24", "0.24.0")).toBe(false);
    expect(isNewerVersion("junk", "0.24.0")).toBe(false);
  });
});
