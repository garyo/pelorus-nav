/**
 * Persisting a parsed GPX file. The single writer for imports, whether they
 * come from a panel's Import button or from the OS handing us a file.
 *
 * A GPX file marks its contents unambiguously, so everything in it is saved —
 * no caller decides which kinds it is interested in.
 */

import {
  appendTrackPoints,
  getAllRoutes,
  getAllTrackMetas,
  getAllWaypoints,
  replaceTrackPoints,
  saveRoutes,
  saveTrackMetas,
  saveWaypoints,
} from "./db";
import type { GpxImportResult } from "./gpx";
import {
  countsOf,
  type MergeCounts,
  type MergePlan,
  mergeRoute,
  mergeTrackMeta,
  mergeWaypoint,
  planMerge,
  routeSignature,
  trackMetaSignature,
  trackMetaUnchanged,
  waypointIdentity,
  waypointSignature,
} from "./gpx-merge";
import type { Route } from "./Route";
import type { TrackMeta } from "./Track";
import type { StandaloneWaypoint } from "./Waypoint";

export interface GpxImportCounts {
  routes: MergeCounts;
  tracks: MergeCounts;
  waypoints: MergeCounts;
  /** Points/waypoints the parser dropped for bad coordinates. */
  skippedPoints: number;
}

/** What an import would do, per kind. See planGpxImport. */
export interface GpxImportPlan {
  routes: MergePlan<Route>;
  tracks: MergePlan<TrackMeta>;
  waypoints: MergePlan<StandaloneWaypoint>;
  skippedPoints: number;
}

/** Suffix applied to an imported name that collides with an existing one. */
const IMPORTED_SUFFIX = " (imported)";

function dedupeName(name: string, taken: Set<string>): string {
  return taken.has(name) ? name + IMPORTED_SUFFIX : name;
}

/** Longest folder name worth keeping from a file's own metadata. */
const MAX_FOLDER_NAME = 40;

/**
 * The folder name to offer for a multi-route import: what the file calls
 * itself, else the date it arrived.
 *
 * A file's `<metadata><name>` is the only self-description that survives every
 * delivery route — a cloud provider can hand over a GPX with no filename at
 * all (see filenameFromUrl) — but it's free text, so anything unreasonably
 * long or blank falls back to the date.
 */
export function defaultImportFolder(
  result: GpxImportResult,
  now = new Date(),
): string {
  const name = result.metadataName?.trim();
  if (name && name.length <= MAX_FOLDER_NAME) return name;
  const when = now.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  return `Imported ${when}`;
}

/**
 * Work out what importing this file would do, without writing anything.
 *
 * Callers show this before committing — a sync that reports "50 unchanged"
 * needs to say so *before* the user decides — and then hand the same plan to
 * saveGpxImport so the decision and the write can't disagree.
 */
export async function planGpxImport(
  result: GpxImportResult,
): Promise<GpxImportPlan> {
  const [storedRoutes, storedTracks, storedWaypoints] = await Promise.all([
    result.routes.length > 0 ? getAllRoutes() : [],
    result.tracks.length > 0 ? getAllTrackMetas() : [],
    result.waypoints.length > 0 ? getAllWaypoints() : [],
  ]);

  return {
    routes: planMerge(result.routes, storedRoutes, routeSignature),
    waypoints: planMerge(
      result.waypoints,
      storedWaypoints,
      waypointSignature,
      waypointIdentity,
    ),
    // Tracks match on their metadata (name, point count), so the plan never
    // loads stored points — a signature that had to read them would mean
    // fetching every recorded fix on the device to import one file. The metas
    // are passed through as-is, not copied, so the write below renames the
    // same objects the caller holds. trackMetaUnchanged keeps a re-import of
    // a smoothed track's own export (which omits dropped points) a no-op.
    tracks: planMerge(
      result.tracks.map(({ meta }) => meta),
      storedTracks,
      trackMetaSignature,
      trackMetaSignature,
      trackMetaUnchanged,
    ),
    skippedPoints: result.skippedPoints,
  };
}

/**
 * Save everything in a parsed GPX file. Returns what was written.
 *
 * Items the file has brought before are updated in place rather than added
 * again, so re-importing an unchanged file writes nothing at all — see
 * gpx-merge.ts for how they're matched and what a merge keeps.
 *
 * `folder` files newly added routes and waypoints, so a big import lands
 * somewhere the manager panels can hide in one tap. Items that name their own
 * folder (a Pelorus export round-tripping home) keep it, and items already on
 * the device keep wherever the user has since filed them.
 */
export async function saveGpxImport(
  result: GpxImportResult,
  folder?: string,
  plan?: GpxImportPlan,
): Promise<GpxImportCounts> {
  const merged = plan ?? (await planGpxImport(result));

  if (merged.routes.add.length > 0 || merged.routes.update.length > 0) {
    const taken = new Set((await getAllRoutes()).map((r) => r.name));
    for (const route of merged.routes.add) {
      route.name = dedupeName(route.name, taken);
      // Names claimed by this file count too, or two same-named new routes
      // would both keep the name.
      taken.add(route.name);
      if (folder && !route.folder) route.folder = folder;
    }
    await saveRoutes([
      ...merged.routes.add,
      ...merged.routes.update.map(({ stored, incoming }) =>
        mergeRoute(stored, incoming),
      ),
    ]);
  }

  for (const { points } of result.tracks) {
    points.sort((a, b) => a.timestamp - b.timestamp);
  }
  if (merged.tracks.add.length > 0 || merged.tracks.update.length > 0) {
    const taken = new Set((await getAllTrackMetas()).map((t) => t.name));
    const pointsFor = (id: string) =>
      result.tracks.find((t) => t.meta.id === id)?.points ?? [];
    for (const meta of merged.tracks.add) {
      meta.name = dedupeName(meta.name, taken);
      taken.add(meta.name);
      if (folder && !meta.folder) meta.folder = folder;
    }
    const updated = merged.tracks.update.map(({ stored, incoming }) => ({
      meta: mergeTrackMeta(stored, incoming),
      incomingId: incoming.id,
    }));
    // Points can't share a transaction with the metas — each track's set is
    // written (or replaced) on its own. Points go first, metas last: an
    // interrupted import (quota, tab close) then leaves at worst invisible
    // orphan points, never a meta whose pointCount promises points that
    // were never written.
    for (const meta of merged.tracks.add) {
      await appendTrackPoints(meta.id, pointsFor(meta.id));
    }
    for (const { meta, incomingId } of updated) {
      // The points are the track; a changed signature means re-recording it.
      await replaceTrackPoints(meta.id, pointsFor(incomingId));
    }
    await saveTrackMetas([...merged.tracks.add, ...updated.map((u) => u.meta)]);
  }

  for (const wp of merged.waypoints.add) {
    if (folder && !wp.folder) wp.folder = folder;
  }
  await saveWaypoints([
    ...merged.waypoints.add,
    ...merged.waypoints.update.map(({ stored, incoming }) =>
      mergeWaypoint(stored, incoming),
    ),
  ]);

  return {
    routes: countsOf(merged.routes),
    tracks: countsOf(merged.tracks),
    waypoints: countsOf(merged.waypoints),
    skippedPoints: result.skippedPoints,
  };
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n !== 1 ? "s" : ""}`;
}

/** "2 routes, 1 track and 5 waypoints" from a list of ready-made phrases. */
function join(parts: string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

const KINDS = ["route", "track", "waypoint"] as const;

function countsByKind(counts: GpxImportCounts): MergeCounts[] {
  return [counts.routes, counts.tracks, counts.waypoints];
}

/** What a file holds: "55 routes and 308 waypoints". Empty when it holds
 *  nothing importable. */
export function describeGpxContents(result: GpxImportResult): string {
  const sizes = [
    result.routes.length,
    result.tracks.length,
    result.waypoints.length,
  ];
  return join(
    KINDS.map((kind, i) => (sizes[i] > 0 ? plural(sizes[i], kind) : "")).filter(
      Boolean,
    ),
  );
}

/** What an import wrote: "5 new routes and 8 updated routes". Empty when it
 *  wrote nothing, which is the everyday result of re-importing a synced file. */
export function describeGpxImport(counts: GpxImportCounts): string {
  const parts: string[] = [];
  countsByKind(counts).forEach((c, i) => {
    if (c.added > 0) parts.push(`${plural(c.added, KINDS[i])} added`);
    if (c.updated > 0) parts.push(`${plural(c.updated, KINDS[i])} updated`);
  });
  return join(parts);
}

/** What an import recognized and left alone: "42 routes". */
export function describeGpxUnchanged(counts: GpxImportCounts): string {
  return join(
    countsByKind(counts)
      .map((c, i) => (c.unchanged > 0 ? plural(c.unchanged, KINDS[i]) : ""))
      .filter(Boolean),
  );
}

/** True when an import would write nothing at all. */
export function isGpxImportEmpty(counts: GpxImportCounts): boolean {
  return countsByKind(counts).every((c) => c.added === 0 && c.updated === 0);
}
