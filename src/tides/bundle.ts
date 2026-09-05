/**
 * Loads and indexes the offline tides & currents bundle
 * (public/tides-stations.json, built by tools/tides/build-bundle.ts).
 */

import { haversineDistanceNM, toRadians } from "../utils/coordinates";
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

/**
 * Fetch and index the bundle once; subsequent calls share the result. A
 * failed fetch (offline) clears the cache instead of memoizing the
 * rejection, so the next call retries once connectivity returns.
 */
export function loadTidesIndex(
  url = "/tides-stations.json",
): Promise<TidesIndex> {
  indexPromise ??= fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(`tides bundle: HTTP ${r.status}`);
      return r.json() as Promise<TidesBundle>;
    })
    .then(buildIndex)
    .catch((err: unknown) => {
      indexPromise = null;
      throw err;
    });
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

/** Search radius (nautical miles) when a caller doesn't specify one. */
export const DEFAULT_NEAREST_STATION_NM = 25;

const NM_PER_DEGREE_LAT = 60;

export interface NearbyStation<S> {
  station: S;
  distanceNM: number;
}

/**
 * The `limit` nearest stations to a position within `maxNM`, nearest first.
 * A bounding box prefilters the (few thousand) stations before the exact
 * great-circle ranking.
 */
export function nearestStations<S extends StationBase>(
  stations: S[],
  lat: number,
  lon: number,
  maxNM = DEFAULT_NEAREST_STATION_NM,
  limit = 1,
): NearbyStation<S>[] {
  const dLat = maxNM / NM_PER_DEGREE_LAT;
  // Longitude degrees per nm grow towards the poles; a full sweep near them.
  const cosLat = Math.cos(toRadians(lat));
  const dLng = cosLat > 1e-6 ? Math.min(180, dLat / cosLat) : 180;
  const candidates = stationsInBounds(stations, {
    west: lon - dLng,
    south: lat - dLat,
    east: lon + dLng,
    north: lat + dLat,
  });
  const ranked: NearbyStation<S>[] = [];
  for (const station of candidates) {
    const distanceNM = haversineDistanceNM(lat, lon, station.lat, station.lng);
    if (distanceNM <= maxNM) ranked.push({ station, distanceNM });
  }
  ranked.sort((a, b) => a.distanceNM - b.distanceNM);
  return ranked.slice(0, limit);
}

/** Nearest station to a position within `maxNM`, or null if none is in range. */
export function nearestStation<S extends StationBase>(
  stations: S[],
  lat: number,
  lon: number,
  maxNM = DEFAULT_NEAREST_STATION_NM,
): S | null {
  return nearestStations(stations, lat, lon, maxNM, 1)[0]?.station ?? null;
}

/** Nearest tide station (reference or subordinate) to a position. */
export function nearestTideStation(
  index: TidesIndex,
  lat: number,
  lon: number,
  maxNM = DEFAULT_NEAREST_STATION_NM,
): TideStation | null {
  return nearestStation(index.tideStations, lat, lon, maxNM);
}

/** Nearest current station to a position, from the chart-displayed set. */
export function nearestCurrentStation(
  index: TidesIndex,
  lat: number,
  lon: number,
  maxNM = DEFAULT_NEAREST_STATION_NM,
): CurrentStation | null {
  return nearestStation(index.currentStations, lat, lon, maxNM);
}
