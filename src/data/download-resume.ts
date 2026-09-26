/**
 * Resumable downloads: the decisions behind the OPFS write worker's
 * fetchWrite and the chart panel's automatic retry.
 *
 * A download cut short by a transient failure keeps its `.downloading` temp
 * next to a `.resume` sidecar recording how many leading bytes of the temp
 * are flushed and valid, and which server build (strong etag) they came
 * from. The next attempt requests the rest with `Range: bytes=<n>-` and
 * appends only when the reply is a 206 carrying the same etag and starting
 * at exactly that byte. The server re-uploads files regularly and does not
 * honor `If-Range` (and a cross-origin `If-Range` would fail the CORS
 * preflight, which allows only `Range`), so this comparison is what keeps
 * bytes from two different builds out of one file.
 */

import { STALL_ERROR_NAME } from "./download-watchdog";

/** Suffix of the in-progress copy of a streamed download. */
export const TEMP_SUFFIX = ".downloading";

/** Suffix of the sidecar that makes a temp resumable. */
export const RESUME_SUFFIX = ".resume";

/** A resumable temp older than this is discarded by the startup sweep. */
export const RESUME_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface ResumeState {
  /** Strong etag of the build the bytes came from. */
  etag: string;
  /** Leading bytes of the temp that are flushed and valid. */
  bytes: number;
  /** Full size of the file. */
  total: number;
  /** When the state was saved (ms since epoch). */
  savedAt: number;
}

/** Whether a failure with this error name may succeed on retry: a network drop or a stall. */
export function isTransientDownloadError(name: string): boolean {
  return name === "TypeError" || name === STALL_ERROR_NAME;
}

/** Only strong etags identify a build byte-for-byte. */
function isStrongEtag(etag: string | null | undefined): etag is string {
  return !!etag && !etag.startsWith("W/");
}

/** The state to save after a transient failure, or null when the bytes so far can't be resumed. */
export function resumeStateAfterFailure(
  etag: string | undefined,
  bytes: number,
  total: number,
  now: number,
): ResumeState | null {
  if (!isStrongEtag(etag) || bytes <= 0 || total <= 0 || bytes >= total) {
    return null;
  }
  return { etag, bytes, total, savedAt: now };
}

/** Parse a sidecar, or null when it is malformed, expired, or claims more bytes than the temp holds. */
export function parseResumeState(
  text: string,
  tempSize: number,
  now: number,
): ResumeState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { etag, bytes, total, savedAt } = parsed as Record<string, unknown>;
  if (
    typeof etag !== "string" ||
    typeof bytes !== "number" ||
    typeof total !== "number" ||
    typeof savedAt !== "number"
  ) {
    return null;
  }
  const state = resumeStateAfterFailure(etag, bytes, total, savedAt);
  if (!state || bytes > tempSize) return null;
  const age = now - savedAt;
  return age >= 0 && age <= RESUME_MAX_AGE_MS ? state : null;
}

/** Parse `Content-Range: bytes <start>-<end>/<total>`. */
export function parseContentRange(
  header: string | null,
): { start: number; total: number } | null {
  const match = header?.match(/^bytes (\d+)-\d+\/(\d+)$/);
  return match ? { start: Number(match[1]), total: Number(match[2]) } : null;
}

/** Whether a reply to `Range: bytes=<resume.bytes>-` continues the same build where it left off. */
export function continuesDownload(
  resume: ResumeState,
  status: number,
  etag: string | null,
  contentRange: string | null,
): boolean {
  const range = parseContentRange(contentRange);
  return (
    status === 206 &&
    etag === resume.etag &&
    range?.start === resume.bytes &&
    range.total === resume.total
  );
}
