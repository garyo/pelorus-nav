/**
 * Shared LIGHTS query for the light overlays (PelLightLayer,
 * LightSectorLayer) — one place for the every-region querySourceFeatures
 * sweep, which deserializes tiles synchronously on the main thread and is
 * therefore only run behind the viewport/tile-load gates.
 */

import type { Feature } from "geojson";
import type * as maplibregl from "maplibre-gl";
import { getVectorSourceIds } from "../data/chart-catalog";
import { recordScan } from "../utils/scan-perf";

/** Query LIGHTS features from every s57 vector source (best-effort). */
export function queryAllLights(map: maplibregl.Map): Feature[] {
  const start = performance.now();
  const allLights: Feature[] = [];
  for (const srcId of getVectorSourceIds()) {
    try {
      const feats = map.querySourceFeatures(srcId, {
        sourceLayer: "LIGHTS",
      });
      allLights.push(...(feats as unknown as Feature[]));
    } catch {
      // source not loaded yet
    }
  }
  recordScan("lights-query", start, allLights.length);
  return allLights;
}
