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
  saveRoute,
  saveTrackMeta,
  saveWaypoint,
} from "./db";
import type { GpxImportResult } from "./gpx";

export interface GpxImportCounts {
  routes: number;
  tracks: number;
  waypoints: number;
  /** Points/waypoints the parser dropped for bad coordinates. */
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
 * Save everything in a parsed GPX file. Returns what was written.
 *
 * `folder` files the imported routes, so a big import lands somewhere the
 * Routes panel can hide in one tap. Routes that name their own folder (a
 * Pelorus export round-tripping home) keep it.
 */
export async function saveGpxImport(
  result: GpxImportResult,
  folder?: string,
): Promise<GpxImportCounts> {
  if (result.routes.length > 0) {
    const taken = new Set((await getAllRoutes()).map((r) => r.name));
    for (const route of result.routes) {
      route.name = dedupeName(route.name, taken);
      if (folder && !route.folder) route.folder = folder;
    }
    await Promise.all(result.routes.map((route) => saveRoute(route)));
  }

  if (result.tracks.length > 0) {
    const taken = new Set((await getAllTrackMetas()).map((t) => t.name));
    for (const { meta, points } of result.tracks) {
      meta.name = dedupeName(meta.name, taken);
      points.sort((a, b) => a.timestamp - b.timestamp);
      await saveTrackMeta(meta);
      await appendTrackPoints(meta.id, points);
    }
  }

  if (result.waypoints.length > 0) {
    await Promise.all(result.waypoints.map((wp) => saveWaypoint(wp)));
  }

  return {
    routes: result.routes.length,
    tracks: result.tracks.length,
    waypoints: result.waypoints.length,
    skippedPoints: result.skippedPoints,
  };
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n !== 1 ? "s" : ""}`;
}

/** "2 routes, 1 track and 5 waypoints" — empty when nothing was imported. */
export function describeGpxImport(counts: GpxImportCounts): string {
  const parts: string[] = [];
  if (counts.routes > 0) parts.push(plural(counts.routes, "route"));
  if (counts.tracks > 0) parts.push(plural(counts.tracks, "track"));
  if (counts.waypoints > 0) parts.push(plural(counts.waypoints, "waypoint"));
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
