/**
 * What to tell the user when the system stopped the app while it was
 * recording a track — an OS kill, most likely battery management on a
 * phone in a pocket.
 *
 * Two cases. Either the native service kept buffering fixes after the app
 * died, and that backlog is recovered silently at boot, leaving only the
 * hole between its last fix and this boot to report; or nothing was
 * buffered at all (the system also refused to restart the service), and
 * the resumed track's first fix simply arrives after a gap. Either way the
 * hole is worth saying out loud, with the remedy the user controls: the
 * phone's background settings for the app.
 */

import { formatDurationShort } from "../utils/format";

/** Shorter holes are a reload, not an interruption worth a notice. */
export const INTERRUPTION_NOTICE_MIN_MS = 2 * 60 * 1000;

export interface BacklogNotice {
  message: string;
  /** The hole was long enough to offer the battery-settings remedy. */
  interrupted: boolean;
}

/**
 * `points` is the recovered backlog in chronological order; `recorded` is
 * how many of them the recorder kept. Pure — exported for testing.
 */
export function describeBacklogRecovery(
  points: { timestamp: number }[],
  recorded: number,
  now: number,
): BacklogNotice | null {
  if (points.length === 0) return null;
  const first = points[0].timestamp;
  const last = points[points.length - 1].timestamp;
  const deadMs = now - last;
  const interrupted = deadMs >= INTERRUPTION_NOTICE_MIN_MS;
  if (recorded === 0 && !interrupted) return null;

  const parts: string[] = [];
  if (recorded > 0) {
    parts.push(
      `Recovered ${formatDurationShort(last - first)} of track recorded while the app was closed.`,
    );
  }
  if (interrupted) {
    parts.push(
      `Recording was interrupted for ${formatDurationShort(deadMs)} — the system stopped the app.`,
    );
  }
  return { message: parts.join(" "), interrupted };
}

/**
 * The notice for a resumed track whose first fix came `gapMs` after its last
 * stored point, with no backlog to fill the hole. `newTrack`: the gap was
 * long enough that the recorder started a new track. Pure — exported for
 * testing.
 */
export function describeResumeGap(
  gapMs: number,
  newTrack: boolean,
): string | null {
  if (gapMs < INTERRUPTION_NOTICE_MIN_MS) return null;
  const stopped = `Track recording stopped for ${formatDurationShort(gapMs)} while the app was closed.`;
  return newTrack ? `${stopped} A new track was started.` : stopped;
}

/**
 * Samsung's own "sleeping apps" limit stops background apps regardless of
 * Android's battery-optimization exemption, and no API can lift it, so on
 * Samsung phones the notice says where that setting lives. `manufacturer`
 * is lowercased, or null when unknown. Pure — exported for testing.
 */
export function withVendorAdvice(
  message: string,
  manufacturer: string | null,
): string {
  if (manufacturer !== "samsung") return message;
  return `${message} On Samsung phones, add Pelorus Nav to Never auto sleeping apps (Settings › Battery › Background usage limits).`;
}
