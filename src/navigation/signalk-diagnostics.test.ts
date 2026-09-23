import { describe, expect, it } from "vitest";
import {
  isSelfContext,
  SignalKDiagnostics,
  updateSource,
} from "./signalk-diagnostics";

const SELF = "vessels.urn:mrn:signalk:uuid:self-1";

const hello = {
  name: "signalk-server",
  version: "2.33.0",
  self: SELF,
  roles: ["master", "main"],
};

function delta(context: string, path: string, value: unknown) {
  return {
    context,
    updates: [
      {
        $source: "nmea0183.GP",
        timestamp: "2026-09-23T19:12:50.839Z",
        values: [{ path, value }],
      },
    ],
  };
}

describe("isSelfContext", () => {
  it("treats no context, vessels.self and the hello's self as own vessel", () => {
    expect(isSelfContext(undefined, SELF)).toBe(true);
    expect(isSelfContext("vessels.self", SELF)).toBe(true);
    expect(isSelfContext(SELF, SELF)).toBe(true);
    expect(isSelfContext("vessels.urn:mrn:imo:mmsi:367000001", SELF)).toBe(
      false,
    );
  });
});

describe("updateSource", () => {
  it("prefers $source, else builds one from the source object", () => {
    expect(updateSource({ $source: "n2k.115" })).toBe("n2k.115");
    expect(
      updateSource({
        source: { label: "ydwg", talker: "GP", type: "NMEA0183" },
      }),
    ).toBe("ydwg.GP");
    expect(updateSource({ source: { label: "can0", src: 115 } })).toBe(
      "can0.115",
    );
    expect(updateSource({})).toBeNull();
  });
});

describe("SignalKDiagnostics", () => {
  it("records the hello and own-vessel paths with their source", () => {
    const d = new SignalKDiagnostics();
    d.noteConnected(0);
    expect(d.noteMessage(hello, 0)).toBe(false);
    expect(d.hello).toEqual({
      name: "signalk-server",
      version: "2.33.0",
      self: SELF,
    });

    expect(
      d.noteMessage(
        delta(SELF, "environment.depth.belowTransducer", 18.8),
        100,
      ),
    ).toBe(true);
    expect(d.paths.get("environment.depth.belowTransducer")).toEqual({
      value: 18.8,
      source: "nmea0183.GP",
      receivedMs: 100,
    });
  });

  it("counts other vessels instead of recording their data as ours", () => {
    const d = new SignalKDiagnostics();
    d.noteConnected(0);
    d.noteMessage(hello, 0);
    const other = delta(
      "vessels.urn:mrn:imo:mmsi:367000001",
      "navigation.position",
      {
        latitude: 1,
        longitude: 2,
      },
    );
    expect(d.noteMessage(other, 1000)).toBe(false);
    expect(d.paths.has("navigation.position")).toBe(false);
    expect(d.otherVesselCount(1000)).toBe(1);
    expect(d.otherVesselCount(1000 + 60000)).toBe(0); // gone quiet
  });

  it("measures the message rate over the connection so far", () => {
    const d = new SignalKDiagnostics();
    d.noteConnected(0);
    for (let t = 0; t < 2000; t += 100) d.noteMessage(delta(SELF, "a", 1), t);
    expect(d.messageRate(2000)).toBeCloseTo(10, 5);
  });

  it("starts each connection fresh but keeps counting connections", () => {
    const d = new SignalKDiagnostics();
    d.noteConnected(0);
    d.noteMessage(hello, 0);
    d.noteMessage(delta(SELF, "a", 1), 10);
    d.noteConnected(5000);
    expect(d.connections).toBe(2);
    expect(d.paths.size).toBe(0);
    expect(d.hello.self).toBeNull();
  });
});
