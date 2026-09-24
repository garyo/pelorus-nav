/**
 * Why a Signal K server can't be reached, from outside the WebView.
 *
 * Browsers deliberately hide why a WebSocket failed (the page only sees an
 * error and close code 1006, so it can't scan the network), which leaves a
 * refused port, an unknown host name and a timeout indistinguishable. The
 * native apps can do better: a plain HTTP request to the server's discovery
 * endpoint (`/signalk`) through Capacitor's native HTTP gets the operating
 * system's own error. Android reports the Java exception class as the error
 * code; iOS only its message, so that is matched by wording.
 */

import { CapacitorHttp } from "@capacitor/core";

export type ProbeFailure =
  | "refused" // nothing listening on that port
  | "host-not-found" // the name doesn't resolve
  | "timeout" // no answer at all
  | "no-route" // nothing answers at that address, or it's off this network
  | "offline" // no usable network (iOS: also a denied Local Network permission)
  | "tls" // secure connection failed (certificate)
  | "other";

export type ProbeResult =
  | { ok: true; ms: number; status: number; server: string | null }
  | { ok: false; ms: number; failure: ProbeFailure; message: string };

const PROBE_TIMEOUT_MS = 5000;
// A refused connection on a LAN comes back in milliseconds; a bare "couldn't
// connect" that took longer than this was the network looking for a device
// that isn't there (ARP/route failure), not a closed port.
const QUICK_FAILURE_MS = 1000;

/** The server's HTTP discovery URL for a ws(s):// stream URL. */
export function discoveryUrl(streamUrl: string): string {
  const url = new URL(streamUrl.replace(/^ws/i, "http"));
  return `${url.protocol}//${url.host}/signalk`;
}

/**
 * Map a native HTTP error (Android exception class, or message) to a cause.
 * `ms` is how long the request took to fail, which separates a refused port
 * from an absent host when the message doesn't say.
 */
export function classifyProbeError(
  code: string | undefined,
  message: string,
  ms: number,
): ProbeFailure {
  const refusedOrAbsent = (): ProbeFailure =>
    ms < QUICK_FAILURE_MS ? "refused" : "no-route";
  switch (code) {
    case "ConnectException":
      if (/ECONNREFUSED/.test(message)) return "refused";
      if (/ETIMEDOUT|timed out/i.test(message)) return "timeout";
      if (/EHOSTUNREACH|ENETUNREACH/.test(message)) return "no-route";
      return refusedOrAbsent();
    case "UnknownHostException":
      return "host-not-found";
    case "SocketTimeoutException":
      return "timeout";
    case "NoRouteToHostException":
      return "no-route";
    case "SSLHandshakeException":
    case "SSLPeerUnverifiedException":
      return "tls";
  }
  if (/ECONNREFUSED|refused/i.test(message)) return "refused";
  if (/could not connect to the server/i.test(message))
    return refusedOrAbsent();
  if (
    /unable to resolve host|hostname could not be found|ENOTFOUND/i.test(
      message,
    )
  ) {
    return "host-not-found";
  }
  if (/timed out|timeout/i.test(message)) return "timeout";
  if (/EHOSTUNREACH|ENETUNREACH|no route to host|unreachable/i.test(message)) {
    return "no-route";
  }
  if (
    /offline|not connected to the internet|network connection was lost/i.test(
      message,
    )
  ) {
    return "offline";
  }
  if (/certificate|SSL|TLS|secure connection/i.test(message)) return "tls";
  return "other";
}

/** Request the server's discovery document natively; never rejects. */
export async function probeSignalkServer(
  streamUrl: string,
): Promise<ProbeResult> {
  const t0 = Date.now();
  try {
    const res = await CapacitorHttp.get({
      url: discoveryUrl(streamUrl),
      connectTimeout: PROBE_TIMEOUT_MS,
      readTimeout: PROBE_TIMEOUT_MS,
    });
    const info = res.data as
      | { server?: { id?: unknown; version?: unknown } }
      | undefined;
    const server = [info?.server?.id, info?.server?.version]
      .filter((p): p is string => typeof p === "string")
      .join(" ");
    return {
      ok: true,
      ms: Date.now() - t0,
      status: res.status,
      server: server || null,
    };
  } catch (err) {
    const { code, message } = err as { code?: string; message?: string };
    const text = message ?? String(err);
    const ms = Date.now() - t0;
    return {
      ok: false,
      ms,
      failure: classifyProbeError(code, text, ms),
      message: text,
    };
  }
}

/** One log line for a probe result. */
export function describeProbe(result: ProbeResult): string {
  if (result.ok) {
    return `HTTP ${result.status}${result.server ? ` · ${result.server}` : ""} · ${result.ms} ms`;
  }
  return `${result.failure} · ${result.message} · ${result.ms} ms`;
}
