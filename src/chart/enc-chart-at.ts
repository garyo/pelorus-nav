/**
 * Which ENC chart the map shows at a point. Overlapping charts' fills paint
 * over one another, so it is the chart of the topmost fill there. Symbols
 * don't decide it: every region's symbols draw above all fills, so near a
 * seam a neighbouring chart's sounding or buoy can sit on top.
 */

export interface RenderedChartFeature {
  source: string;
  layer: { type: string };
  properties: Record<string, unknown>;
}

export interface EncChartAt<F> {
  /** A feature of the chart: its AGEN gives the chart's producer. */
  feature: F;
  /** The chart's sounding datum (VERDAT code), when it names one. */
  sdat: unknown;
}

export function isEncFeature(f: RenderedChartFeature): boolean {
  return f.source.startsWith("s57-vector");
}

/**
 * The chart at a point, from the features rendered there (topmost first) and
 * those around it (to find the chart's datum when the fill at the point,
 * land say, doesn't carry it). Falls back to the topmost ENC feature nearby
 * where no chart fill is drawn at the point.
 */
export function encChartAt<F extends RenderedChartFeature>(
  atPoint: readonly F[],
  nearby: readonly F[],
): EncChartAt<F> | null {
  const feature =
    atPoint.find((f) => isEncFeature(f) && f.layer.type === "fill") ??
    nearby.find(isEncFeature);
  if (!feature) return null;
  const cell = feature.properties._cell_id;
  const sdat =
    feature.properties._sdat ??
    nearby.find(
      (f) =>
        f.source === feature.source &&
        f.properties._cell_id === cell &&
        f.properties._sdat != null,
    )?.properties._sdat;
  return { feature, sdat };
}
