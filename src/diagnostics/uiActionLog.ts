/**
 * Breadcrumb trail of user-facing UI actions — surfaces opening/closing,
 * map interaction-mode changes, dialogs — so a bug report shows what the
 * user was doing right before the problem (e.g. "never entered route-edit
 * mode" vs "edit mode active but taps select nothing"). A small persistent
 * ring buffer, shipped in bug reports as the UI ACTIONS section.
 */

import { ConnectionEventLog } from "../navigation/ConnectionEventLog";

export const uiActionLog = new ConnectionEventLog({
  key: "pelorus-nav-uiaction-log",
  max: 100,
});

export function logUiAction(detail: string): void {
  uiActionLog.log("ui", "diag", detail);
}
