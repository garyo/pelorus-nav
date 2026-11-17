import { describe, expect, it } from "vitest";
import { shouldOfferBackgroundLocation } from "./background-location";

describe("shouldOfferBackgroundLocation", () => {
  it("offers it once when it isn't granted", () => {
    expect(
      shouldOfferBackgroundLocation({
        granted: false,
        asked: false,
        again: false,
      }),
    ).toBe(true);
    expect(
      shouldOfferBackgroundLocation({
        granted: false,
        asked: true,
        again: false,
      }),
    ).toBe(false);
  });

  it("offers it again when asked to, as from the interruption notice", () => {
    expect(
      shouldOfferBackgroundLocation({
        granted: false,
        asked: true,
        again: true,
      }),
    ).toBe(true);
  });

  it("never offers it when granted or unknown", () => {
    for (const granted of [true, null]) {
      expect(
        shouldOfferBackgroundLocation({ granted, asked: false, again: true }),
      ).toBe(false);
    }
  });
});
