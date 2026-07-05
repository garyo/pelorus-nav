/**
 * "Share diagnostics" collector: assembles one plain-text report with
 * delimited sections (header/settings/logs/storage) for a beta tester to
 * email to the developer. Every section is individually guarded — a failing
 * or hanging collector yields a "(section failed: …)" line instead of
 * sinking the export.
 */

import { Capacitor } from "@capacitor/core";
import { listStoredCharts } from "../data/tile-store";
import { connectionLog } from "../navigation/ConnectionEventLog";
import { gpsDiagLog } from "../navigation/GPSDiagnosticLog";
import { BackgroundGPS } from "../plugins/BackgroundGPS";
import {
  getPluginSettingsSchemas,
  getSettings,
  type Settings,
} from "../settings";
import { formatBytes } from "../utils/format";
import { appErrorLog } from "./errorLog";

export interface DiagnosticSection {
  /** Rendered as "=== TITLE ===". */
  title: string;
  collect: () => string | Promise<string>;
}

const SECTION_TIMEOUT_MS = 10_000;
const GPS_DIAG_MAX_ROWS = 500;
const NATIVE_DIAG_MAX_BYTES = 65_536;

/** Run all sections into one report; failures/timeouts become inline notes. */
export async function collectDiagnostics(
  sections: readonly DiagnosticSection[],
  timeoutMs = SECTION_TIMEOUT_MS,
): Promise<string> {
  const parts: string[] = [];
  for (const section of sections) {
    let body: string;
    try {
      body = await withTimeout(
        Promise.resolve().then(section.collect),
        timeoutMs,
      );
    } catch (err) {
      body = `(section failed: ${String(err)})`;
    }
    parts.push(`=== ${section.title} ===\n${body}`);
  }
  return `${parts.join("\n\n")}\n`;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out after ${ms}ms`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** "pelorus-diagnostics-20260704-153012.txt" */
export function diagnosticsFilename(now: Date = new Date()): string {
  const ts = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace("T", "-")
    .slice(0, 15);
  return `pelorus-diagnostics-${ts}.txt`;
}

/**
 * Deep-copy the settings with plugin values redacted when their schema
 * control is flagged `secret`, or when the key name smells like a credential.
 */
export function redactSettings(
  settings: Settings,
  schemas = getPluginSettingsSchemas(),
): Settings {
  const copy = JSON.parse(JSON.stringify(settings)) as Settings;
  if (!copy.plugins) return copy;
  const secretKeys = new Set<string>();
  for (const section of schemas) {
    for (const control of section.schema) {
      if (control.secret) secretKeys.add(`${section.pluginId}.${control.key}`);
    }
  }
  const smellsSecret = /key|token|secret|password/i;
  for (const [pluginId, values] of Object.entries(copy.plugins)) {
    for (const key of Object.keys(values)) {
      if (secretKeys.has(`${pluginId}.${key}`) || smellsSecret.test(key)) {
        values[key] = "(redacted)";
      }
    }
  }
  return copy;
}

interface DiagnosticsDeps {
  appVersion: string;
  buildId: string;
}

/** The production section list. */
export function buildDefaultSections(
  deps: DiagnosticsDeps,
): DiagnosticSection[] {
  return [
    {
      title: "PELORUS NAV DIAGNOSTICS",
      collect: () =>
        [
          "NOTE: This file contains recent GPS positions, device details, and app settings.",
          `version: ${deps.appVersion}`,
          `build: ${deps.buildId}`,
          `generated: ${new Date().toISOString()}`,
          `platform: ${Capacitor.getPlatform()}`,
          `userAgent: ${navigator.userAgent}`,
          `screen: ${screen.width}x${screen.height} @${devicePixelRatio}x (viewport ${innerWidth}x${innerHeight})`,
        ].join("\n"),
    },
    {
      title: "SETTINGS",
      collect: () => JSON.stringify(redactSettings(getSettings()), null, 2),
    },
    {
      title: "CONNECTION LOG",
      collect: () => {
        const n = connectionLog.entryCount;
        return n > 0 ? `${n} entries\n${connectionLog.toText()}` : "(empty)";
      },
    },
    {
      title: "APP ERRORS",
      collect: () => {
        const n = appErrorLog.entryCount;
        return n > 0
          ? `${n} entries\n${appErrorLog.toText()}`
          : "(none recorded)";
      },
    },
    {
      title: "GPS DIAGNOSTIC LOG",
      collect: () => {
        const n = gpsDiagLog.entryCount;
        const status = `recording: ${gpsDiagLog.enabled}, entries: ${n}`;
        if (n === 0) {
          return `${status}\n(not recording — enable via window.gpsDiag.start())`;
        }
        const note =
          n > GPS_DIAG_MAX_ROWS ? ` (last ${GPS_DIAG_MAX_ROWS} of ${n})` : "";
        return `${status}${note}\n${gpsDiagLog.toCSV(GPS_DIAG_MAX_ROWS)}`;
      },
    },
    {
      title: "STORAGE",
      collect: async () => {
        const lines: string[] = [];
        const charts = await listStoredCharts();
        lines.push(`downloaded charts: ${charts.length}`);
        for (const c of charts) {
          lines.push(
            `  ${c.filename}  ${formatBytes(c.sizeBytes)}  (${c.region})`,
          );
        }
        try {
          const est = await navigator.storage?.estimate?.();
          lines.push(
            est
              ? `storage: ${formatBytes(est.usage ?? 0)} used of ${formatBytes(est.quota ?? 0)} quota`
              : "storage estimate: (unavailable)",
          );
        } catch {
          lines.push("storage estimate: (unavailable)");
        }
        if (Capacitor.isNativePlatform()) {
          lines.push(
            "service workers: (Capacitor build: unregistered at startup by design)",
          );
        } else if ("serviceWorker" in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          lines.push(`service workers: ${regs.length}`);
          for (const r of regs) {
            lines.push(
              `  active: ${r.active?.scriptURL ?? "-"}  waiting: ${r.waiting ? "YES" : "no"}`,
            );
          }
        } else {
          lines.push("service workers: (unsupported)");
        }
        return lines.join("\n");
      },
    },
    {
      title: "NATIVE DIAG LOG",
      collect: async () => {
        if (!Capacitor.isNativePlatform()) return "(web: no native diag log)";
        const tail = await BackgroundGPS.readDiag({
          maxBytes: NATIVE_DIAG_MAX_BYTES,
        });
        const note = tail.truncated
          ? `(last ${NATIVE_DIAG_MAX_BYTES / 1024} KB of ${tail.sizeBytes} bytes)\n`
          : "";
        return `${note}${tail.text}`;
      },
    },
  ];
}
