import { describe, expect, it } from "vitest";
import {
  riverDatum,
  riverDatumDetails,
  riverDatumExplanation,
} from "./river-datum";

describe("riverDatum", () => {
  it("names the Inland ENC datums", () => {
    expect(riverDatum(31)?.name).toBe("Local low water reference level");
    expect(riverDatum(41)?.short).toBe("Ohio River Datum");
    expect(riverDatum(31)?.lowWater).toBe(true);
    expect(riverDatum(32)?.lowWater).toBe(false);
  });

  it("is null without a datum, and generic for an unlisted code", () => {
    expect(riverDatum(undefined)).toBeNull();
    expect(riverDatum(38)?.name).toBe("Datum 38");
  });

  it("warns of less clearance above a low-water reference", () => {
    const low = riverDatum(31);
    expect(low && riverDatumExplanation(low)).toContain("less clearance");
  });
});

describe("riverDatumDetails", () => {
  it("names the depth datum on depth features", () => {
    expect(riverDatumDetails({ _sdat: 41 })).toEqual([
      { label: "Depths from", value: "Ohio River Datum" },
    ]);
  });

  it("cautions on clearances from a low-water reference", () => {
    expect(riverDatumDetails({ _vdat: 31 })).toEqual([
      { label: "Clearances from", value: "Local low water reference level" },
      {
        label: "Caution",
        value: "Less clearance when the river is above this level",
      },
    ]);
  });

  it("adds nothing for NOAA features", () => {
    expect(riverDatumDetails({ VERCLR: 20 })).toEqual([]);
  });
});
