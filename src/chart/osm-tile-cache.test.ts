import { describe, expect, it } from "vitest";
import { OSM_TILE_URL_TEMPLATE, osmTileURL } from "./osm-tile-cache";

describe("osmTileURL", () => {
  it("converts an osmtiles:// URL to the upstream OSM tile URL", () => {
    expect(osmTileURL("osmtiles://12/1234/1517")).toBe(
      "https://tile.openstreetmap.org/12/1234/1517.png",
    );
    expect(osmTileURL("osmtiles://0/0/0")).toBe(
      "https://tile.openstreetmap.org/0/0/0.png",
    );
  });

  it("rejects malformed URLs", () => {
    expect(osmTileURL("osmtiles://12/1234")).toBeNull();
    expect(osmTileURL("osmtiles://12/1234/1517/extra")).toBeNull();
    expect(osmTileURL("osmtiles://a/b/c")).toBeNull();
    expect(
      osmTileURL("https://tile.openstreetmap.org/12/1234/1517.png"),
    ).toBeNull();
  });

  it("template matches the parser", () => {
    const url = OSM_TILE_URL_TEMPLATE.replace("{z}", "5")
      .replace("{x}", "9")
      .replace("{y}", "11");
    expect(osmTileURL(url)).toBe("https://tile.openstreetmap.org/5/9/11.png");
  });
});
