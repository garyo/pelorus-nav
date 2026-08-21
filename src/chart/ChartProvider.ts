import type { LayerSpecification, SourceSpecification } from "maplibre-gl";

/** Abstract interface for a chart tile source (raster or vector). */
export interface ChartProvider {
  /** Unique identifier for this provider (e.g. "noaa-ncds", "osm"). */
  readonly id: string;
  /** Human-readable display name. */
  readonly name: string;
  /** Whether this provider serves raster or vector tiles. */
  readonly type: "raster" | "vector";
  /** Min zoom level supported. */
  readonly minZoom: number;
  /** Max zoom level supported. */
  readonly maxZoom: number;

  /** All MapLibre sources for this provider, keyed by source ID. */
  getSources(): Record<string, SourceSpecification>;
  /**
   * MapLibre layer specifications to render this source. `visibleRegionIds`, if
   * given, limits multi-region providers to those regions' layers (the rest are
   * omitted to keep the style small); omit it to include everything. `zoom`, if
   * given, lets the provider prune layers whose minzoom is too far above the
   * current zoom to render (with a margin — see VectorChartProvider); omit it
   * to include every layer regardless of zoom.
   */
  getLayers(visibleRegionIds?: string[], zoom?: number): LayerSpecification[];
  /** Attribution HTML string. */
  getAttribution(): string;
}
