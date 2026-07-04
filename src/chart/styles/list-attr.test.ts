import { describe, expect, it } from "vitest";
import { IHO_S52 } from "./icon-sets";
import { listAttrContains, listAttrFirstNumber } from "./list-attr";
import { evalExpr, type Props, resolveIcon } from "./test-helpers";

const contains = (attr: string, code: number, props: Props): boolean =>
  Boolean(evalExpr(listAttrContains(attr, code), props));
const first = (attr: string, props: Props): unknown =>
  evalExpr(listAttrFirstNumber(attr), props);

describe("listAttrContains", () => {
  it("matches exact codes in multi-valued lists", () => {
    expect(contains("RESTRN", 27, { RESTRN: "8,27" })).toBe(true);
    expect(contains("RESTRN", 8, { RESTRN: "8,27" })).toBe(true);
    expect(contains("RESTRN", 14, { RESTRN: "14,3" })).toBe(true);
  });

  it("never false-matches a code inside a longer code", () => {
    // The bug class from the review: bare "7" matched "27"/"17"/"14".
    expect(contains("RESTRN", 7, { RESTRN: "27" })).toBe(false);
    expect(contains("RESTRN", 7, { RESTRN: "17" })).toBe(false);
    expect(contains("RESTRN", 7, { RESTRN: "8,27" })).toBe(false);
    expect(contains("RESTRN", 1, { RESTRN: "11" })).toBe(false);
    expect(contains("RESTRN", 4, { RESTRN: "14" })).toBe(false);
  });

  it("matches single values, string or numeric (GDAL emits both)", () => {
    expect(contains("RESTRN", 7, { RESTRN: "7" })).toBe(true);
    expect(contains("RESTRN", 7, { RESTRN: 7 })).toBe(true);
    expect(contains("CATLND", 2, { CATLND: 2 })).toBe(true);
    expect(contains("CATLND", 2, { CATLND: "12" })).toBe(false);
  });

  it("is false when the attribute is missing", () => {
    expect(contains("RESTRN", 7, {})).toBe(false);
  });
});

describe("listAttrFirstNumber", () => {
  it("extracts the primary (first) value from multi-valued lists", () => {
    expect(first("CATOBS", { CATOBS: "6,7" })).toBe(6);
    expect(first("CATLMK", { CATLMK: "17,15" })).toBe(17);
  });

  it("handles single values, string or numeric", () => {
    expect(first("CATOBS", { CATOBS: "5" })).toBe(5);
    expect(first("CATOBS", { CATOBS: 5 })).toBe(5);
  });

  it("falls back to 0 when missing or empty", () => {
    expect(first("CATOBS", {})).toBe(0);
    expect(first("CATOBS", { CATOBS: "" })).toBe(0);
  });
});

describe("regressions: list attributes in real style expressions", () => {
  it("CATSPM 9/15 renders the superbuoy (was: quoted-JSON check, always false)", () => {
    expect(resolveIcon("BOYSPP", { CATSPM: "9" })).toBe(IHO_S52.superbuoy);
    expect(resolveIcon("BOYSPP", { CATSPM: "15" })).toBe(IHO_S52.superbuoy);
    expect(resolveIcon("BOYSPP", { CATSPM: "10,15" })).toBe(IHO_S52.superbuoy);
  });

  it("CATSPM 19/40 must NOT render the superbuoy (substring false-match)", () => {
    expect(resolveIcon("BOYSPP", { CATSPM: "19" })).not.toBe(IHO_S52.superbuoy);
    expect(resolveIcon("BOYSPP", { CATSPM: "40" })).not.toBe(IHO_S52.superbuoy);
  });

  it("multi-valued CATOBS resolves by its primary category (was: default icon)", () => {
    expect(resolveIcon("OBSTRN", { CATOBS: "6,7" })).toBe(
      IHO_S52["obstruction-foul"],
    );
    expect(resolveIcon("OBSTRN", { CATOBS: "1,3" })).toBe(
      IHO_S52["obstruction-fish-stakes"],
    );
    expect(resolveIcon("OBSTRN", { CATOBS: 6 })).toBe(
      IHO_S52["obstruction-foul"],
    );
  });

  it("multi-valued CATLMK resolves like its primary value (was: generic icon)", () => {
    const single = resolveIcon("LNDMRK", { CATLMK: "17" });
    expect(resolveIcon("LNDMRK", { CATLMK: "17,15" })).toBe(single);
  });

  it("foul-area fill filter accepts multi-valued CATOBS", () => {
    const foulFilter = [
      "in",
      listAttrFirstNumber("CATOBS"),
      ["literal", [6, 7]],
    ];
    expect(evalExpr(foulFilter, { CATOBS: "6,7" })).toBe(true);
    expect(evalExpr(foulFilter, { CATOBS: "7" })).toBe(true);
    expect(evalExpr(foulFilter, { CATOBS: 5 })).toBe(false);
  });
});
