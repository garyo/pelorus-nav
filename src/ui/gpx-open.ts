/**
 * Importing a GPX file the OS handed us through "open with".
 *
 * Unlike the panel Import button, this arrives unbidden — possibly over a
 * chart while the user is navigating, and possibly for a file that isn't GPX
 * at all (the Android filter has to accept generic types to appear for cloud
 * providers). So nothing is written until the user confirms, and every
 * message is a non-blocking notice rather than an alert().
 */

import { type OpenedFile, onFileOpen } from "../app/fileOpenQueue";
import { deleteInboxCopy } from "../data/file-io";
import { parseGpx } from "../data/gpx";
import {
  describeGpxContents,
  describeGpxImport,
  type GpxImportCounts,
  isGpxImportEmpty,
} from "../data/gpx-import";
import type { MergeCounts } from "../data/gpx-merge";
import { confirmAndImport } from "./gpx-import";
import { showStatusBanner } from "./StatusBanner";
import { showUpdateNotice } from "./updateNotice";

const NOTICE_ID = "gpx-open-notice";
const BANNER_ID = "gpx-open-error";

/** Panels the "Show" action can open, by imported kind. */
export interface GpxOpenTargets {
  showRoutes: () => void;
  showTracks: () => void;
  showWaypoints: () => void;
}

/** How much of the file to inspect before believing it's GPX. */
const SNIFF_BYTES = 1024;

function looksLikeGpx(xml: string): boolean {
  return xml.slice(0, SNIFF_BYTES).includes("<gpx");
}

/** How the file reads mid-sentence, when a message is about a problem. */
function describeFile(file: OpenedFile): string {
  return file.name ?? "that file";
}

/** How the file reads as a heading. Cloud providers often supply no usable
 *  name (see filenameFromUrl), and "GPX file" beats an opaque token. */
function labelFile(file: OpenedFile): string {
  return file.name ?? "GPX file";
}

async function handleOpenedFile(
  file: OpenedFile,
  targets: GpxOpenTargets,
): Promise<void> {
  let xml: string;
  try {
    xml = await file.text;
  } catch (e) {
    // Worth logging the URL: whether a provider hands back an in-place URL
    // outside our container (iCloud, Drive) decides whether a read can
    // succeed at all, and that's invisible from the message alone.
    console.error(`GPX open: couldn't read ${file.url}:`, e);
    showStatusBanner({
      id: BANNER_ID,
      message: `Couldn't read ${describeFile(file)}.`,
    });
    return;
  }

  // The file association has to accept generic MIME types to be offered by
  // cloud providers, so being handed a non-GPX file is routine, not an error
  // worth alarming about.
  if (!looksLikeGpx(xml)) {
    showStatusBanner({
      id: BANNER_ID,
      message: `${describeFile(file)} isn't a GPX file.`,
    });
    return;
  }

  let result: ReturnType<typeof parseGpx>;
  try {
    result = parseGpx(xml);
  } catch {
    showStatusBanner({
      id: BANNER_ID,
      message: `${describeFile(file)} isn't a valid GPX file.`,
    });
    return;
  }

  const found = describeGpxContents(result);
  if (!found) {
    showStatusBanner({
      id: BANNER_ID,
      message: `No routes, tracks or waypoints in ${describeFile(file)}.`,
    });
    return;
  }

  showUpdateNotice({
    id: NOTICE_ID,
    message: `${labelFile(file)}: ${found}`,
    actionLabel: "Import",
    onAction: () => {
      void (async () => {
        let counts: GpxImportCounts | null;
        try {
          // The one modal in this flow. It answers the Import tap the user
          // just made, so it doesn't break the rule above: nothing interrupts
          // until they've asked for something.
          counts = await confirmAndImport(result, file.name);
          if (!counts) {
            void deleteInboxCopy(file.url);
            return;
          }
        } catch (e) {
          console.error("GPX import failed:", e);
          showStatusBanner({
            id: BANNER_ID,
            message: `Couldn't import ${describeFile(file)}.`,
          });
          return;
        }

        const written = counts;
        const touched = (c: MergeCounts) => c.added + c.updated;
        showUpdateNotice({
          id: NOTICE_ID,
          message: isGpxImportEmpty(written)
            ? "Already up to date"
            : describeGpxImport(written),
          actionLabel: "Show",
          onAction: () => {
            // Whichever kind dominates the file is what the user came for.
            const routes = touched(written.routes);
            const tracks = touched(written.tracks);
            if (routes >= tracks && routes > 0) {
              targets.showRoutes();
            } else if (tracks > 0) {
              targets.showTracks();
            } else {
              targets.showWaypoints();
            }
          },
        });
        void deleteInboxCopy(file.url);
      })();
    },
    onDismiss: () => {
      void deleteInboxCopy(file.url);
    },
  });
}

/**
 * Wire the "open with" flow. Call once, after the map layers exist — anything
 * that arrived during startup is delivered as soon as this runs.
 */
export function installGpxFileOpen(targets: GpxOpenTargets): void {
  onFileOpen((file) => handleOpenedFile(file, targets));
}
