/**
 * Manages the active navigation provider and re-broadcasts data to subscribers.
 * Includes an adaptive-rate throttle gate that reduces GPS polling when
 * high-frequency updates aren't needed.
 */

import { diag } from "../utils/diag";
import { AdaptiveRateController, type AdaptiveRateState } from "./AdaptiveRate";
import { gpsDiagLog } from "./GPSDiagnosticLog";
import { GPSFilter } from "./GPSFilter";
import { GPSQualityDetector } from "./GPSQualityDetector";
import type {
  NavigationData,
  NavigationDataCallback,
  NavigationDataProvider,
} from "./NavigationData";

export type RateMode = "adaptive" | "manual";
export type FilterMode = "auto" | "strong" | "normal";

export type QualityListener = (q: number) => void;

/**
 * When GPS quality is bad we ask the hardware for fixes at this rate, even
 * if the broadcast interval (what the UI sees) is slower. More raw samples
 * into the Kalman → better averaging of the jitter. 1 Hz is universally
 * supported by Android GPS chips; weaker chips deliver slower regardless
 * (radio duty cycles on actual fix production, so the ask costs nothing
 * extra when the chip can't keep up).
 */
const FAST_HW_SAMPLING_MS = 1000;

/** Quality score above which we boost hardware polling in "auto" mode. */
const HW_BOOST_QUALITY_THRESHOLD = 0.3;

/** Per-fix GPS trace to the native diag.log (pull via adb). Off in shipping
 *  builds; flip on to debug a new GPS source / hardware iteration — it logs
 *  raw vs filtered SOG/COG and raw/filtered lat/lon for offline analysis. */
const GPS_TRACE = false;
const tr = (n: number | null): string =>
  n === null ? "-" : (Math.round(n * 100) / 100).toString();
/** ~0.1 m precision — enough to reconstruct the raw track offline. */
const co = (n: number): string => n.toFixed(6);

/** Floor for the staleness threshold so slow broadcast rates still flag a
 *  dropped link within a few seconds. */
export const GPS_STALE_FLOOR_MS = 4000;

/**
 * A fix is "stale" once its age exceeds 2.5 broadcast intervals (floored at
 * {@link GPS_STALE_FLOOR_MS}). Past this, live motion values (SOG/COG) are no
 * longer trustworthy — the HUDs blank them and show a "no GPS" indicator.
 */
export function gpsStaleThresholdMs(broadcastIntervalMs: number): number {
  return Math.max(GPS_STALE_FLOOR_MS, broadcastIntervalMs * 2.5);
}

export class NavigationDataManager {
  private providers: NavigationDataProvider[] = [];
  private activeProvider: NavigationDataProvider | null = null;
  private listeners: NavigationDataCallback[] = [];
  private lastData: NavigationData | null = null;
  /** Wall-clock time of the last broadcast; drives fix-staleness detection. */
  private lastBroadcastWallMs = Number.NEGATIVE_INFINITY;
  /** Wall-clock of last RAW fix into onData — GPS_TRACE inter-fix interval. */
  private lastRawWallMs = 0;

  // GPS position filter (Kalman)
  private gpsFilter = new GPSFilter();
  // GPS quality detector (feeds adaptive filter strength)
  private qualityDetector = new GPSQualityDetector();
  private filterMode: FilterMode = "auto";
  private qualityListeners: QualityListener[] = [];
  // Adaptive rate control
  private adaptiveCtrl = new AdaptiveRateController();
  private rateMode: RateMode = "adaptive";
  private manualIntervalMs = 2000;
  private deferredTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingData: NavigationData | null = null;
  /** Last interval hinted to the provider — avoids redundant native IPC. */
  private lastHintedIntervalMs = -1;
  /** Screen policy asks for the fast tier (non-e-ink themes). */
  private screenWantsFast = false;
  /** App visibility (see setVisible) — effective force-fast needs both. */
  private visible = true;

  private readonly onData: NavigationDataCallback = (raw) => {
    // Diagnostic: log raw GPS fix
    gpsDiagLog.logRaw(
      raw.timestamp,
      raw.latitude,
      raw.longitude,
      raw.sog,
      raw.cog,
      raw.accuracy ?? null,
    );

    // Update quality detector on raw fix, then derive effective q from mode.
    const sigs = this.qualityDetector.onFix(raw);
    const q =
      this.filterMode === "strong"
        ? 1
        : this.filterMode === "normal"
          ? 0
          : sigs.q;

    const data = this.gpsFilter.filter(raw, q);
    this.lastData = data;

    if (GPS_TRACE) {
      const nowMs = Date.now();
      const dt = this.lastRawWallMs ? nowMs - this.lastRawWallMs : 0;
      this.lastRawWallMs = nowMs;
      // raw_sog = module Doppler; filt_sog = Kalman-derived (what the UI shows).
      diag(
        "gps",
        `fix dt=${dt} raw_sog=${tr(raw.sog)} raw_cog=${tr(raw.cog)} ` +
          `filt_sog=${tr(data.sog)} filt_cog=${tr(data.cog)} acc=${tr(raw.accuracy)} ` +
          `q=${tr(q)} tier=${this.adaptiveCtrl.getState().tier} ` +
          `raw_lat=${co(raw.latitude)} raw_lon=${co(raw.longitude)} ` +
          `filt_lat=${co(data.latitude)} filt_lon=${co(data.longitude)}`,
      );
    }

    // Notify quality listeners (main.ts feeds this into CourseSmoothing)
    for (const fn of this.qualityListeners) fn(q);

    // Diagnostic: log Kalman-filtered output + quality
    gpsDiagLog.logFiltered(data.latitude, data.longitude, data.sog, data.cog);
    gpsDiagLog.logQuality(q);

    // Reconcile hardware polling rate with current quality. When quality
    // is bad we ask the hardware for more frequent samples so the Kalman
    // has more data to smooth — independent of the broadcast throttle.
    // Idempotent when the effective rate hasn't changed.
    const broadcastIntv =
      this.rateMode === "adaptive"
        ? this.adaptiveCtrl.getState().intervalMs
        : this.manualIntervalMs;
    this.hintProviderInterval(broadcastIntv);

    if (this.rateMode === "adaptive") {
      const prevTier = this.adaptiveCtrl.getState().tier;
      this.adaptiveCtrl.onFix(data);
      const newTier = this.adaptiveCtrl.getState().tier;

      // Immediate broadcast on tier upgrade to fast
      const tierUpgraded = prevTier !== "fast" && newTier === "fast";

      const willBroadcast =
        tierUpgraded || this.adaptiveCtrl.shouldBroadcast(data.timestamp);

      // Diagnostic: log adaptive state (commit deferred to main.ts after smoothed log)
      gpsDiagLog.logAdaptive(
        newTier,
        this.adaptiveCtrl.getState().intervalMs,
        willBroadcast,
      );

      if (willBroadcast) {
        this.broadcast(data);
        this.adaptiveCtrl.markBroadcast(data.timestamp);
        this.hintProviderInterval(this.adaptiveCtrl.getState().intervalMs);
      } else {
        // Schedule a deferred broadcast so we never go silent
        this.scheduleDeferredBroadcast(data);
      }
    } else {
      // Manual mode: simple throttle at the user-chosen interval
      const willBroadcast = this.adaptiveCtrl.shouldBroadcast(
        data.timestamp,
        this.manualIntervalMs,
      );
      gpsDiagLog.logAdaptive("manual", this.manualIntervalMs, willBroadcast);

      if (willBroadcast) {
        this.broadcast(data);
        this.adaptiveCtrl.markBroadcast(data.timestamp);
      } else {
        this.scheduleDeferredBroadcast(data);
      }
    }
    // Commit diagnostic entry (idempotent — skips if already committed by subscriber)
    gpsDiagLog.commit();
  };

  private broadcast(data: NavigationData): void {
    this.clearDeferredTimer();
    if (GPS_TRACE) {
      const since = Number.isFinite(this.lastBroadcastWallMs)
        ? Date.now() - this.lastBroadcastWallMs
        : 0;
      diag(
        "gps",
        `bcast dt=${since} sog=${tr(data.sog)} tier=${this.adaptiveCtrl.getState().tier}`,
      );
    }
    this.lastBroadcastWallMs = Date.now();
    for (const fn of this.listeners) {
      fn(data);
    }
  }

  private scheduleDeferredBroadcast(data: NavigationData): void {
    this.pendingData = data;
    if (this.deferredTimer !== null) return; // already scheduled

    const interval =
      this.rateMode === "adaptive"
        ? this.adaptiveCtrl.getState().intervalMs
        : this.manualIntervalMs;

    this.deferredTimer = setTimeout(() => {
      this.deferredTimer = null;
      const data = this.pendingData;
      if (data) {
        this.broadcast(data);
        this.adaptiveCtrl.markBroadcast(data.timestamp);
        this.hintProviderInterval(
          this.rateMode === "adaptive"
            ? this.adaptiveCtrl.getState().intervalMs
            : this.manualIntervalMs,
        );
        this.pendingData = null;
      }
    }, interval);
  }

  private clearDeferredTimer(): void {
    if (this.deferredTimer !== null) {
      clearTimeout(this.deferredTimer);
      this.deferredTimer = null;
    }
    this.pendingData = null;
  }

  /**
   * The broadcast interval is what the UI sees. The hardware-polling
   * interval can be faster when the quality detector flags a jittery GPS,
   * so the Kalman filter gets more raw samples to average over. Hardware
   * rate never goes *slower* than the broadcast rate.
   */
  private effectiveHwIntervalMs(broadcastMs: number): number {
    const q = this.qualityDetector.getSignals().q;
    const boost =
      this.filterMode === "strong" ||
      (this.filterMode === "auto" && q > HW_BOOST_QUALITY_THRESHOLD);
    if (boost) return Math.min(broadcastMs, FAST_HW_SAMPLING_MS);
    return broadcastMs;
  }

  private hintProviderInterval(broadcastMs: number): void {
    const hw = this.effectiveHwIntervalMs(broadcastMs);
    if (hw === this.lastHintedIntervalMs) return;
    this.lastHintedIntervalMs = hw;
    this.activeProvider?.setDesiredIntervalMs?.(hw);
  }

  registerProvider(provider: NavigationDataProvider): void {
    this.providers.push(provider);
  }

  getProviders(): readonly NavigationDataProvider[] {
    return this.providers;
  }

  getActiveProvider(): NavigationDataProvider | null {
    return this.activeProvider;
  }

  /** Force a manual reconnect on the active provider, if it supports one. */
  reconnectActiveProvider(): void {
    this.activeProvider?.reconnect?.();
  }

  /**
   * Hard-reset the active provider's connection — a full disconnect then
   * connect, the programmatic equivalent of toggling the GPS source off/on to
   * clear a wedged link. Subscriptions persist across the cycle.
   */
  resetActiveProvider(): void {
    const provider = this.activeProvider;
    if (!provider) return;
    provider.disconnect();
    provider.connect();
  }

  getLastData(): NavigationData | null {
    return this.lastData;
  }

  /** Wall-clock ms since the last fix was broadcast (Infinity before any fix
   *  or after a provider switch / disconnect). */
  getFixAgeMs(): number {
    return Date.now() - this.lastBroadcastWallMs;
  }

  /** Why there's no usable fix right now — drives the HUD badge text so the
   *  user knows what to check:
   *  - "no-gps":  no source connected at all → set up / reconnect a source
   *  - "no-data": transport link is up but nothing is arriving → check the
   *               device (the GPS-pod failure mode)
   *  - "no-fix":  sentences are flowing but carry no valid fix → wait for
   *               satellites (or providers that can't report raw data flow)
   *  Only meaningful while isFixStale() is true. */
  fixlessState(): "no-gps" | "no-data" | "no-fix" {
    const provider = this.activeProvider;
    if (!provider?.isConnected()) return "no-gps";
    const rawMs = provider.lastRawDataMs?.();
    if (rawMs !== undefined) {
      const intervalMs =
        this.rateMode === "adaptive"
          ? this.adaptiveCtrl.getState().intervalMs
          : this.manualIntervalMs;
      if (Date.now() - rawMs >= gpsStaleThresholdMs(intervalMs)) {
        return "no-data";
      }
    }
    return "no-fix";
  }

  /** One-shot navigation-state summary for the diagnostics bundle — the
   *  "what is the GPS doing RIGHT NOW" a bug report needs. */
  diagnosticsSnapshot(): string {
    const p = this.activeProvider;
    if (!p) return "provider: (none)";
    const lines = [
      `provider: ${p.name} (${p.id})`,
      `connected: ${p.isConnected()}${p.isReconnecting?.() ? " (reconnecting)" : ""}`,
    ];
    const raw = p.lastRawDataMs?.();
    if (raw !== undefined) {
      lines.push(
        `raw data age: ${raw === 0 ? "(never this connection)" : `${Date.now() - raw} ms`}`,
      );
    }
    const fixAge = this.getFixAgeMs();
    lines.push(
      `fix age: ${Number.isFinite(fixAge) ? `${Math.round(fixAge)} ms` : "(no fix this session)"}`,
      `state: ${this.isFixStale() ? this.fixlessState().toUpperCase() : "live fix"}`,
    );
    return lines.join("\n");
  }

  /** The active provider's device-side status hook (the GPS pod's "DIAG"
   *  command), when the transport has one. Resolves null quickly otherwise —
   *  never blocks diagnostics collection. */
  requestDeviceDiag(): Promise<string | null> {
    return this.activeProvider?.requestDeviceDiag?.() ?? Promise.resolve(null);
  }

  /** True when no fix has arrived recently enough to trust live motion data.
   *  The HUDs use this to blank SOG/COG and flag GPS loss. */
  isFixStale(): boolean {
    const intervalMs =
      this.rateMode === "adaptive"
        ? this.adaptiveCtrl.getState().intervalMs
        : this.manualIntervalMs;
    return this.getFixAgeMs() >= gpsStaleThresholdMs(intervalMs);
  }

  setActiveProvider(id: string): void {
    if (this.activeProvider) {
      this.activeProvider.unsubscribe(this.onData);
      this.activeProvider.disconnect();
    }

    this.lastData = null;
    this.lastBroadcastWallMs = Number.NEGATIVE_INFINITY;
    this.clearDeferredTimer();
    this.gpsFilter.reset();
    this.qualityDetector.reset();
    this.adaptiveCtrl.reset();
    this.lastHintedIntervalMs = -1;
    const provider = this.providers.find((p) => p.id === id) ?? null;
    this.activeProvider = provider;

    if (provider) {
      provider.subscribe(this.onData);
      provider.connect();
    }
  }

  /** Set rate mode and manual interval. */
  setRateMode(mode: RateMode, manualIntervalMs?: number): void {
    this.rateMode = mode;
    if (manualIntervalMs !== undefined) {
      this.manualIntervalMs = manualIntervalMs;
    }
    if (mode === "manual") {
      this.hintProviderInterval(this.manualIntervalMs);
    } else {
      // In adaptive mode, hint current tier interval
      this.hintProviderInterval(this.adaptiveCtrl.getState().intervalMs);
    }
  }

  /** Get the current adaptive rate state (for HUD display). */
  getAdaptiveState(): Readonly<AdaptiveRateState> {
    return this.adaptiveCtrl.getState();
  }

  getRateMode(): RateMode {
    return this.rateMode;
  }

  /** Set the GPS filter strength mode (auto-detect, forced strong, forced normal). */
  setFilterMode(mode: FilterMode): void {
    this.filterMode = mode;
    // Re-hint so a flip to "strong" boosts HW rate immediately.
    const broadcastIntv =
      this.rateMode === "adaptive"
        ? this.adaptiveCtrl.getState().intervalMs
        : this.manualIntervalMs;
    this.hintProviderInterval(broadcastIntv);
  }

  getFilterMode(): FilterMode {
    return this.filterMode;
  }

  /** Read the latest detector signals (for HUD/debug). */
  getQualitySignals() {
    return this.qualityDetector.getSignals();
  }

  /** Subscribe to quality-score updates (emitted on every raw fix). */
  onQualityChange(fn: QualityListener): () => void {
    this.qualityListeners.push(fn);
    return () => {
      const idx = this.qualityListeners.indexOf(fn);
      if (idx >= 0) this.qualityListeners.splice(idx, 1);
    };
  }

  /** Lock adaptive tier to "fast" (non-e-ink screen on). */
  set forceFastRate(value: boolean) {
    this.screenWantsFast = value;
    this.applyForceFast();
  }

  /**
   * App visibility, injected by main.ts (this class stays DOM-free). Hidden,
   * nobody is watching the fast tier, so the screen's force-fast lock yields
   * to the adaptive controller — which still keeps fast during maneuvers
   * (track fidelity) and drops to the slow tiers when steady or stationary.
   * Deliberately not a hard clamp to slow while hidden.
   */
  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    this.applyForceFast();
  }

  private applyForceFast(): void {
    const effective = this.screenWantsFast && this.visible;
    if (this.adaptiveCtrl.forceFast === effective) return;
    this.adaptiveCtrl.forceFast = effective;
    // Re-hint so the provider's polling rate tracks the tier change now
    // rather than on the next fix.
    this.hintProviderInterval(
      effective
        ? this.adaptiveCtrl.getConfig().fastIntervalMs
        : this.rateMode === "adaptive"
          ? this.adaptiveCtrl.getState().intervalMs
          : this.manualIntervalMs,
    );
  }

  subscribe(callback: NavigationDataCallback): void {
    this.listeners.push(callback);
  }

  unsubscribe(callback: NavigationDataCallback): void {
    const idx = this.listeners.indexOf(callback);
    if (idx >= 0) this.listeners.splice(idx, 1);
  }

  dispose(): void {
    if (this.activeProvider) {
      this.activeProvider.unsubscribe(this.onData);
      this.activeProvider.disconnect();
    }
    this.clearDeferredTimer();
    this.listeners.length = 0;
    this.lastData = null;
    this.lastBroadcastWallMs = Number.NEGATIVE_INFINITY;
  }
}
