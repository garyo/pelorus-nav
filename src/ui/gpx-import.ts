/**
 * Shared GPX import entry point for the route, track, and waypoint panels.
 */

import { GPX_ACCEPT, pickFile } from "../data/file-io";
import { type GpxImportResult, parseGpx } from "../data/gpx";

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

  try {
    return parseGpx(xml);
  } catch {
    alert("That file isn't a valid GPX file.");
    return null;
  }
}
