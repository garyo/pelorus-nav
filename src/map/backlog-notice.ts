/**
 * What to tell the user after a track backlog is recovered at boot.
 *
 * A backlog exists only because the app died while recording — an OS kill
 * under way, most likely battery management on a phone in a pocket. The
 * fixes the native service kept buffering are recovered silently; the hole
 * between its last fix and this boot is not, and that is the part worth
 * saying out loud, with the one remedy the user controls: exempting the
 * app from battery optimization.
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
