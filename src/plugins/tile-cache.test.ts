import { describe, expect, it } from "vitest";
import { parseTileRequest } from "./tile-cache";

describe("parseTileRequest", () => {
  it("parses scheme://<rest>/<z>/<x>/<y>", () => {
    expect(parseTileRequest("owmtiles", "owmtiles://wind_new/4/2/3")).toEqual({
      rest: "wind_new",
      z: 4,
      x: 2,
      y: 3,
    });
  });

  it("keeps a multi-segment rest (layer + cache-bust nonce)", () => {
    expect(parseTileRequest("owmtiles", "owmtiles://wind_new/7/5/3/2")).toEqual(
      {
        rest: "wind_new/7",
        z: 5,
        x: 3,
        y: 2,
      },
    );
  });

  it("returns null for other schemes or malformed urls", () => {
    expect(parseTileRequest("owmtiles", "osmtiles://4/2/3")).toBeNull();
    expect(parseTileRequest("owmtiles", "owmtiles://justrest")).toBeNull();
    expect(parseTileRequest("owmtiles", "owmtiles://r/4/2")).toBeNull();
  });
});
