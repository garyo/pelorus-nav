/**
 * Manages the active navigation provider and re-broadcasts data to subscribers.
 * Includes an adaptive-rate throttle gate that reduces GPS polling when
 * high-frequency updates aren't needed.
 */

import { AdaptiveRateController, type AdaptiveRateState } from "./AdaptiveRate";
import { gpsDiagLog } from "./GPSDiagnosticLog";
import { GPSFilter } from "./GPSFilter";
import type {
  NavigationData,
  NavigationDataCallback,
  NavigationDataProvider,
} from "./NavigationData";

export type RateMode = "adaptive" | "manual";

export class NavigationDataManager {
  private providers: NavigationDataProvider[] = [];
  private activeProvider: NavigationDataProvider | null = null;
  private listeners: NavigationDataCallback[] = [];
  private lastData: NavigationData | null = null;

  // GPS position filter (Kalman)
  private gpsFilter = new GPSFilter();
  // Adaptive rate control
  private adaptiveCtrl = new AdaptiveRateController();
  private rateMode: RateMode = "adaptive";
  private manualIntervalMs = 2000;
  private deferredTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingData: NavigationData | null = null;

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

    const data = this.gpsFilter.filter(raw);
    this.lastData = data;

    // Diagnostic: log Kalman-filtered output
    gpsDiagLog.logFiltered(data.latitude, data.longitude, data.sog, data.cog);

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

  private hintProviderInterval(ms: number): void {
    this.activeProvider?.setDesiredIntervalMs?.(ms);
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
    this.adaptiveCtrl.reset();
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
