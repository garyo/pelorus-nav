import { describe, expect, it } from "vitest";
import { encAttribution, encProducer } from "./enc-producer";

describe("encProducer", () => {
  it("names NOAA and USACE charts by their agency code", () => {
    expect(encProducer(550)).toBe("NOAA");
    expect(encProducer(553)).toBe("USACE");
  });

  it("falls back to NOAA for a missing or unknown code", () => {
    expect(encProducer(undefined)).toBe("NOAA");
    expect(encProducer(999)).toBe("NOAA");
  });
});

describe("encAttribution", () => {
  it("credits each producer's charts", () => {
    expect(encAttribution("NOAA")).toContain("NOAA</a> ENC");
    expect(encAttribution("USACE")).toContain("USACE</a> Inland ENC");
  });
});
