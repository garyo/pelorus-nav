/**
 * Chart-load failure monitor: makes tile/source load failures visible instead
 * of silently rendering a blank chart. MapLibre reports fetch failures only as
 * map "error" events, so this module listens there, attributes each error to
 * charts vs. the street basemap by source id, classifies the cause, and shows
 * a single top-center StatusBanner naming everything that's failing and why
 * ("Can't load charts or street maps — no internet connection"). Every
 * distinct failure is also logged to the persistent app error log (surfaced
 * in shared diagnostics / bug reports) and to the console.
 *
 * The failure state is exposed as a ChartLoadStatus handle so ambient UI (the
 * chart-in-use pill) can show a persistent warning while the chart is wrong:
 * failures LATCH — MapLibre never re-requests a broken tile on its own, so a
 * failure stands until that source loads a tile (proof it works), leaves the
 * style (the user panned away), or a Retry rebuilds it.
 *
 * Honesty rules, learned the hard way:
 * - A real outage is *persistent*: sources keep erroring and nothing loads.
 *   Failures are tracked per source, a successful tile load clears only its
 *   own source's failures, and the state goes public only after a short grace
 *   period with the failure still standing — a slow connection (errors
 *   interleaved with successes) stays quiet, as do pan/zoom aborts.
 * - When offline there is no Retry button — retrying can't help, and coming
 *   back online refreshes the failed sources automatically. The "downloaded
 *   regions still work" reassurance appears only when there ARE downloaded
 *   regions.
 * - Dismissing the banner snoozes the banner only; the failure state (and
 *   the pill's warning) stand until the tiles actually load.
 */

import type * as maplibregl from "maplibre-gl";
import { CHART_REGIONS } from "../data/chart-catalog";
import { appErrorLog } from "../diagnostics/errorLog";
import { hideStatusBanner, showStatusBanner } from "../ui/StatusBanner";
import { availableRasterCharts } from "./raster-charts";

export type LoadFailureCategory = "chart" | "basemap";
export type LoadFailureReason =
  | "offline"
  | "network"
  | "server"
  | "missing"
  | "storage"
  | "unknown";

/** Errors per category before it counts as failing (1 when offline) — one
 *  lone error with everything else loading fine shouldn't alarm anyone. */
const CATEGORY_ERROR_THRESHOLD = 2;
/** The failure must still be standing this long after crossing the
 *  threshold before going public — a success meanwhile cancels it. */
const SHOW_GRACE_MS = 2_000;
/** How long a user dismissal keeps the banner (not the pill) away. */
const DISMISS_SNOOZE_MS = 60_000;
/** Minimum spacing between automatic retries (reconnect events). A retry is
 *  a full style rebuild that resets every in-flight tile — browsers can fire
 *  "online" in bursts (DevTools throttling, flaky interfaces), and retrying
 *  on each would keep the map permanently blank. */
const AUTO_RETRY_COOLDOWN_MS = 30_000;
/** Cap on distinct messages logged per session — a broken source repeats. */
const MAX_LOGGED = 50;

const BANNER_ID = "chart-load";

/** Attribute a failure key — a MapLibre source id, or a `file:<archive>`
 *  key from the protocol layer — to charts or the street basemap. */
export function categorizeSource(
  sourceId: string | undefined,
): LoadFailureCategory | null {
  if (!sourceId) return null;
  if (sourceId.startsWith("file:")) {
    return sourceId.slice("file:".length).startsWith("basemap-")
      ? "basemap"
      : "chart";
  }
  if (
    sourceId.startsWith("s57-") ||
    sourceId.startsWith("rnc-") ||
    sourceId.startsWith("noaa-")
  ) {
    return "chart";
  }
  if (sourceId.startsWith("basemap-underlay") || sourceId.startsWith("osm")) {
    return "basemap";
  }
  return null;
}

/** The `<name>.pmtiles` archive an internal protocol URL refers to. */
export function archiveFilename(url: string): string | null {
  return url.match(/([^/?#]+\.pmtiles)/)?.[1] ?? null;
}

type Bbox = [number, number, number, number];

const bboxIntersects = (a: Bbox, b: Bbox): boolean =>
  a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

/**
 * The geographic footprint a failure key affects, or null when unknown /
 * everywhere (e.g. osm-underlay). Keys are either MapLibre source ids
 * ("s57-vector-<region>", "rnc-<chart>") or protocol archive keys
 * ("file:nautical-<region>.pmtiles").
 */
export function boundsForKey(key: string): Bbox | null {
  const file = key.startsWith("file:") ? key.slice("file:".length) : null;
  for (const r of CHART_REGIONS) {
    if (
      key === `s57-vector-${r.id}` ||
      file === r.filename ||
      (r.basemapFilename && file === r.basemapFilename)
    ) {
      return r.bbox;
    }
  }
  for (const c of availableRasterCharts()) {
    if (key === `rnc-${c.id}` || file === c.filename) return c.bbox;
  }
  return null;
}

/**
 * Classify a load-error message into a user-explainable cause.
 * Returns null for aborted requests — normal churn when tiles leave the
 * viewport mid-fetch — which must count for nothing.
 */
export function classifyLoadError(
  message: string,
  online: boolean,
): LoadFailureReason | null {
  if (/abort/i.test(message)) return null;
  if (!online) return "offline";
  const m = message.toLowerCase();
  if (m.includes("notreadable") || m.includes("could not be read")) {
    return "storage";
  }
  // The server answered "no such thing" — distinct from server trouble:
  // the chart genuinely isn't available from this server.
  if (/\b404\b/.test(m) || m.includes("not found")) return "missing";
  // "Wrong magic number" = the server answered with something that isn't a
  // PMTiles archive (e.g. an HTML error page) — a server problem.
  if (/\b(4\d\d|5\d\d)\b/.test(m) || m.includes("magic number")) {
    return "server";
  }
  if (
    m.includes("failed to fetch") ||
    m.includes("networkerror") ||
    m.includes("load failed") ||
    m.includes("timed out") ||
    m.includes("timeout")
  ) {
    return "network";
  }
  return "unknown";
}

/** Most-informative-first: the aggregated reason is the highest of these
 *  present among the failing sources. */
const REASON_PRIORITY: LoadFailureReason[] = [
  "offline",
  "storage",
  "server",
  "missing",
  "network",
  "unknown",
];

export interface FailureSummary {
  /** Failing categories, chart first. */
  categories: LoadFailureCategory[];
  reason: LoadFailureReason;
}

interface SourceFailure {
  count: number;
  reason: LoadFailureReason;
  /** An archive/TileJSON-level failure: the whole source is dead, not one
   *  tile — counts as failing immediately (no corroboration needed). */
  sourceLevel: boolean;
}

/**
 * Per-source failure ledger (pure). A source's failures are cleared only by
 * its OWN success, so a healthy downloaded region can't mask a streaming
 * region that's genuinely down.
 */
export class ChartLoadHealth {
  private failures = new Map<string, SourceFailure>();

  recordError(
    sourceId: string,
    reason: LoadFailureReason,
    opts?: { sourceLevel?: boolean },
  ): void {
    const f = this.failures.get(sourceId);
    if (f) {
      f.count++;
      f.reason = reason;
      f.sourceLevel ||= opts?.sourceLevel ?? false;
    } else {
      this.failures.set(sourceId, {
        count: 1,
        reason,
        sourceLevel: opts?.sourceLevel ?? false,
      });
    }
  }

  /** A tile from this source arrived — forget its failures. Returns true if
   *  there was anything to forget (i.e. the situation changed). */
  recordSuccess(sourceId: string): boolean {
    return this.failures.delete(sourceId);
  }

  /** Drop failures for sources no longer in the style (the user panned away
   *  or the style was rebuilt without them). Returns true if any dropped. */
  prune(activeSourceIds: ReadonlySet<string>): boolean {
    let changed = false;
    for (const sourceId of this.failures.keys()) {
      if (!activeSourceIds.has(sourceId)) {
        this.failures.delete(sourceId);
        changed = true;
      }
    }
    return changed;
  }

  /** What's failing, or null when all is well. Offline failures count
   *  immediately; anything else needs a few errors in the category.
   *  `isRelevant` filters entries (e.g. to the current viewport) without
   *  forgetting them — an irrelevant failure counts again the moment it
   *  becomes relevant, with no new errors needed (MapLibre never re-fires
   *  them). */
  summary(isRelevant?: (sourceId: string) => boolean): FailureSummary | null {
    const counts: Record<LoadFailureCategory, number> = {
      chart: 0,
      basemap: 0,
    };
    const definitive: Record<LoadFailureCategory, boolean> = {
      chart: false,
      basemap: false,
    };
    const reasons: Record<LoadFailureCategory, Set<LoadFailureReason>> = {
      chart: new Set(),
      basemap: new Set(),
    };
    for (const [sourceId, f] of this.failures) {
      const category = categorizeSource(sourceId);
      if (!category) continue;
      if (isRelevant && !isRelevant(sourceId)) continue;
      counts[category] += f.count;
      reasons[category].add(f.reason);
      if (f.sourceLevel || f.reason === "offline") definitive[category] = true;
    }
    const failing = (["chart", "basemap"] as const).filter(
      (c) => counts[c] >= CATEGORY_ERROR_THRESHOLD || definitive[c],
    );
    if (failing.length === 0) return null;
    const all = new Set(failing.flatMap((c) => [...reasons[c]]));
    const reason =
      REASON_PRIORITY.find((r) => all.has(r)) ?? ("unknown" as const);
    return { categories: failing, reason };
  }
}

export function composeFailureMessage(
  summary: FailureSummary,
  hasOfflineCharts: boolean,
): string {
  const what =
    summary.categories.length === 2
      ? "charts or street maps"
      : summary.categories[0] === "chart"
        ? "charts"
        : "street maps";
  switch (summary.reason) {
    case "offline":
      return (
        `Can't load ${what} — no internet connection.` +
        (hasOfflineCharts ? " Downloaded regions still work." : "")
      );
    case "network":
      return `Can't load ${what} — network problem. Check your internet connection.`;
    case "server":
      return `Can't load ${what} — the chart server isn't responding. Try again later.`;
    case "missing":
      return `Some ${what} are not available from the chart server.`;
    case "storage":
      return "Can't read a downloaded chart from storage. Try re-downloading it in Chart Regions.";
    case "unknown":
      return `Can't load ${what}.`;
  }
}

export interface ChartLoadMonitorOptions {
  /** Re-create the failed sources (a full diff:false style rebuild, after
   *  evicting any poisoned streaming caches) — MapLibre never re-requests an
   *  errored tile or source header on its own. */
  retry: () => void;
  /** Whether any chart regions are downloaded for offline use — gates the
   *  "Downloaded regions still work" reassurance. */
  hasOfflineCharts?: () => boolean;
  /**
   * Whether the active region's offline street basemap is downloaded. When
   * it is, the network OSM raster underneath it is a best-effort extra —
   * its tile failures (routine when offline/offshore) must not alarm the
   * user with a "can't load street maps" banner while the downloaded
   * basemap is doing the job. Failures of the downloaded basemap itself
   * still report normally.
   */
  hasStoredStreetBasemap?: () => boolean;
}

/** Live view of the chart-load failure state, for ambient UI. */
export interface ChartLoadStatus {
  /** The standing (post-grace) failure, or null when all is well. */
  current(): FailureSummary | null;
  /** Notify on every change to current(); returns unsubscribe. */
  subscribe(listener: () => void): () => void;
  /** Bring the explanation banner back (e.g. after a dismissal). */
  reshowBanner(): void;
}

const summaryKey = (s: FailureSummary): string =>
  `${s.categories.join(",")}|${s.reason}`;

/**
 * Channel for archive fetch outcomes straight from the PMTiles protocol
 * layer (wrapped in main.ts). This exists because MapLibre fires NO map
 * "error" event when a source's TileJSON/header fetch fails — the region
 * just silently never renders. Events arriving before the monitor attaches
 * (the protocol registers first) are buffered.
 */
type ProtocolReport = (
  url: string,
  ok: boolean,
  message?: string,
  sourceLevel?: boolean,
) => void;
let protocolSink: ProtocolReport | null = null;
const earlyProtocolEvents: Parameters<ProtocolReport>[] = [];

export function reportChartFetch(
  url: string,
  ok: boolean,
  message?: string,
  sourceLevel?: boolean,
): void {
  if (protocolSink) protocolSink(url, ok, message, sourceLevel);
  else if (earlyProtocolEvents.length < 200) {
    earlyProtocolEvents.push([url, ok, message, sourceLevel]);
  }
}

/**
 * Attach the monitor to a map. Also funnels *uncategorized* MapLibre errors
 * (glyphs, style validation, …) into the app error log, since they surface
 * nowhere else.
 */
export function attachChartLoadMonitor(
  map: maplibregl.Map,
  options: ChartLoadMonitorOptions,
): ChartLoadStatus {
  const health = new ChartLoadHealth();
  const logged = new Set<string>();
  const listeners = new Set<() => void>();
  /** The standing failure — set only after the grace period confirms it. */
  let effective: FailureSummary | null = null;
  /** Whether the banner is currently on screen. */
  let bannerShown = false;
  let pendingShow: ReturnType<typeof setTimeout> | null = null;
  let snoozeUntil = 0;

  const logFailure = (src: string, detail: string): void => {
    const key = detail.slice(0, 200);
    if (logged.size >= MAX_LOGGED || logged.has(key)) return;
    logged.add(key);
    appErrorLog.log(src, "error", detail);
    console.warn(`[${src}] ${detail}`);
  };

  /** State transitions (failing / recovered / retry) — the story line a
   *  bug-report reader follows between the raw per-fetch errors. */
  const logTransition = (detail: string): void => {
    appErrorLog.log("chart-load", "diag", detail);
    console.info(`[chart-load] ${detail}`);
  };

  /** The archive behind a style source, if any — such sources' failures are
   *  already logged (with the archive name) by the protocol channel, so the
   *  map-error path must not log them a second time. */
  const sourceArchive = (sourceId: string): string | null => {
    const s = map.getStyle()?.sources?.[sourceId] as
      | { url?: string; tiles?: string[] }
      | undefined;
    if (!s) return null;
    for (const u of [s.url, ...(s.tiles ?? [])]) {
      const f = u ? archiveFilename(u) : null;
      if (f) return f;
    }
    return null;
  };

  const notify = (): void => {
    for (const l of listeners) l();
  };

  const showBanner = (summary: FailureSummary): void => {
    bannerShown = true;
    const offline = summary.reason === "offline";
    showStatusBanner({
      id: BANNER_ID,
      message: composeFailureMessage(
        summary,
        options.hasOfflineCharts?.() ?? false,
      ),
      // Offline, Retry can't succeed — reconnecting auto-refreshes instead.
      ...(offline
        ? {}
        : {
            actionLabel: "Retry",
            onAction: () => {
              logTransition("retry requested by user");
              options.retry();
            },
          }),
      onDismiss: () => {
        bannerShown = false;
        snoozeUntil = Date.now() + DISMISS_SNOOZE_MS;
      },
    });
  };

  // Only failures whose footprint intersects the current viewport count —
  // a latched failure for a region that's off-screen (or behind a healthy
  // downloaded region's edge) must not follow the user around. Entries are
  // kept, so panning back makes them count again with no new errors.
  const viewportRelevant = (): ((key: string) => boolean) => {
    const b = map.getBounds();
    const vp: Bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    // OSM raster failures stop mattering while a downloaded street basemap
    // covers for it (including ones latched before the basemap was
    // recognized); entries are kept, so they count again if it's deleted.
    const osmCovered = options.hasStoredStreetBasemap?.() ?? false;
    return (key) => {
      if (osmCovered && key.startsWith("osm")) return false;
      const bb = boundsForKey(key);
      return !bb || bboxIntersects(bb, vp);
    };
  };

  const evaluate = (): void => {
    const summary = health.summary(viewportRelevant());
    if (!summary) {
      if (pendingShow) {
        clearTimeout(pendingShow);
        pendingShow = null;
      }
      if (bannerShown) {
        bannerShown = false;
        hideStatusBanner(BANNER_ID);
      }
      if (effective) {
        effective = null;
        logTransition("recovered — all chart sources loading again");
        notify();
      }
      return;
    }
    if (effective) {
      if (summaryKey(summary) !== summaryKey(effective)) {
        effective = summary;
        logTransition(
          `still failing: ${summary.categories.join("+")} (${summary.reason})`,
        );
        notify();
        if (bannerShown) showBanner(summary); // update the message in place
      }
      // Snooze expired and the failure still stands — bring the banner back.
      if (!bannerShown && Date.now() >= snoozeUntil) showBanner(effective);
      return;
    }
    // First appearance waits out the grace period: if tiles are actually
    // getting through (slow connection, not an outage), a success clears
    // the failures meanwhile and the re-evaluation shows nothing.
    if (!pendingShow) {
      pendingShow = setTimeout(() => {
        pendingShow = null;
        const still = health.summary(viewportRelevant());
        if (!still) return;
        effective = still;
        logTransition(
          `failing: ${still.categories.join("+")} (${still.reason})`,
        );
        notify();
        if (Date.now() >= snoozeUntil) showBanner(still);
      }, SHOW_GRACE_MS);
    }
  };

  map.on("error", (e) => {
    const msg = e.error?.message ?? String(e.error ?? "unknown map error");
    const sourceId = (e as { sourceId?: string }).sourceId;
    const category = categorizeSource(sourceId);
    if (!category || !sourceId) {
      logFailure("maplibre", msg);
      return;
    }
    const reason = classifyLoadError(msg, navigator.onLine);
    if (!reason) return;
    // The network OSM raster is only an enhancement beneath a downloaded
    // street basemap — don't let its (expected) offline failures raise the
    // street-maps banner when the stored basemap is covering for it.
    if (sourceId.startsWith("osm") && options.hasStoredStreetBasemap?.()) {
      return;
    }
    // Archive-backed sources are already logged by the protocol channel.
    if (!sourceArchive(sourceId)) {
      logFailure("chart-load", `${sourceId}: ${msg} [${reason}]`);
    }
    health.recordError(sourceId, reason);
    evaluate();
  });

  // Success signals clear a source's failures and re-evaluate (may downgrade
  // the message or clear the state). Two count: a tile actually arriving,
  // and the source's metadata loading — a source whose header failed may
  // have no tiles to request in the current view (e.g. a region barely on
  // screen), so a Retry's metadata reload is its only proof of recovery.
  map.on("data", (e) => {
    if (e.dataType !== "source") return;
    const ok =
      (e as { tile?: unknown }).tile !== undefined ||
      (e as { sourceDataType?: string }).sourceDataType === "metadata";
    if (!ok) return;
    const sid = (e as { sourceId?: string }).sourceId;
    if (sid && health.recordSuccess(sid)) evaluate();
  });

  // Archive fetch outcomes from the protocol layer — the only reliable
  // signal for a source whose TileJSON/header fetch fails (MapLibre stays
  // silent) and a clean success signal for the same archive.
  protocolSink = (url, ok, message, sourceLevel) => {
    const filename = archiveFilename(url);
    if (!filename) return;
    const key = `file:${filename}`;
    if (ok) {
      if (health.recordSuccess(key)) evaluate();
      return;
    }
    const reason = classifyLoadError(message ?? "", navigator.onLine);
    if (!reason) return;
    logFailure(
      "chart-load",
      `${filename}: ${message ?? "fetch failed"} [${reason}${sourceLevel ? ", whole archive" : ""}]`,
    );
    health.recordError(key, reason, { sourceLevel });
    evaluate();
  };
  for (const args of earlyProtocolEvents.splice(0)) protocolSink(...args);

  // Failures of sources that no longer feed any LAYER (panned away,
  // provider switch) can't make the current chart wrong — drop them, along
  // with file: entries for archives those sources referenced. Keyed on
  // layers, not style.sources: the style carries every region's source at
  // all times, but only in-view regions get layers. Debounced: styledata
  // fires mid-rebuild when layers are partially applied, and pruning
  // against a transient half-style would drop legitimate failures MapLibre
  // will never re-report.
  let pruneTimer: ReturnType<typeof setTimeout> | null = null;
  map.on("styledata", () => {
    if (pruneTimer) clearTimeout(pruneTimer);
    pruneTimer = setTimeout(() => {
      pruneTimer = null;
      const style = map.getStyle();
      if (!style) return;
      const used = new Set<string>();
      for (const layer of style.layers) {
        const src = (layer as { source?: string }).source;
        if (src) used.add(src);
      }
      const active = new Set<string>();
      for (const [id, s] of Object.entries(style.sources)) {
        if (!used.has(id)) continue;
        active.add(id);
        const urls = [
          (s as { url?: string }).url,
          ...((s as { tiles?: string[] }).tiles ?? []),
        ];
        for (const u of urls) {
          const f = u ? archiveFilename(u) : null;
          if (f) active.add(`file:${f}`);
        }
      }
      if (health.prune(active)) evaluate();
    }, 500);
  });

  // Re-scope the failure state to the viewport after each move. Debounced,
  // and a handful of bbox tests at most — no per-frame work.
  let moveTimer: ReturnType<typeof setTimeout> | null = null;
  map.on("moveend", () => {
    if (moveTimer) clearTimeout(moveTimer);
    moveTimer = setTimeout(() => {
      moveTimer = null;
      evaluate();
    }, 300);
  });

  // Back online: refresh failed sources rather than waiting for the user to
  // pan (MapLibre doesn't retry errored tiles on its own). Only for a
  // CONFIRMED standing failure, and rate-limited — see the cooldown note.
  let lastAutoRetry = 0;
  window.addEventListener("online", () => {
    if (!effective) return;
    const now = Date.now();
    if (now - lastAutoRetry < AUTO_RETRY_COOLDOWN_MS) return;
    lastAutoRetry = now;
    logTransition("auto-retry: back online with a standing failure");
    options.retry();
  });

  return {
    current: () => effective,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reshowBanner: () => {
      if (!effective) return;
      snoozeUntil = 0;
      showBanner(effective);
    },
  };
}
