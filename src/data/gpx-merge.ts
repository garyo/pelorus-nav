/**
 * Matching a parsed GPX file against what's already stored, so importing the
 * same file twice is a no-op instead of a second copy of everything.
 *
 * Pure: no DB access, no DOM. saveGpxImport (gpx-import.ts) applies the plan.
 *
 * Two things can identify an item across imports:
 *
 * - **An id carried in the file.** Our own exports write `pelorus:id` (the
 *   item's local id) and Garmin writes `uuidx:uuid`; both are stable across
 *   re-exports of the same item, so they survive editing on the far side.
 *   Stored on import as `sourceId`, which is matched alongside the local `id`
 *   so a Pelorus → elsewhere → Pelorus round trip lands back on the original.
 * - **Its content.** For files with no ids at all, an item whose name and
 *   geometry are unchanged is the same item. Coordinates are compared at
 *   ~1 m, well below GPS noise but far above the float wobble of a
 *   serialize/parse round trip.
 *
 * A match means the stored item is updated in place, keeping the organization
 * the user built on this device — folder, visibility, colour — because those
 * are local decisions a synced file shouldn't overwrite (and for most imports
 * the incoming colour is just our own palette, assigned by position in the
 * file, which would otherwise reshuffle on every sync). Everything else —
 * name, geometry, notes — comes from the file, which is the side that changed.
 */

import type { Route } from "./Route";
import type { TrackMeta } from "./Track";
import type { StandaloneWaypoint } from "./Waypoint";

/** Coordinate precision for content matching: 5 dp ≈ 1.1 m at the equator. */
const COORD_DP = 5;

function coord(n: number): string {
  return n.toFixed(COORD_DP);
}

/** Anything an import can match against: a local id plus an optional id
 *  inherited from the file it came from. */
export interface Identified {
  id: string;
  sourceId?: string;
}

export interface MergePlan<T> {
  /** Items the file introduces. */
  add: T[];
  /** Items that already exist and differ: `{ stored, incoming }`. */
  update: Array<{ stored: T; incoming: T }>;
  /** Items that already exist and are byte-identical — no write at all. */
  unchanged: T[];
}

export interface MergeCounts {
  added: number;
  updated: number;
  unchanged: number;
}

export function countsOf<T>(plan: MergePlan<T>): MergeCounts {
  return {
    added: plan.add.length,
    updated: plan.update.length,
    unchanged: plan.unchanged.length,
  };
}

/** Total items a plan touches, for "nothing to do" checks. */
export function isNoOp(...plans: Array<MergePlan<unknown>>): boolean {
  return plans.every((p) => p.add.length === 0 && p.update.length === 0);
}

/** Content signature of a route: name plus its ordered points. */
export function routeSignature(route: Route): string {
  const pts = route.waypoints
    .map((w) => `${coord(w.lat)},${coord(w.lon)},${w.name}`)
    .join(";");
  return `${route.name}|${pts}`;
}

/** Content signature of a standalone waypoint: name, position, notes, icon. */
export function waypointSignature(wp: StandaloneWaypoint): string {
  return `${wp.name}|${coord(wp.lat)},${coord(wp.lon)}|${wp.notes}|${wp.icon}`;
}

/**
 * Content signature of a track: name and point count.
 *
 * Deliberately shallow. Comparing the fixes themselves would mean loading
 * every point of every stored track to import one file — tens of thousands of
 * rows to answer a question about a handful of tracks — and a recording is
 * rarely edited after the fact, so an id match carries the real weight here.
 */
export function trackMetaSignature(meta: TrackMeta): string {
  return `${meta.name}|${meta.pointCount}`;
}

/**
 * Match incoming items against stored ones.
 *
 * Identity wins over content: an item whose id is known is that item even if
 * it was renamed and re-drawn. Content matching is the fallback for files
 * carrying no ids, and each stored item can be claimed only once, so two
 * identical incoming items can't both collapse onto it.
 */
export function planMerge<T extends Identified>(
  incoming: readonly T[],
  stored: readonly T[],
  signature: (item: T) => string,
): MergePlan<T> {
  const byId = new Map<string, T>();
  for (const item of stored) {
    byId.set(item.id, item);
    if (item.sourceId) byId.set(item.sourceId, item);
  }
  const bySignature = new Map<string, T[]>();
  for (const item of stored) {
    const key = signature(item);
    const list = bySignature.get(key);
    if (list) list.push(item);
    else bySignature.set(key, [item]);
  }

  const claimed = new Set<string>();
  const plan: MergePlan<T> = { add: [], update: [], unchanged: [] };

  for (const item of incoming) {
    let match: T | undefined;

    const fileId = item.sourceId ?? item.id;
    const byIdHit = byId.get(fileId);
    if (byIdHit && !claimed.has(byIdHit.id)) match = byIdHit;

    if (!match) {
      const candidates = bySignature.get(signature(item)) ?? [];
      match = candidates.find((c) => !claimed.has(c.id));
    }

    if (!match) {
      plan.add.push(item);
      continue;
    }
    claimed.add(match.id);
    if (signature(match) === signature(item)) {
      plan.unchanged.push(match);
    } else {
      plan.update.push({ stored: match, incoming: item });
    }
  }

  return plan;
}

/**
 * Fold an incoming item into the stored one: the file's content, the device's
 * organization. `id` stays local so anything referencing it (active
 * navigation, a route's selection) keeps working across a sync.
 */
export function mergeRoute(stored: Route, incoming: Route): Route {
  return {
    ...incoming,
    id: stored.id,
    createdAt: stored.createdAt,
    sourceId: incoming.sourceId ?? stored.sourceId,
    visible: stored.visible,
    color: stored.color,
    ...(stored.folder ? { folder: stored.folder } : {}),
  };
}

export function mergeWaypoint(
  stored: StandaloneWaypoint,
  incoming: StandaloneWaypoint,
): StandaloneWaypoint {
  return {
    ...incoming,
    id: stored.id,
    createdAt: stored.createdAt,
    updatedAt: Date.now(),
    sourceId: incoming.sourceId ?? stored.sourceId,
    visible: stored.visible,
    ...(stored.folder ? { folder: stored.folder } : {}),
  };
}

export function mergeTrackMeta(
  stored: TrackMeta,
  incoming: TrackMeta,
): TrackMeta {
  return {
    ...incoming,
    id: stored.id,
    createdAt: stored.createdAt,
    sourceId: incoming.sourceId ?? stored.sourceId,
    visible: stored.visible,
    color: stored.color,
    ...(stored.folder ? { folder: stored.folder } : {}),
  };
}
