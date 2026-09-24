import { describe, expect, it } from "vitest";
import type { ProbeFailure, ProbeResult } from "../navigation/signalk-probe";
import {
  SIGNALK_STATUS_GRACE_MS as GRACE,
  signalkLinkStatus,
  unreachableText,
} from "./signalk-status";

describe("signalkLinkStatus", () => {
  it("reports a live fix as connected", () => {
    expect(
      signalkLinkStatus({
        connectedMs: 0,
        reconnectingMs: null,
        fixState: "fix",
        online: true,
        probe: null,
        ios: false,
      }),
    ).toEqual({ text: "✓ Connected, receiving position", tone: "ok" });
  });

  it("waits out the grace period before calling a fixless link a problem", () => {
    const fresh = signalkLinkStatus({
      connectedMs: GRACE - 1,
      reconnectingMs: null,
      fixState: "no-fix",
      online: true,
      probe: null,
      ios: false,
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
        probe: null,
        ios: false,
      }).text,
    ).toMatch(/server has no position/);
    expect(
      signalkLinkStatus({
        connectedMs: GRACE,
        reconnectingMs: null,
        fixState: "no-data",
        online: true,
        probe: null,
        ios: false,
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
        probe: null,
        ios: false,
      }),
    ).toEqual({ text: "⟳ Connecting…", tone: "warn" });
    expect(
      signalkLinkStatus({
        connectedMs: null,
        reconnectingMs: GRACE,
        fixState: "no-gps",
        online: true,
        probe: null,
        ios: false,
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
        probe: null,
        ios: false,
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
        probe: null,
        ios: false,
      }).tone,
    ).toBe("bad");
  });

  it("says what the probe found once past the grace period", () => {
    const refused: ProbeResult = {
      ok: false,
      ms: 4,
      failure: "refused",
      message: "Could not connect to the server.",
    };
    expect(
      signalkLinkStatus({
        connectedMs: null,
        reconnectingMs: GRACE,
        fixState: "no-gps",
        online: true,
        probe: refused,
        ios: false,
      }),
    ).toEqual({ text: "✕ Connection refused — check the port", tone: "bad" });
  });
});

describe("unreachableText", () => {
  const failed = (failure: ProbeFailure): ProbeResult => ({
    ok: false,
    ms: 1,
    failure,
    message: "",
  });

  it("blames the Local Network permission for an iOS 'offline' while online", () => {
    expect(unreachableText(failed("offline"), true)).toMatch(/Local Network/);
    expect(unreachableText(failed("offline"), false)).toMatch(/No network/);
  });

  it("points at the stream when HTTP works but the socket doesn't", () => {
    expect(
      unreachableText({ ok: true, ms: 5, status: 200, server: null }, false),
    ).toMatch(/data stream/);
  });

  it("falls back to the generic message without a probe", () => {
    expect(unreachableText(null, false)).toBe(
      "Can't reach the server, retrying",
    );
  });
});
