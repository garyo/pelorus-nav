/**
 * Whether a streamed download received all the bytes it was supposed to.
 *
 * `expectedTotal` comes from the response's `content-length` header, which
 * some servers omit (0 = unknown). When it's unknown we can't tell a full
 * download from a connection that dropped early, so we trust the stream's
 * own `done` signal. When it's known, a byte-count mismatch at stream end
 * means the connection was cut mid-transfer — that must not be reported as
 * a successful download.
 */
export function isCompleteDownload(
  receivedBytes: number,
  expectedTotal: number,
): boolean {
  return expectedTotal <= 0 || receivedBytes === expectedTotal;
}
