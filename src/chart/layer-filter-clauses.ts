/**
 * Runtime filter clauses composed onto style layers.
 *
 * A MapLibre layer has one filter, but a controller that narrows a layer at
 * runtime (PelLightLayer hides PEL children from the lights layers) must
 * not clobber the style's own filter, nor another controller's. Each
 * controller owns a keyed clause here and the layer's filter is rebuilt as
 * `["all", <style-time filter>, ...clauses]`.
 *
 * Any setStyle, full or diffed (ChartManager.refreshStyle fires
 * `style.load` either way), puts the style-time filters back and drops
 * what was set at runtime. The composer keeps its clauses through that and
 * only forgets which style-time filter it captured; `set` and `reassert`
 * then take the layer's current filter as the style-time one and re-apply
 * every clause held for the layer. Controllers call `reassert` after a
 * style load (or set a fresh clause) to restore their state promptly.
 */

import type * as maplibregl from "maplibre-gl";

type Filter = maplibregl.FilterSpecification;

export class LayerFilterClauses {
  /** The style-time filter of each touched layer, captured on first touch. */
  private readonly originals = new Map<string, Filter | null>();
  /** layer id → clause key → clause. */
  private readonly clauses = new Map<string, Map<string, Filter>>();
  /** The composed filter we last passed to setFilter, per layer. */
  private readonly applied = new Map<string, Filter | null>();

  private readonly map: maplibregl.Map;

  constructor(map: maplibregl.Map) {
    this.map = map;
    map.on("style.load", () => {
      this.originals.clear();
      this.applied.clear();
    });
  }

  /**
   * Set one keyed clause on a layer (null removes it). Returns whether the
   * layer's filter changed; an identical clause is a no-op, since setFilter
   * re-lays the layer out.
   */
  set(layerId: string, key: string, clause: Filter | null): boolean {
    if (!this.map.getLayer(layerId)) return false;
    const reset = this.noteReset(layerId);
    const layerClauses = this.clauses.get(layerId) ?? new Map<string, Filter>();
    const prev = layerClauses.get(key) ?? null;
    if (!reset && same(prev, clause)) return false;
    if (clause === null) layerClauses.delete(key);
    else layerClauses.set(key, clause);
    this.clauses.set(layerId, layerClauses);
    this.compose(layerId, layerClauses);
    return true;
  }

  /**
   * Re-apply the clauses held for these layers wherever a style load or
   * refresh has put the style-time filter back. Returns how many layers
   * were restored.
   */
  reassert(layerIds: readonly string[]): number {
    let restored = 0;
    for (const layerId of layerIds) {
      const layerClauses = this.clauses.get(layerId);
      if (!layerClauses?.size || !this.map.getLayer(layerId)) continue;
      const hadApplied = this.applied.has(layerId);
      const reset = this.noteReset(layerId);
      if (hadApplied && !reset) continue;
      this.compose(layerId, layerClauses);
      restored++;
    }
    return restored;
  }

  /**
   * Capture the layer's style-time filter on first touch (or first touch
   * after a style load), and again when the filter is no longer the one we
   * last applied.
   */
  private noteReset(layerId: string): boolean {
    const current = this.map.getFilter(layerId) ?? null;
    const reset =
      this.applied.has(layerId) && !same(current, this.applied.get(layerId));
    if (reset || !this.originals.has(layerId)) {
      this.originals.set(layerId, current);
    }
    return reset;
  }

  private compose(layerId: string, layerClauses: Map<string, Filter>): void {
    const parts: Filter[] = [];
    const original = this.originals.get(layerId);
    if (original) parts.push(original);
    parts.push(...layerClauses.values());
    const composed =
      parts.length === 0
        ? null
        : parts.length === 1
          ? parts[0]
          : (["all", ...parts] as unknown as Filter);
    this.map.setFilter(layerId, composed);
    this.applied.set(layerId, composed);
  }
}

function same(a: Filter | null | undefined, b: Filter | null | undefined) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

const composers = new WeakMap<maplibregl.Map, LayerFilterClauses>();

/** The one composer for a map; create it before registering style.load handlers. */
export function getLayerFilterClauses(map: maplibregl.Map): LayerFilterClauses {
  let composer = composers.get(map);
  if (!composer) {
    composer = new LayerFilterClauses(map);
    composers.set(map, composer);
  }
  return composer;
}
