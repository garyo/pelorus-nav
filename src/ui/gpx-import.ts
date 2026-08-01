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
  describeGpxContents,
  describeGpxImport,
  type GpxImportCounts,
  planGpxImport,
  saveGpxImport,
} from "../data/gpx-import";
import type { MergeCounts } from "../data/gpx-merge";
import type { RouteLayer } from "../map/RouteLayer";
import type { TrackLayer } from "../map/TrackLayer";
import type { WaypointLayer } from "../map/WaypointLayer";
import { showImportDialog } from "./ImportDialog";

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
  const touched = (c: MergeCounts) => c.added + c.updated > 0;
  if (touched(counts.routes)) await layers.routeLayer.reloadAll();
  if (touched(counts.tracks)) await layers.trackLayer.reloadAll();
  if (touched(counts.waypoints)) await layers.waypointLayer.reloadAll();
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
 * Confirm and run an import: plan it against what's stored, show the user
 * what that means, and write only if they agree.
 *
 * Shared by the panel Import buttons and the open-with flow so both report
 * the same thing. Returns what was written, or null if nothing was.
 */
export async function confirmAndImport(
  result: GpxImportResult,
  fileName?: string | null,
): Promise<GpxImportCounts | null> {
  const plan = await planGpxImport(result);
  const choice = await showImportDialog(result, plan, fileName);
  if (!choice) return null;

  const counts = await saveGpxImport(result, choice.folder, plan);
  await reloadImportedLayers(counts);
  return counts;
}

/** The Import button on every manager panel. */
export async function importGpxFromPicker(): Promise<void> {
  const result = await pickAndParseGpx();
  if (!result) return;

  if (!describeGpxContents(result)) {
    alert("No routes, tracks or waypoints found in this GPX file.");
    return;
  }

  const counts = await confirmAndImport(result);
  if (!counts) return;

  // Silent on a no-op: a sync that changed nothing is the expected outcome,
  // and the dialog already said so before it ran.
  const what = describeGpxImport(counts);
  if (what) alert(`${what[0].toUpperCase()}${what.slice(1)}.`);
}
