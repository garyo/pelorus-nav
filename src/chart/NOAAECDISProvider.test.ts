import { describe, expect, it } from "vitest";
import { NOAAECDISProvider } from "./NOAAECDISProvider";

describe("NOAAECDISProvider", () => {
  const provider = new NOAAECDISProvider();

  it("has correct id and name", () => {
    expect(provider.id).toBe("noaa-ecdis");
    expect(provider.name).toBe("NOAA ECDIS Charts");
    expect(provider.type).toBe("raster");
  });

  it("returns a raster source using NOAA ENCOnline WMS endpoint", () => {
    const source = provider.getSource();
    expect(source.type).toBe("raster");
    if (source.type === "raster") {
      const url = source.tiles?.[0] ?? "";
      expect(url).toContain("ENCOnline");
      expect(url).toContain("WMSServer");
      expect(url).toContain("{bbox-epsg-3857}");
    }
  });

  it("returns NOAA ECDIS attribution", () => {
    expect(provider.getAttribution()).toContain("NOAA");
    expect(provider.getAttribution()).toContain("ECDIS");
  });
});
