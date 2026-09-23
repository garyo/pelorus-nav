/**
 * What a Signal K connection has seen, for the Signal K diagnostics panel:
 * the server's hello, every own-vessel path with its latest value, source and
 * arrival time, other vessels heard (AIS), and message/connection counts.
 *
 * Fed by SignalKProvider from every message; cheap enough to run always, so
 * the panel opens onto what has already arrived.
 */

export interface SignalKPathSample {
  value: unknown;
  /** The server's `$source` for the update, e.g. "nmea0183.GP" or "n2k.115". */
  source: string | null;
  receivedMs: number;
}

export interface SignalKServerHello {
  name: string | null;
  version: string | null;
  /** Context of the server's own vessel, e.g. "vessels.urn:mrn:imo:mmsi:…". */
  self: string | null;
}

interface SignalKUpdate {
  $source?: unknown;
  source?: unknown;
  timestamp?: unknown;
  values?: Array<{ path?: unknown; value?: unknown }>;
}

// Rolling window for the message rate.
const RATE_WINDOW_MS = 10000;
// Another vessel counts as present if heard within this long.
const VESSEL_PRESENT_MS = 60000;

/** Deltas without a context, and "vessels.self", are the server's own vessel. */
export function isSelfContext(context: unknown, self: string | null): boolean {
  return (
    context === undefined || context === "vessels.self" || context === self
  );
}

/** A readable source name from an update's `$source`, or its source object. */
export function updateSource(update: SignalKUpdate): string | null {
  if (typeof update.$source === "string") return update.$source;
  const src = update.source;
  if (typeof src !== "object" || src === null) return null;
  const { label, talker, src: address } = src as Record<string, unknown>;
  const parts = [label, talker ?? address].filter(
    (p): p is string | number => typeof p === "string" || typeof p === "number",
  );
  return parts.length > 0 ? parts.join(".") : null;
}

export class SignalKDiagnostics {
  hello: SignalKServerHello = { name: null, version: null, self: null };
  /** Own-vessel data by Signal K path. The root path "" is the vessel itself. */
  readonly paths = new Map<string, SignalKPathSample>();
  /** Successful connections this session; more than one means the link dropped. */
  connections = 0;
  connectedAtMs = 0;
  private readonly otherVessels = new Map<string, number>();
  private messageTimes: number[] = [];

  /** A new connection: forget the previous one's data, keep the session count. */
  noteConnected(now: number): void {
    this.connections += 1;
    this.connectedAtMs = now;
    this.hello = { name: null, version: null, self: null };
    this.paths.clear();
    this.otherVessels.clear();
    this.messageTimes = [];
  }

  /**
   * Record one server message. Returns true when it's an own-vessel delta
   * (the provider navigates only from those).
   */
  noteMessage(msg: Record<string, unknown>, now: number): boolean {
    this.messageTimes.push(now);
    if (this.messageTimes[0] < now - RATE_WINDOW_MS) {
      this.messageTimes = this.messageTimes.filter(
        (t) => t >= now - RATE_WINDOW_MS,
      );
    }
    const updates = msg.updates as SignalKUpdate[] | undefined;
    if (!Array.isArray(updates)) {
      if (typeof msg.self === "string" || typeof msg.version === "string") {
        this.hello = {
          name: typeof msg.name === "string" ? msg.name : null,
          version: typeof msg.version === "string" ? msg.version : null,
          self: typeof msg.self === "string" ? msg.self : null,
        };
      }
      return false;
    }
    if (!isSelfContext(msg.context, this.hello.self)) {
      if (
        typeof msg.context === "string" &&
        msg.context.startsWith("vessels.")
      ) {
        this.otherVessels.set(msg.context, now);
      }
      return false;
    }
    for (const update of updates) {
      const source = updateSource(update);
      for (const { path, value } of update.values ?? []) {
        if (typeof path !== "string") continue;
        this.paths.set(path, { value, source, receivedMs: now });
      }
    }
    return true;
  }

  /** Messages per second over the last few seconds. */
  messageRate(now: number): number {
    const recent = this.messageTimes.filter((t) => t >= now - RATE_WINDOW_MS);
    const spanMs = Math.min(RATE_WINDOW_MS, now - this.connectedAtMs);
    return spanMs > 0 ? (recent.length * 1000) / spanMs : 0;
  }

  /**
   * Plain-text summary for bug reports: server, link, and every own-vessel
   * path with its raw value, age and source. Leaves out the vessel's
   * identity (the root path's name/MMSI and the self context), which a
   * report doesn't need.
   */
  summary(now: number, connected: boolean): string {
    const { name, version } = this.hello;
    const server = [name, version].filter(Boolean).join(" ") || "(no hello)";
    const link = connected
      ? `connected ${Math.round((now - this.connectedAtMs) / 1000)} s`
      : "not connected (values below are from the last connection)";
    const lines = [
      `server: ${server}`,
      `link: ${link} · connections this session: ${this.connections} · ${this.messageRate(now).toFixed(1)} msg/s`,
      `other vessels heard: ${this.otherVesselCount(now)}`,
    ];
    const paths = [...this.paths.keys()].filter((p) => p !== "").sort();
    lines.push(`own-vessel paths (${paths.length}):`);
    for (const path of paths) {
      const s = this.paths.get(path) as SignalKPathSample;
      const age = ((now - s.receivedMs) / 1000).toFixed(1);
      const value = JSON.stringify(s.value) ?? "undefined";
      lines.push(`  ${path} = ${value} · ${age} s · ${s.source ?? "?"}`);
    }
    return lines.join("\n");
  }

  /** Other vessels (AIS targets) heard recently. */
  otherVesselCount(now: number): number {
    let n = 0;
    for (const seen of this.otherVessels.values()) {
      if (now - seen < VESSEL_PRESENT_MS) n += 1;
    }
    return n;
  }
}
