import { describe, expect, it } from "vitest";
import { shouldOfferNoGpsHint } from "./NoGpsHint";

const base = {
  native: false,
  gpsSource: "none",
  hasFix: false,
  dismissed: false,
};

describe("shouldOfferNoGpsHint", () => {
  it("offers it in a browser with no source and no fix", () => {
    expect(shouldOfferNoGpsHint(base)).toBe(true);
  });

  it("offers it when the browser's own location never arrives", () => {
    expect(shouldOfferNoGpsHint({ ...base, gpsSource: "browser-gps" })).toBe(
      true,
    );
  });

  it("stays quiet in the native apps", () => {
    expect(shouldOfferNoGpsHint({ ...base, native: true })).toBe(false);
  });

  it("stays quiet with a fix, a chosen receiver or the simulator", () => {
    expect(shouldOfferNoGpsHint({ ...base, hasFix: true })).toBe(false);
    expect(shouldOfferNoGpsHint({ ...base, gpsSource: "web-serial" })).toBe(
      false,
    );
    expect(shouldOfferNoGpsHint({ ...base, gpsSource: "simulator" })).toBe(
      false,
    );
  });

  it("stays quiet once dismissed", () => {
    expect(shouldOfferNoGpsHint({ ...base, dismissed: true })).toBe(false);
  });
});
