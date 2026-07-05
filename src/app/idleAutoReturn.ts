/**
 * Auto-return: after a stretch of no interaction, close open dialogs/panels
 * and recenter on the vessel — like a dedicated plotter. A closeable can
 * report itself busy (e.g. a chart download in progress, or a track replay
 * animating) so the sweep leaves it open instead of yanking it away.
 */

export interface IdleCloseable {
  hide(): void;
  /** True while mid-task; the sweep must not hide it. */
  isBusy?(): boolean;
}

export interface IdleAutoReturnResult {
  /** True if any closeable reported busy — recentering should be skipped too. */
  anyBusy: boolean;
}

/** Hide every non-busy closeable; leave busy ones untouched. */
export function runIdleAutoReturn(
  closeables: readonly IdleCloseable[],
): IdleAutoReturnResult {
  let anyBusy = false;
  for (const c of closeables) {
    if (c.isBusy?.()) {
      anyBusy = true;
      continue;
    }
    c.hide();
  }
  return { anyBusy };
}
