/**
 * Manages the active navigation provider and re-broadcasts data to subscribers.
 * Includes an adaptive-rate throttle gate that reduces GPS polling when
 * high-frequency updates aren't needed.
 */

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

export class NavigationDataManager {
  private providers: NavigationDataProvider[] = [];
  private activeProvider: NavigationDataProvider | null = null;
  private listeners: NavigationDataCallback[] = [];
  private lastData: NavigationData | null = null;

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
      // Manual mode: simple throttle
      const willBroadcast = this.adaptiveCtrl.shouldBroadcast(data.timestamp);
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

  getLastData(): NavigationData | null {
    return this.lastData;
  }

  setActiveProvider(id: string): void {
    if (this.activeProvider) {
      this.activeProvider.unsubscribe(this.onData);
      this.activeProvider.disconnect();
    }

    this.lastData = null;
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
    this.adaptiveCtrl.forceFast = value;
    if (value) {
      this.hintProviderInterval(this.adaptiveCtrl.getConfig().fastIntervalMs);
    }
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
  }
}
