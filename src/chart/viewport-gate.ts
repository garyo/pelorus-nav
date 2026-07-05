/**
 * Material-viewport-change predicate for expensive map-derived rebuilds
 * (light layers, safety-contour scans).
 *
 * In follow/course-up modes `jumpTo` runs per rendered frame and fires
 * `moveend` ~10 Hz underway — far too often for consumers that re-query
 * source features. But MapLibre fires NO event when cached tiles re-enter
 * the view (only network/worker loads emit `sourcedata`), so moveend can't
 * simply be dropped: it must be gated on the viewport having moved enough
 * since the consumer's last rebuild that the visible feature set may differ.
 */

import type maplibregl from "maplibre-gl";
import { circularDistanceDeg } from "../navigation/CourseSmoothing";

export interface ViewportSig {
  lng: number;
  lat: number;
  zoom: number;
  bearing: number;
}

export interface ViewportGateOpts {
  /** Any real zoom matters to zoom-dependent geometry. */
  zoomEps?: number;
  /** Bearing only shifts which tiles are in view — generous threshold. */
  bearingEpsDeg?: number;
  /** Center movement in screen pixels at the current zoom. */
  centerEpsPx?: number;
}

const DEFAULTS = { zoomEps: 0.01, bearingEpsDeg: 15, centerEpsPx: 128 };

/** Web-mercator Y in [0,1] for a latitude in degrees. */
function mercY(latDeg: number): number {
  return (
    0.5 -
    Math.log(Math.tan(Math.PI / 4 + (latDeg * Math.PI) / 360)) / (2 * Math.PI)
  );
}

/** Screen-pixel distance between two centers at `next.zoom`. */
export function centerDeltaPx(prev: ViewportSig, next: ViewportSig): number {
  const worldSize = 512 * 2 ** next.zoom;
  const dx = ((next.lng - prev.lng) / 360) * worldSize;
  const dy = (mercY(next.lat) - mercY(prev.lat)) * worldSize;
  return Math.hypot(dx, dy);
}

/** True when the viewport moved enough that the visible features may differ. */
export function viewportChangedMaterially(
  prev: ViewportSig | null,
  next: ViewportSig,
  opts?: ViewportGateOpts,
): boolean {
  if (prev === null) return true;
  const o = { ...DEFAULTS, ...opts };
  return (
    Math.abs(next.zoom - prev.zoom) >= o.zoomEps ||
    circularDistanceDeg(next.bearing, prev.bearing) >= o.bearingEpsDeg ||
    centerDeltaPx(prev, next) >= o.centerEpsPx
  );
}

/** The map's current viewport signature. */
export function currentViewportSig(map: maplibregl.Map): ViewportSig {
  const c = map.getCenter();
  return {
    lng: c.lng,
    lat: c.lat,
    zoom: map.getZoom(),
    bearing: map.getBearing(),
  };
}

/** Gate options scaled to the map container size (min 64px). */
export function defaultGateOpts(map: maplibregl.Map): ViewportGateOpts {
  const el = map.getContainer();
  return {
    centerEpsPx: Math.max(64, 0.1 * Math.min(el.clientWidth, el.clientHeight)),
  };
}
