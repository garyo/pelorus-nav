import { describe, expect, it } from "vitest";
import { isConnectivityError } from "./wind-net";

describe("isConnectivityError", () => {
  it("treats a fetch network TypeError as a connectivity error", () => {
    // Chromium wording
    expect(isConnectivityError(new TypeError("Failed to fetch"), true)).toBe(
      true,
    );
    // iOS Safari / WKWebView wording
    expect(isConnectivityError(new TypeError("Load failed"), true)).toBe(true);
  });

  it("treats navigator offline as a connectivity error regardless of the error", () => {
    expect(isConnectivityError(new Error("rate-limited"), false)).toBe(true);
    expect(isConnectivityError(undefined, false)).toBe(true);
  });

  it("does NOT misclassify a rate-limit / server error as connectivity", () => {
    // These are the explicit throws in fetchPoints — plain Errors, online.
    expect(isConnectivityError(new Error("rate-limited"), true)).toBe(false);
    expect(isConnectivityError(new Error("Open-Meteo HTTP 500"), true)).toBe(
      false,
    );
  });
});
