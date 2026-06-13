/**
 * Native (Capacitor) GPS power management: a single visibility/recording/idle
 * driven state machine that picks between "active" (fast, every fix to JS) and
 * "passive" (slow, bridge-silenced, wake-lock-toggled) GPS modes. Both modes
 * request HIGH_ACCURACY with setWaitForAccurateLocation(true) so FLP only
 * delivers real GPS fixes, never cell-tower / WiFi fallbacks.
 *
 * Visible:                  active mode at the chosen rate (1 s normally,
 *                           5 s in e-ink theme since the panel can't update
 *                           faster anyway; backed off to the idle rate when
 *                           untouched, but never faster than the theme rate).
 * Hidden + recording:       grace 20 s at the previous active rate, then
 *                           passive at 15 s (extended to 30 s on steady course
 *                           by the native SteadinessTracker). Snap back to
 *                           active on visible.
 * Hidden + not recording:   stop the native GPS entirely.
 */

import { getSettings, onSettingsChange } from "../settings";
import { createIdleDetector, type IdleDetector } from "../ui/IdleDetector";
import { diag } from "../utils/diag";

export interface GpsPowerConfig {
  /** Native-side delay before a hidden+recording device drops to passive. */
  hiddenGraceMs: number;
  /** Passive (hidden + recording) sampling interval. */
  passiveIntervalMs: number;
  /** Active sampling interval on a normal display. */
  activeIntervalMs: number;
  /** Active sampling interval in e-ink theme (panel can't update faster). */
  einkActiveIntervalMs: number;
  /** Backed-off interval once the user has been idle (anchor / autopilot). */
  idleIntervalMs: number;
  /** Inactivity before we consider the user idle. */
  idleTimeoutMs: number;
  /** Sampling interval while a maneuver/stop burst is in effect. */
  burstActiveIntervalMs: number;
}

export const DEFAULT_GPS_POWER_CONFIG: GpsPowerConfig = {
  hiddenGraceMs: 20_000,
  passiveIntervalMs: 15_000,
  activeIntervalMs: 1_000,
  einkActiveIntervalMs: 5_000,
  idleIntervalMs: 3_000,
  idleTimeoutMs: 30_000,
  burstActiveIntervalMs: 2_000,
};

export type GpsPowerDecision =
  | { mode: "active"; intervalMs: number }
  | { mode: "passive"; intervalMs: number; graceMs: number }
  | { mode: "stopped" };

export interface GpsPowerInputs {
  visible: boolean;
  recording: boolean;
  idle: boolean;
  eink: boolean;
  /** A maneuver/stop burst is in effect (see AdaptiveRate burst window). */
  burst: boolean;
}

/**
 * Pure decision: given the current inputs, what native GPS power state should
 * the device be in? All the branching lives here so it can be unit-tested
 * without a real provider, DOM, or native bridge.
 */
export function decideGpsPower(
  inputs: GpsPowerInputs,
  config: GpsPowerConfig = DEFAULT_GPS_POWER_CONFIG,
): GpsPowerDecision {
  if (inputs.visible) {
    let base = inputs.eink
      ? config.einkActiveIntervalMs
      : config.activeIntervalMs;
    // A turn or stop is exactly when situational awareness matters: a burst
    // overrides both the e-ink baseline and the idle back-off (autopilot
    // users are idle by definition when the course suddenly changes).
    if (inputs.burst) base = Math.min(base, config.burstActiveIntervalMs);
    // Idle slows GPS down; never let it speed up a slower baseline (e-ink).
    const intervalMs =
      inputs.idle && !inputs.burst
        ? Math.max(config.idleIntervalMs, base)
        : base;
    return { mode: "active", intervalMs };
  }
  if (inputs.recording) {
    return {
      mode: "passive",
      intervalMs: config.passiveIntervalMs,
      graceMs: config.hiddenGraceMs,
    };
  }
  return { mode: "stopped" };
}

/**
 * Stable string identity of a decision, including the parameters that reach
 * the native side. Two decisions with the same key are the same native power
 * command, so re-issuing one is redundant.
 */
export function powerDecisionKey(d: GpsPowerDecision): string {
  switch (d.mode) {
    case "active":
      return `active:${d.intervalMs}`;
    case "passive":
      return `passive:${d.intervalMs}:${d.graceMs}`;
    case "stopped":
      return "stopped";
  }
}

/**
 * Whether an "active" decision needs a native (re)start. The service is only
 * ever stopped by the hidden+!recording "stopped" branch, so resuming is
 * needed solely when coming from there (or the initial apply). Active→active
 * rate changes (the burst 2000↔5000 ms flip) and passive→active must NOT
 * restart the foreground service — that churn re-issues a startForegroundService
 * and re-installs the bridge on every burst toggle.
 */
export function needsResume(
  prevKey: string | null,
  next: GpsPowerDecision,
): boolean {
  return next.mode === "active" && (prevKey === null || prevKey === "stopped");
}

/** Native GPS provider surface the manager drives. */
export interface GpsPowerSink {
  resumeTracking(): void;
  setPowerMode(
    mode: "active" | "passive",
    intervalMs?: number,
    graceMs?: number,
  ): void;
  pauseTracking(): void;
}

/** Recording state source the manager reacts to. */
export interface RecordingSource {
  isRecording(): boolean;
  onRecordingChange(fn: () => void): void;
}

/**
 * Wires the decision to its event sources (page visibility, recording state,
 * idle detector, theme changes) and applies it to the native provider.
 */
export class GpsPowerManager {
  private readonly gps: GpsPowerSink;
  private readonly recorder: RecordingSource;
  private readonly config: GpsPowerConfig;
  private readonly idle: IdleDetector;
  /** Key of the last decision actually applied, for coalescing repeats. */
  private lastAppliedKey: string | null = null;
  /** Epoch ms until which the maneuver/stop burst rate applies. */
  private burstUntil = 0;
  private burstTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    gps: GpsPowerSink,
    recorder: RecordingSource,
    config: GpsPowerConfig = DEFAULT_GPS_POWER_CONFIG,
  ) {
    this.gps = gps;
    this.recorder = recorder;
    this.config = config;
    this.idle = createIdleDetector(config.idleTimeoutMs);
  }

  /**
   * Extend the burst-rate window to the given epoch ms (from the adaptive
   * controller's burst state). Re-applies immediately and schedules the
   * drop back to the baseline rate at expiry, so the rate recovers even
   * if no further fixes arrive.
   */
  setBurstUntil(untilMs: number): void {
    if (untilMs === this.burstUntil) return;
    this.burstUntil = untilMs;
    if (this.burstTimer) clearTimeout(this.burstTimer);
    this.burstTimer = null;
    const remaining = untilMs - Date.now();
    if (remaining > 0) {
      this.burstTimer = setTimeout(() => {
        this.burstTimer = null;
        this.apply();
      }, remaining + 250);
    }
    this.apply();
  }

  /** Subscribe to event sources and apply the initial (visible) state. */
  start(): void {
    document.addEventListener("visibilitychange", this.apply);
    this.recorder.onRecordingChange(this.apply);
    // Idle and theme only change the visible-mode rate, so re-apply only then.
    this.idle.onChange(this.applyIfVisible);
    onSettingsChange(this.applyIfVisible);
    this.apply();
  }

  private isVisible(): boolean {
    return document.visibilityState === "visible";
  }

  private applyIfVisible = (): void => {
    if (this.isVisible()) this.apply();
  };

  private apply = (): void => {
    const inputs = {
      visible: this.isVisible(),
      recording: this.recorder.isRecording(),
      idle: this.idle.isIdle(),
      eink: getSettings().displayTheme === "eink",
      burst: Date.now() < this.burstUntil,
    };
    const decision = decideGpsPower(inputs, this.config);

    // Coalesce redundant repeats: the visibility, recording, idle, and
    // settings listeners can all fire apply() for one logical event. Without
    // this, recording-start alone re-issues ~10 identical FGS restarts. Only
    // act when the resolved native command actually changes.
    const key = powerDecisionKey(decision);
    if (key === this.lastAppliedKey) return;
    const prevKey = this.lastAppliedKey;
    this.lastAppliedKey = key;

    diag(
      "power",
      `visible=${inputs.visible} rec=${inputs.recording} idle=${inputs.idle} -> ${decision.mode}`,
    );
    switch (decision.mode) {
      case "active":
        // Only restart the native service when it was actually stopped (the
        // hidden+!recording branch). Skipping this on rate changes avoids a
        // redundant startForegroundService on every burst toggle.
        if (needsResume(prevKey, decision)) this.gps.resumeTracking();
        this.gps.setPowerMode("active", decision.intervalMs);
        break;
      case "passive":
        this.gps.setPowerMode("passive", decision.intervalMs, decision.graceMs);
        break;
      case "stopped":
        this.gps.pauseTracking();
        break;
    }
  };
}
