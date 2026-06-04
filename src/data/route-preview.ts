/**
 * Route pre-visualization: synthesize a pseudo-track from a route and a
 * planning speed, so the track viewer can scrub and replay a planned
 * passage — positions, leg courses, and clock-time ETAs all fall out of
 * the same analysis the real tracks use.
 */

import { haversineDistanceNM, initialBearingDeg } from "../utils/coordinates";
import type { Route } from "./Route";
import type { TrackPoint } from "./Track";

const MS_PER_HOUR = 3_600_000;

/**
 * Build track points along a route at a constant planning speed.
 * One point per waypoint, timestamped by cumulative leg time from
 * `startTime`; COG is the outgoing leg bearing (the last point keeps
 * the final leg's bearing). Returns [] when the route can't be sailed
 * (fewer than two waypoints, or a non-positive speed).
 */
export function routeToTrackPoints(
  route: Route,
  planSpeedKn: number,
  startTime: number,
): TrackPoint[] {
  const wps = route.waypoints;
  if (wps.length < 2 || planSpeedKn <= 0) return [];

  const points: TrackPoint[] = [];
  let t = startTime;
  for (let i = 0; i < wps.length; i++) {
    const wp = wps[i];
    if (i > 0) {
      const prev = wps[i - 1];
      const legNM = haversineDistanceNM(prev.lat, prev.lon, wp.lat, wp.lon);
      t += (legNM / planSpeedKn) * MS_PER_HOUR;
    }
    const next = wps[Math.min(i + 1, wps.length - 1)];
    const from = i < wps.length - 1 ? wp : wps[i - 1];
    const to = i < wps.length - 1 ? next : wp;
    points.push({
      lat: wp.lat,
      lon: wp.lon,
      timestamp: Math.round(t),
      sog: planSpeedKn,
      cog:
        from.lat === to.lat && from.lon === to.lon
          ? null
          : initialBearingDeg(from.lat, from.lon, to.lat, to.lon),
    });
  }
  return points;
}
