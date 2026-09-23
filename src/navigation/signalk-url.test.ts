import { describe, expect, it } from "vitest";
import { signalkStreamUrl } from "./signalk-url";

const stream = (hostPort: string, scheme = "ws") =>
  `${scheme}://${hostPort}/signalk/v1/stream?subscribe=none`;

describe("signalkStreamUrl", () => {
  it("treats blank input as no server", () => {
    expect(signalkStreamUrl("")).toBeNull();
    expect(signalkStreamUrl("   ")).toBeNull();
  });

  it("completes a bare address with the default port and stream path", () => {
    expect(signalkStreamUrl("192.168.1.50")).toBe(stream("192.168.1.50:3000"));
    expect(signalkStreamUrl(" openplotter.local ")).toBe(
      stream("openplotter.local:3000"),
    );
  });

  it("keeps a port the user gave", () => {
    expect(signalkStreamUrl("192.168.1.50:3300")).toBe(
      stream("192.168.1.50:3300"),
    );
  });

  it("passes a full stream URL through", () => {
    expect(signalkStreamUrl(stream("10.0.0.5:3000"))).toBe(
      stream("10.0.0.5:3000"),
    );
    expect(signalkStreamUrl(stream("boat.example.com", "wss"))).toBe(
      stream("boat.example.com", "wss"),
    );
  });

  it("maps a copied admin page URL to the stream", () => {
    expect(signalkStreamUrl("http://192.168.1.50:3000/admin/#/dashboard")).toBe(
      stream("192.168.1.50:3000"),
    );
    expect(signalkStreamUrl("https://boat.example.com/admin/")).toBe(
      stream("boat.example.com", "wss"),
    );
  });

  it("keeps an explicit scheme's standard port rather than guessing 3000", () => {
    expect(signalkStreamUrl("ws://signalk.lan")).toBe(stream("signalk.lan"));
  });

  it("forces subscribe=none, since the provider subscribes explicitly", () => {
    expect(
      signalkStreamUrl("ws://10.0.0.5:3000/signalk/v1/stream?subscribe=all"),
    ).toBe(stream("10.0.0.5:3000"));
  });

  it("rejects input that isn't an address", () => {
    expect(signalkStreamUrl("not an address")).toBeNull();
    expect(signalkStreamUrl("boat%20x")).toBeNull();
    expect(signalkStreamUrl("ftp://10.0.0.5")).toBeNull();
    expect(signalkStreamUrl("192.168.1.50:99999")).toBeNull();
  });
});
