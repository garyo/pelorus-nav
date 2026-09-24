import type { ProbeResult } from "../navigation/signalk-probe";

/**
 * The Signal K server row's status line: what the link is doing, in words a
 * user can act on. Pure, so the wording and its grace periods are testable.
 */

/** NavigationDataManager's view of the fix: live, or why there isn't one. */
export type FixState = "fix" | "no-gps" | "no-data" | "no-fix";

export type LinkTone = "ok" | "warn" | "bad";

export interface LinkStatus {
  text: string;
  tone: LinkTone;
}

/**
 * How long a fresh connection attempt, or a fresh link without a fix yet,
 * reads as in-progress before it's reported as a problem. A LAN server
 * answers well within this; anything slower is worth telling the user about.
 */
export const SIGNALK_STATUS_GRACE_MS = 5000;

export interface SignalkLinkState {
  /** Time since the link came up, or null when it isn't connected. */
  connectedMs: number | null;
  /** Time spent trying to (re)connect, or null when not trying. */
  reconnectingMs: number | null;
  fixState: FixState;
  /** Whether the device has any network at all (navigator.onLine). */
  online: boolean;
  /** The native probe's finding after failed attempts (apps only). */
  probe: ProbeResult | null;
  /** iOS: a probe that finds "offline" while online means Local Network is denied. */
  ios: boolean;
}

/** Why a link is down when the device has no network at all. */
export const NO_NETWORK_TEXT = "No network — join the boat's WiFi";

export function signalkLinkStatus(s: SignalkLinkState): LinkStatus {
  if (s.connectedMs !== null) {
    if (s.fixState === "fix") {
      return { text: "✓ Connected, receiving position", tone: "ok" };
    }
    if (s.connectedMs < SIGNALK_STATUS_GRACE_MS) {
      return { text: "⟳ Connected, waiting for position", tone: "warn" };
    }
    return s.fixState === "no-fix"
      ? { text: "⚠ Connected, but the server has no position", tone: "warn" }
      : { text: "⚠ Connected, but no data is arriving", tone: "warn" };
  }
  if (!s.online) return { text: `✕ ${NO_NETWORK_TEXT}`, tone: "bad" };
  if (s.reconnectingMs !== null) {
    if (s.reconnectingMs < SIGNALK_STATUS_GRACE_MS) {
      return { text: "⟳ Connecting…", tone: "warn" };
    }
    return { text: `✕ ${unreachableText(s.probe, s.ios)}`, tone: "bad" };
  }
  return { text: "✕ Not connected", tone: "bad" };
}

/** Why the server can't be reached, as far as the probe could tell. */
export function unreachableText(
  probe: ProbeResult | null,
  ios: boolean,
): string {
  if (!probe) return "Can't reach the server, retrying";
  if (probe.ok) return "Server found, but its data stream won't connect";
  switch (probe.failure) {
    case "refused":
      return "Connection refused — check the port";
    case "host-not-found":
      return "Server name not found — check the address";
    case "timeout":
      return "No answer — check the address and the WiFi";
    case "no-route":
      return "Nothing answers at that address — check it, and the WiFi";
    case "offline":
      return ios
        ? "Blocked — allow Local Network for Pelorus in iOS Settings"
        : NO_NETWORK_TEXT;
    case "tls":
      return "Secure connection failed (certificate problem)";
    case "other":
      return "Can't reach the server, retrying";
  }
}
