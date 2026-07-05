import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserGeolocationProvider } from "./BrowserGeolocationProvider";
import type { ProviderNotice } from "./ProviderNotice";

type ErrorCb = (err: GeolocationPositionError) => void;

const fake = {
  watchError: null as ErrorCb | null,
  pollError: null as ErrorCb | null,
  watchCount: 0,
  clearCount: 0,
  pollCount: 0,
};

function geoError(code: number): GeolocationPositionError {
  return {
    code,
    message: "err",
    PERMISSION_DENIED: 1,
    POSITION_UNAVAILABLE: 2,
    TIMEOUT: 3,
  } as GeolocationPositionError;
}

describe("BrowserGeolocationProvider error handling", () => {
  let notices: ProviderNotice[];

  beforeEach(() => {
    vi.useFakeTimers();
    fake.watchError = null;
    fake.pollError = null;
    fake.watchCount = 0;
    fake.clearCount = 0;
    fake.pollCount = 0;
    notices = [];
    vi.stubGlobal("navigator", {
      geolocation: {
        watchPosition: (_ok: unknown, err: ErrorCb) => {
          fake.watchCount++;
          fake.watchError = err;
          return fake.watchCount;
        },
        clearWatch: () => {
          fake.clearCount++;
        },
        getCurrentPosition: (_ok: unknown, err: ErrorCb) => {
          fake.pollCount++;
          fake.pollError = err;
        },
      },
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("PERMISSION_DENIED stops the watch, disconnects, and emits a notice", () => {
    const provider = new BrowserGeolocationProvider((n) => notices.push(n));
    provider.connect();
    expect(provider.isConnected()).toBe(true);

    fake.watchError?.(geoError(1));

    expect(provider.isConnected()).toBe(false);
    expect(fake.clearCount).toBeGreaterThan(0);
    expect(notices.some((n) => n.kind === "connect-failed")).toBe(true);
  });

  it("TIMEOUT keeps the provider connected and watching", () => {
    const provider = new BrowserGeolocationProvider((n) => notices.push(n));
    provider.connect();
    fake.watchError?.(geoError(3));
    expect(provider.isConnected()).toBe(true);
    expect(notices).toHaveLength(0);
  });

  it("reconnect() re-establishes the watch after a permission-denied disconnect (Nav-9)", () => {
    const provider = new BrowserGeolocationProvider((n) => notices.push(n));
    provider.connect();
    expect(fake.watchCount).toBe(1);

    fake.watchError?.(geoError(1)); // PERMISSION_DENIED — disconnects
    expect(provider.isConnected()).toBe(false);

    provider.reconnect();

    expect(provider.isConnected()).toBe(true);
    expect(fake.watchCount).toBe(2); // watch restarted
  });

  it("PERMISSION_DENIED in poll mode stops the poll timer", () => {
    const provider = new BrowserGeolocationProvider((n) => notices.push(n));
    provider.connect();
    provider.setDesiredIntervalMs(10000); // switch to poll mode
    expect(fake.pollCount).toBe(1);

    fake.pollError?.(geoError(1));
    expect(provider.isConnected()).toBe(false);

    vi.advanceTimersByTime(60000);
    expect(fake.pollCount).toBe(1); // no further polls after denial
    expect(notices.some((n) => n.kind === "connect-failed")).toBe(true);
  });
});
