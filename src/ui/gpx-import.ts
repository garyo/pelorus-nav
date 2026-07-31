/**
 * GPX import for the UI: picking a file, parsing it, and getting what was
 * imported onto the map.
 *
 * Every import saves everything the file contains — GPX marks routes, tracks
 * and waypoints unambiguously, so there is nothing for the caller to choose.
 * That is why all three manager panels share one Import action.
 */

import { GPX_ACCEPT, pickFile } from "../data/file-io";
import { type GpxImportResult, parseGpx } from "../data/gpx";
import {
  defaultImportFolder,
  describeGpxImport,
  type GpxImportCounts,
  saveGpxImport,
} from "../data/gpx-import";
import type { RouteLayer } from "../map/RouteLayer";
import type { TrackLayer } from "../map/TrackLayer";
import type { WaypointLayer } from "../map/WaypointLayer";

export interface ImportLayers {
  routeLayer: RouteLayer;
  trackLayer: TrackLayer;
  waypointLayer: WaypointLayer;
}

let layers: ImportLayers | null = null;

/** Register the layers imports draw into. Called once from main.ts. */
export function setImportLayers(l: ImportLayers): void {
  layers = l;
}

/**
 * Redraw the layers an import touched. Their onChange buses refresh any open
 * manager panel, so no caller needs a panel reference.
 */
export async function reloadImportedLayers(
  counts: GpxImportCounts,
): Promise<void> {
  if (!layers) return;
  if (counts.routes > 0) await layers.routeLayer.reloadAll();
  if (counts.tracks > 0) await layers.trackLayer.reloadAll();
  if (counts.waypoints > 0) await layers.waypointLayer.reloadAll();
}

/** Parse GPX text, reporting bad input rather than throwing. */
export function parseGpxOrAlert(xml: string): GpxImportResult | null {
  try {
    return parseGpx(xml);
  } catch {
    alert("That file isn't a valid GPX file.");
    return null;
  }
}

/**
 * Pick a GPX file and parse it. Returns null when the user cancels or the
 * file isn't usable GPX — the picker is unfiltered (see GPX_ACCEPT), so a
 * stray pick is expected and reported here rather than thrown.
 */
export async function pickAndParseGpx(): Promise<GpxImportResult | null> {
  let xml: string;
  try {
    xml = await pickFile(GPX_ACCEPT);
  } catch {
    return null; // cancelled
  }
  return parseGpxOrAlert(xml);
}

/**
 * Offer to file a multi-route import in a folder, and return the name chosen.
 *
 * One GPX can carry a whole season's routes, and sixty loose routes bury the
 * chart with no way to clear them but sixty taps of the eye. A folder gives
 * the Routes panel's existing bulk-visibility eye something to act on, so the
 * moment to ask is while the import is still in the user's hands.
 *
 * Only multi-route files ask: a single route is not clutter, and routes that
 * carry their own folder are left alone by saveGpxImport either way. An empty
 * answer or a cancel means "leave them loose" — declining must be as easy as
 * accepting.
 */
export function askImportFolder(result: GpxImportResult): string | undefined {
  if (result.routes.length < 2) return undefined;
  const answer = prompt(
    `Put these ${result.routes.length} routes in a folder?\n` +
      "You can hide or show a folder's routes together. " +
      "Leave it empty to skip.",
    defaultImportFolder(result),
  );
  return answer?.trim() || undefined;
}

/** The Import button on every manager panel. */
export async function importGpxFromPicker(): Promise<void> {
  const result = await pickAndParseGpx();
  if (!result) return;

  const counts = await saveGpxImport(result, askImportFolder(result));
  await reloadImportedLayers(counts);

  const what = describeGpxImport(counts);
  alert(
    what
      ? `Imported ${what}.`
      : "No routes, tracks or waypoints found in this GPX file.",
  );
}
