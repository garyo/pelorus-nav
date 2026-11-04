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

  it("defers to a bridge note that names its own reference", () => {
    const rows = riverDatumDetails({
      _vdat: 31,
      INFORM:
        "Primary Navigation Span. Vertical clearance 62.2 feet above 2% flowline elevation 444.7 feet.",
    });
    expect(rows).toEqual([
      { label: "Chart default", value: "Local low water reference level" },
    ]);
  });

  it("keeps the caution when the note names no reference", () => {
    const rows = riverDatumDetails({
      _vdat: 31,
      INFORM: "Primary Navigation Span",
    });
    expect(rows.map((r) => r.label)).toEqual(["Clearances from", "Caution"]);
  });

  it("adds nothing for NOAA features", () => {
    expect(riverDatumDetails({ VERCLR: 20 })).toEqual([]);
  });
});
