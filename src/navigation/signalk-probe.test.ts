import { describe, expect, it } from "vitest";
import {
  classifyProbeError,
  describeProbe,
  discoveryUrl,
} from "./signalk-probe";

describe("discoveryUrl", () => {
  it("maps a stream URL to the server's HTTP discovery endpoint", () => {
    expect(
      discoveryUrl("ws://192.168.1.50:3000/signalk/v1/stream?subscribe=none"),
    ).toBe("http://192.168.1.50:3000/signalk");
    expect(discoveryUrl("wss://demo.signalk.org/signalk/v1/stream")).toBe(
      "https://demo.signalk.org/signalk",
    );
  });
});

describe("classifyProbeError", () => {
  it("uses Android's exception class", () => {
    expect(
      classifyProbeError(
        "ConnectException",
        "failed to connect to /192.168.1.50 (port 3999) from /192.168.1.20 (port 41234) after 5000ms: isConnected failed: ECONNREFUSED (Connection refused)",
        20,
      ),
    ).toBe("refused");
    expect(
      classifyProbeError(
        "ConnectException",
        "failed to connect to /10.9.9.9 (port 3000) after 5000ms: isConnected failed: ETIMEDOUT",
        20,
      ),
    ).toBe("timeout");
    expect(
      classifyProbeError(
        "UnknownHostException",
        'Unable to resolve host "boat.local": No address associated with hostname',
        20,
      ),
    ).toBe("host-not-found");
    expect(classifyProbeError("SocketTimeoutException", "timeout", 20)).toBe(
      "timeout",
    );
    expect(
      classifyProbeError("NoRouteToHostException", "No route to host", 20),
    ).toBe("no-route");
  });

  it("matches iOS URLSession messages by wording", () => {
    expect(
      classifyProbeError(
        "NSURLErrorDomain",
        "Could not connect to the server.",
        20,
      ),
    ).toBe("refused");
    expect(
      classifyProbeError(
        "NSURLErrorDomain",
        "A server with the specified hostname could not be found.",
        20,
      ),
    ).toBe("host-not-found");
    expect(
      classifyProbeError("NSURLErrorDomain", "The request timed out.", 20),
    ).toBe("timeout");
    expect(
      classifyProbeError(
        "NSURLErrorDomain",
        "The Internet connection appears to be offline.",
        20,
      ),
    ).toBe("offline");
    expect(
      classifyProbeError(
        "NSURLErrorDomain",
        "An SSL error has occurred and a secure connection to the server cannot be made.",
        20,
      ),
    ).toBe("tls");
  });

  it("tells a refused port from an absent host by how long it took", () => {
    const bare = "Failed to connect to /192.168.0.250:3000";
    expect(classifyProbeError("ConnectException", bare, 27)).toBe("refused");
    expect(classifyProbeError("ConnectException", bare, 2305)).toBe("no-route");
    const ios = "Could not connect to the server.";
    expect(classifyProbeError("NSURLErrorDomain", ios, 3000)).toBe("no-route");
  });

  it("falls back to other", () => {
    expect(classifyProbeError(undefined, "something odd", 20)).toBe("other");
  });
});

describe("describeProbe", () => {
  it("summarizes both outcomes on one line", () => {
    expect(
      describeProbe({
        ok: true,
        ms: 12,
        status: 200,
        server: "signalk-server-node 2.33.0",
      }),
    ).toBe("HTTP 200 · signalk-server-node 2.33.0 · 12 ms");
    expect(
      describeProbe({
        ok: false,
        ms: 9,
        failure: "refused",
        message: "Could not connect to the server.",
      }),
    ).toBe("refused · Could not connect to the server. · 9 ms");
  });
});
