/**
 * Persistent connection-event log for GPS providers.
 *
 * A small ring buffer of timestamped lifecycle events (connects, disconnects,
 * reconnect scheduling, Bluetooth on/off, errors) written through to
 * localStorage so it survives app restarts — the record that makes a field
 * failure diagnosable after the fact. Generic over providers via the `src`
 * field; the BLE providers are the primary writers.
 *
 * Writes are debounced (see `PERSIST_DEBOUNCE_MS`) rather than persisted on
 * every `log()` call — a night of BLE reconnect churn can push thousands of
 * events, and re-serializing the whole buffer on each one is wasted work
 * exactly when the log matters most. In-memory reads (`getEntries`,
 * `entryCount`) always reflect un-persisted entries immediately; only the
 * localStorage write lags. `pagehide` and `visibilitychange`→hidden flush any
 * pending write so a backgrounded/killed app doesn't lose recent entries.
 *
 * Exposed for field access as `window.bleLog` (main.ts) and viewable in
 * Settings → Navigation → Event log.
 */

import {
  createJsonStorageSlot,
  defaultBrowserStorage,
  type JsonStorageSlot,
  type StorageLike,
} from "../utils/json-storage-slot";
import {
  createTrailingThrottle,
  type TrailingThrottle,
} from "../utils/trailing-throttle";

export type ConnectionEventType =
  | "connect-request" // app/user asked the provider to connect
  | "picker-shown"
  | "picker-cancelled" // detail: error/reason text
  | "device-selected" // detail: "<name> <deviceId>"
  | "connect-attempt" // detail: deviceId + cause (initial|retry|manual|restored)
  | "connected"
  | "disconnected" // detail: "peripheral" | "user" | "provider-switch"
  | "reconnect-scheduled" // detail: "<delayMs>ms"
  | "watchdog-silent"
  | "bt-enabled"
  | "bt-disabled"
  | "error"; // detail: message

export interface ConnectionEvent {
  t: number; // epoch ms
  src: string; // provider id, e.g. "ble-nmea"
  type: ConnectionEventType;
  detail?: string;
}

const DEFAULT_KEY = "pelorus-nav-conn-log";
const DEFAULT_MAX = 300;
const PERSIST_DEBOUNCE_MS = 1000;

function isValidEvent(e: unknown): e is ConnectionEvent {
  if (typeof e !== "object" || e === null) return false;
  const ev = e as Record<string, unknown>;
  return (
    typeof ev.t === "number" &&
    typeof ev.src === "string" &&
    typeof ev.type === "string" &&
    (ev.detail === undefined || typeof ev.detail === "string")
  );
}

function isValidEventArray(value: unknown): value is ConnectionEvent[] {
  return Array.isArray(value) && value.every(isValidEvent);
}

/** Quote a CSV field, escaping embedded quotes (error text has commas). */
function csvField(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

export class ConnectionEventLog {
  private entries: ConnectionEvent[] = [];
  private readonly storage: StorageLike | null;
  private readonly key: string;
  private readonly max: number;
  private mirror: ((e: ConnectionEvent) => void) | null = null;
  private readonly slot: JsonStorageSlot<ConnectionEvent[]>;
  private readonly persistThrottle: TrailingThrottle;
  /** True when `entries` has changes not yet written to storage. */
  private dirty = false;

  constructor(opts?: {
    storage?: StorageLike | null;
    key?: string;
    max?: number;
  }) {
    this.storage =
      opts?.storage !== undefined ? opts.storage : defaultBrowserStorage();
    this.key = opts?.key ?? DEFAULT_KEY;
    this.max = opts?.max ?? DEFAULT_MAX;
    this.slot = createJsonStorageSlot<ConnectionEvent[]>(
      this.key,
      isValidEventArray,
    );
    this.persistThrottle = createTrailingThrottle(
      () => this.persist(),
      PERSIST_DEBOUNCE_MS,
    );
    this.load();
    this.registerFlushListeners();
  }

  log(src: string, type: ConnectionEventType, detail?: string): void {
    const event: ConnectionEvent = { t: Date.now(), src, type };
    if (detail !== undefined) event.detail = detail;
    this.entries.push(event);
    if (this.entries.length > this.max) {
      this.entries.splice(0, this.entries.length - this.max);
    }
    this.dirty = true;
    this.persistThrottle.trigger();
    this.mirror?.(event);
  }

  /** Optional per-event mirror (main.ts points this at the diag log). */
  setMirror(fn: ((e: ConnectionEvent) => void) | null): void {
    this.mirror = fn;
  }

  getEntries(): readonly ConnectionEvent[] {
    return this.entries;
  }

  get entryCount(): number {
    return this.entries.length;
  }

  /** CSV export: t_iso,t_ms,src,type,detail (detail quoted/escaped). */
  toCSV(): string {
    const lines = ["t_iso,t_ms,src,type,detail"];
    for (const e of this.entries) {
      lines.push(
        [
          new Date(e.t).toISOString(),
          String(e.t),
          e.src,
          e.type,
          csvField(e.detail ?? ""),
        ].join(","),
      );
    }
    return lines.join("\n");
  }

  /** Human-readable lines, oldest first. */
  toText(): string {
    return this.entries
      .map(
        (e) =>
          `${new Date(e.t).toISOString()} ${e.src} ${e.type}${e.detail ? ` ${e.detail}` : ""}`,
      )
      .join("\n");
  }

  clear(): void {
    this.entries = [];
    this.dirty = false;
    this.persistThrottle.cancel();
    this.slot.clear(this.storage);
  }

  /** Write a pending debounced persist immediately; no-op if nothing pending. */
  flush(): void {
    this.persistThrottle.cancel();
    if (this.dirty) this.persist();
  }

  /** Register the pagehide/hidden flush hooks (browser-only; no-op elsewhere, e.g. tests). */
  private registerFlushListeners(): void {
    const flush = () => this.flush();
    if (typeof window !== "undefined") {
      window.addEventListener("pagehide", flush);
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") flush();
      });
    }
  }

  private load(): void {
    const loaded = this.slot.load(this.storage);
    if (loaded) this.entries = loaded.slice(-this.max);
  }

  private persist(): void {
    this.slot.save(this.entries, this.storage);
    this.dirty = false;
  }
}

/** Shared instance all providers log into. */
export const connectionLog = new ConnectionEventLog();
