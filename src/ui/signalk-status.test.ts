import { describe, expect, it } from "vitest";
import {
  SIGNALK_STATUS_GRACE_MS as GRACE,
  signalkLinkStatus,
} from "./signalk-status";

describe("signalkLinkStatus", () => {
  it("reports a live fix as connected", () => {
    expect(
      signalkLinkStatus({
        connectedMs: 0,
        reconnectingMs: null,
        fixState: "fix",
        online: true,
      }),
    ).toEqual({ text: "✓ Connected, receiving position", tone: "ok" });
  });

  it("waits out the grace period before calling a fixless link a problem", () => {
    const fresh = signalkLinkStatus({
      connectedMs: GRACE - 1,
      reconnectingMs: null,
      fixState: "no-fix",
      online: true,
    });
    expect(fresh.tone).toBe("warn");
    expect(fresh.text).toMatch(/waiting for position/);
  });

  it("says why a settled link has no fix", () => {
    expect(
      signalkLinkStatus({
        connectedMs: GRACE,
        reconnectingMs: null,
        fixState: "no-fix",
        online: true,
      }).text,
    ).toMatch(/server has no position/);
    expect(
      signalkLinkStatus({
        connectedMs: GRACE,
        reconnectingMs: null,
        fixState: "no-data",
        online: true,
      }).text,
    ).toMatch(/no data is arriving/);
  });

  it("shows a short attempt as connecting, a long one as unreachable", () => {
    expect(
      signalkLinkStatus({
        connectedMs: null,
        reconnectingMs: 0,
        fixState: "no-gps",
        online: true,
      }),
    ).toEqual({ text: "⟳ Connecting…", tone: "warn" });
    expect(
      signalkLinkStatus({
        connectedMs: null,
        reconnectingMs: GRACE,
        fixState: "no-gps",
        online: true,
      }),
    ).toEqual({ text: "✕ Can't reach the server, retrying", tone: "bad" });
  });

  it("says when the device has no network at all", () => {
    expect(
      signalkLinkStatus({
        connectedMs: null,
        reconnectingMs: 0,
        fixState: "no-gps",
        online: false,
      }),
    ).toEqual({ text: "✕ No network — join the boat's WiFi", tone: "bad" });
  });

  it("reports an idle link as not connected", () => {
    expect(
      signalkLinkStatus({
        connectedMs: null,
        reconnectingMs: null,
        fixState: "no-gps",
        online: true,
      }).tone,
    ).toBe("bad");
  });
});
