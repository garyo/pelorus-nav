/**
 * Persistent connection-event log for GPS providers.
 *
 * A small ring buffer of timestamped lifecycle events (connects, disconnects,
 * reconnect scheduling, Bluetooth on/off, errors) written through to
 * localStorage so it survives app restarts — the record that makes a field
 * failure diagnosable after the fact. Generic over providers via the `src`
 * field; the BLE providers are the primary writers.
 *
 * Exposed for field access as `window.bleLog` (main.ts) and viewable in
 * Settings → Navigation → Event log.
 */

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

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const DEFAULT_KEY = "pelorus-nav-conn-log";
const DEFAULT_MAX = 300;

function defaultStorage(): StorageLike | null {
  return typeof localStorage !== "undefined" ? localStorage : null;
}

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

  constructor(opts?: {
    storage?: StorageLike | null;
    key?: string;
    max?: number;
  }) {
    this.storage =
      opts?.storage !== undefined ? opts.storage : defaultStorage();
    this.key = opts?.key ?? DEFAULT_KEY;
    this.max = opts?.max ?? DEFAULT_MAX;
    this.load();
  }

  log(src: string, type: ConnectionEventType, detail?: string): void {
    const event: ConnectionEvent = { t: Date.now(), src, type };
    if (detail !== undefined) event.detail = detail;
    this.entries.push(event);
    if (this.entries.length > this.max) {
      this.entries.splice(0, this.entries.length - this.max);
    }
    this.save();
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
    try {
      this.storage?.removeItem(this.key);
    } catch {
      // storage unavailable — memory is cleared regardless
    }
  }

  private load(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(this.key);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every(isValidEvent)) {
        this.entries = parsed.slice(-this.max);
      } else {
        this.storage.removeItem(this.key);
      }
    } catch {
      try {
        this.storage.removeItem(this.key);
      } catch {
        // ignore — corrupt and unremovable; start empty in memory
      }
    }
  }

  private save(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(this.key, JSON.stringify(this.entries));
    } catch {
      // quota/privacy failures must never break connection handling
    }
  }
}

/** Shared instance all providers log into. */
export const connectionLog = new ConnectionEventLog();
