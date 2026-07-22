/**
 * "Share diagnostics" collector: assembles one plain-text report with
 * delimited sections (header/settings/logs/storage) for a beta tester to
 * email to the developer. Every section is individually guarded — a failing
 * or hanging collector yields a "(section failed: …)" line instead of
 * sinking the export.
 */

import { Capacitor } from "@capacitor/core";
import { listStoredCharts } from "../data/tile-store";
import { editTapLog } from "../map/editTapDiag";
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
import { uiActionLog } from "./uiActionLog";

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
  /** Live navigation state + device-side pod status, when available. */
  nav?: {
    diagnosticsSnapshot(): string;
    requestDeviceDiag(): Promise<string | null>;
  };
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
      title: "NAVIGATION",
      collect: async () => {
        if (!deps.nav) return "(navigation manager not wired)";
        const lines = [deps.nav.diagnosticsSnapshot()];
        // Device-side status ($PPELD from the GPS pod's DIAG command). The
        // request self-times-out fast (~2 s) and resolves null — a pod that's
        // off, out of range, or on old firmware must not stall the report.
        const pod = await deps.nav.requestDeviceDiag();
        lines.push(`device status: ${pod ?? "(no answer / not supported)"}`);
        return lines.join("\n");
      },
    },
    {
      title: "DEVICE",
      collect: async () => {
        const nav = navigator as Navigator & {
          deviceMemory?: number;
          connection?: { effectiveType?: string; downlink?: number };
          getBattery?: () => Promise<{ level: number; charging: boolean }>;
        };
        const lines = [
          `cores: ${nav.hardwareConcurrency ?? "?"}`,
          `memory class: ${nav.deviceMemory ?? "?"} GB`,
          `language: ${nav.language}`,
          `timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`,
          `online: ${nav.onLine}`,
        ];
        if (nav.connection) {
          lines.push(
            `network: ${nav.connection.effectiveType ?? "?"} (~${nav.connection.downlink ?? "?"} Mbps)`,
          );
        }
        try {
          const canvas = document.createElement("canvas");
          let version = "webgl2";
          let gl = canvas.getContext("webgl2") as WebGLRenderingContext | null;
          if (!gl) {
            version = "webgl1";
            gl = canvas.getContext("webgl");
          }
          if (gl) {
            const dbg = gl.getExtension("WEBGL_debug_renderer_info");
            const renderer = dbg
              ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)
              : gl.getParameter(gl.RENDERER);
            lines.push(`webgl: ${version} — ${String(renderer)}`);
          } else {
            lines.push("webgl: (unavailable)");
          }
        } catch {
          lines.push("webgl: (probe failed)");
        }
        try {
          const perm = await nav.permissions?.query?.({ name: "geolocation" });
          lines.push(`geolocation permission: ${perm?.state ?? "(unknown)"}`);
        } catch {
          lines.push("geolocation permission: (unknown)");
        }
        try {
          const batt = await nav.getBattery?.();
          if (batt) {
            lines.push(
              `battery: ${Math.round(batt.level * 100)}%${batt.charging ? " (charging)" : ""}`,
            );
          }
        } catch {
          // no battery API — omit the line
        }
        return lines.join("\n");
      },
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
      title: "UI ACTIONS",
      collect: () => {
        const entries = uiActionLog.getEntries();
        return entries.length > 0
          ? entries
              .map((e) => `${new Date(e.t).toISOString()} ${e.detail ?? ""}`)
              .join("\n")
          : "(none recorded)";
      },
    },
    {
      title: "ROUTE EDIT TAPS",
      collect: () => {
        const n = editTapLog.entryCount;
        return n > 0
          ? `${n} entries\n${editTapLog.toText()}`
          : "(no edit session recorded)";
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
