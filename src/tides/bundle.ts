/**
 * Loads and indexes the offline tides & currents bundle
 * (public/tides-stations.json, built by tools/tides/build-bundle.ts).
 */

import type {
  CurrentRefStation,
  CurrentSubStation,
  StationBase,
  TideRefStation,
  TideSubStation,
  TidesBundle,
} from "./schema";

export type TideStation = TideRefStation | TideSubStation;
export type CurrentStation = CurrentRefStation | CurrentSubStation;

export interface TidesIndex {
  bundle: TidesBundle;
  tideRefById: Map<string, TideRefStation>;
  /** Current reference stations keyed by `${id}_${bin}`. */
  currentRefByKey: Map<string, CurrentRefStation>;
  /** Stations drawn on the chart (references' display bins + subordinates). */
  tideStations: TideStation[];
  currentStations: CurrentStation[];
}

export function isTideRef(s: TideStation): s is TideRefStation {
  return "amp" in s;
}

export function isCurrentRef(s: CurrentStation): s is CurrentRefStation {
  return "amp" in s;
}

export function buildIndex(bundle: TidesBundle): TidesIndex {
  const tideRefById = new Map(bundle.tideRef.map((s) => [s.id, s]));
  const currentRefByKey = new Map(
    bundle.currentRef.map((s) => [`${s.id}_${s.bin}`, s]),
  );
  return {
    bundle,
    tideRefById,
    currentRefByKey,
    tideStations: [...bundle.tideRef, ...bundle.tideSub],
    currentStations: [
      ...bundle.currentRef.filter((s) => s.disp),
      ...bundle.currentSub,
    ],
  };
}

let indexPromise: Promise<TidesIndex> | null = null;

/** Fetch and index the bundle once; subsequent calls share the result. */
export function loadTidesIndex(
  url = "/tides-stations.json",
): Promise<TidesIndex> {
  indexPromise ??= fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(`tides bundle: HTTP ${r.status}`);
      return r.json() as Promise<TidesBundle>;
    })
    .then(buildIndex);
  return indexPromise;
}

export interface LngLatBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Filter stations to a bounding box, tolerant of antimeridian wrap. */
export function stationsInBounds<S extends StationBase>(
  stations: S[],
  box: LngLatBox,
): S[] {
  const width = box.east - box.west;
  return stations.filter((s) => {
    if (s.lat < box.south || s.lat > box.north) return false;
    const dLng = (((s.lng - box.west) % 360) + 360) % 360;
    return dLng <= width;
  });
}
