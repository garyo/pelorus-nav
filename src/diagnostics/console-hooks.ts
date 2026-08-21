/**
 * Console diagnostic hooks — exposes the GPS diagnostic log and the
 * persistent connection event log on `window` for console/adb access
 * (browser console, or Chrome DevTools via chrome://inspect for the
 * Android WebView).
 */
import { downloadFile } from "../data/file-io";
import { connectionLog } from "../navigation/ConnectionEventLog";
import { gpsDiagLog } from "../navigation/GPSDiagnosticLog";

export function installConsoleHooks(): void {
  // ── GPS diagnostic logging ─────────────────────────────────────────
  // Expose on window for console/adb access:
  //   gpsDiag.start()          — begin recording
  //   gpsDiag.stop()           — stop recording
  //   gpsDiag.entryCount       — number of entries
  //   gpsDiag.download()       — download CSV via share/file save
  //   gpsDiag.csv()            — return CSV string (for console copy)
  const gpsDiag = {
    start: () => gpsDiagLog.start(),
    stop: () => gpsDiagLog.stop(),
    get entryCount() {
      return gpsDiagLog.entryCount;
    },
    csv: () => gpsDiagLog.toCSV(),
    download: () => {
      const csv = gpsDiagLog.toCSV();
      const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      downloadFile(csv, `gps-diag-${ts}.csv`, "text/csv");
    },
    clear: () => gpsDiagLog.clear(),
  };
  // Persistent connection event log (always on — survives restarts):
  //   bleLog.entryCount — number of entries
  //   bleLog.text()     — human-readable log
  //   bleLog.csv()      — CSV string
  //   bleLog.download() — export CSV via share/file save
  //   bleLog.clear()    — wipe the log
  const bleLog = {
    get entryCount() {
      return connectionLog.entryCount;
    },
    text: () => connectionLog.toText(),
    csv: () => connectionLog.toCSV(),
    download: () => {
      const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      downloadFile(
        connectionLog.toCSV(),
        `connection-log-${ts}.csv`,
        "text/csv",
      );
    },
    clear: () => connectionLog.clear(),
  };
  Object.assign(window, { gpsDiag, bleLog });
  // To enable: run gpsDiag.start() in the browser console or Chrome DevTools.
}
