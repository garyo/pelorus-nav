import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserGeolocationProvider } from "./BrowserGeolocationProvider";
import type { NavigationData } from "./NavigationData";
import type { ProviderNotice } from "./ProviderNotice";

type ErrorCb = (err: GeolocationPositionError) => void;
type OkCb = (pos: GeolocationPosition) => void;

const fake = {
  watchOk: null as OkCb | null,
  watchError: null as ErrorCb | null,
  pollOk: null as OkCb | null,
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

function geoPos(lat = 42, lon = -71, timestamp = 1000): GeolocationPosition {
  return {
    coords: {
      latitude: lat,
      longitude: lon,
      accuracy: 5,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
    },
    timestamp,
  } as GeolocationPosition;
}

describe("BrowserGeolocationProvider error handling", () => {
  let notices: ProviderNotice[];

  beforeEach(() => {
    vi.useFakeTimers();
    fake.watchOk = null;
    fake.watchError = null;
    fake.pollOk = null;
    fake.pollError = null;
    fake.watchCount = 0;
    fake.clearCount = 0;
    fake.pollCount = 0;
    notices = [];
    vi.stubGlobal("navigator", {
      geolocation: {
        watchPosition: (ok: OkCb, err: ErrorCb) => {
          fake.watchCount++;
          fake.watchOk = ok;
          fake.watchError = err;
          return fake.watchCount;
        },
        clearWatch: () => {
          fake.clearCount++;
        },
        getCurrentPosition: (ok: OkCb, err: ErrorCb) => {
          fake.pollCount++;
          fake.pollOk = ok;
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

  it("re-emits the last fix when the watch goes silent (keeps it fresh)", () => {
    const provider = new BrowserGeolocationProvider();
    const fixes: NavigationData[] = [];
    provider.subscribe((d) => fixes.push(d));
    provider.connect();
    fake.watchOk?.(geoPos(42, -71, 1000)); // one real fix, then silence
    expect(fixes).toHaveLength(1);

    vi.advanceTimersByTime(2100); // > WATCH_KEEPALIVE_MS
    expect(fixes.length).toBeGreaterThan(1); // re-emitted
    expect(fixes.at(-1)?.latitude).toBe(42); // same position…
    expect(fixes.at(-1)?.timestamp).toBeGreaterThan(1000); // …with a fresh timestamp
  });

  it("re-emit stops after disconnect", () => {
    const provider = new BrowserGeolocationProvider();
    const fixes: NavigationData[] = [];
    provider.subscribe((d) => fixes.push(d));
    provider.connect();
    fake.watchOk?.(geoPos());
    vi.advanceTimersByTime(2100);
    const n = fixes.length;
    provider.disconnect();
    vi.advanceTimersByTime(10000);
    expect(fixes.length).toBe(n); // no re-emits once disconnected
  });

  it("re-emit is suppressed after a watch error so a real loss goes stale", () => {
    const provider = new BrowserGeolocationProvider();
    const fixes: NavigationData[] = [];
    provider.subscribe((d) => fixes.push(d));
    provider.connect();
    fake.watchOk?.(geoPos()); // one good fix…
    fake.watchError?.(geoError(2)); // …then POSITION_UNAVAILABLE (genuine loss)
    const n = fixes.length;
    vi.advanceTimersByTime(6000);
    expect(fixes.length).toBe(n); // suppressed — lets the HUD go stale
  });
});
