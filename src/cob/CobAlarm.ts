/**
 * Repeating two-tone attention alarm via Web Audio plus device vibration,
 * used for crew-overboard and other alerts that need distinct cadences.
 * Muting gates the output but keeps the loop running, so unmute is instant.
 * All audio calls are guarded — a missing or blocked AudioContext (headless
 * tests, autoplay policy after a crash-restore with no user gesture) degrades
 * to silence and reports via onBlockedChange so the UI can offer a "tap to
 * enable sound" unlock.
 */

/** Cadence and timbre of the siren; every field defaults to the COB alarm. */
import { playTone } from "../utils/tone";

export interface CobAlarmOptions {
  /** The tone frequencies (Hz), played in order within each beat. */
  toneHz?: number[];
  /** Duration of each tone, in milliseconds. */
  toneMs?: number;
  /** Silence between successive tones within a beat, in milliseconds. */
  toneGapMs?: number;
  /** Gap between the start of successive beats, in milliseconds. */
  beatIntervalMs?: number;
  /** Peak oscillator gain, 0–1. */
  gain?: number;
  /** Vibration burst per beat, as navigator.vibrate's on/off milliseconds. */
  vibratePattern?: number[];
}

/**
 * The COB siren, and the base every other alarm varies from. Exported because
 * the Android service plays the same cadence from a pre-rendered WAV
 * (tools/gen-alarm-sounds.ts) and must not drift from what Web Audio does.
 */
export const COB_ALARM_DEFAULTS: Required<CobAlarmOptions> = {
  toneHz: [880, 660],
  toneMs: 400,
  toneGapMs: 0,
  beatIntervalMs: 1200,
  gain: 0.4,
  vibratePattern: [400, 200, 400],
};

export class CobAlarm {
  /** User loudness scale (anchor alarm volume slider), 0-1. */
  private volumeScale = 1;

  /** Scale the alarm's loudness; takes effect from the next tone onward. */
  setVolume(scale: number): void {
    this.volumeScale = Math.min(1, Math.max(0, scale));
  }

  private ctx: AudioContext | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private muted = false;
  private blocked = false;
  private blockedListeners: Array<(blocked: boolean) => void> = [];
  private readonly opts: Required<CobAlarmOptions>;

  constructor(options: CobAlarmOptions = {}) {
    this.opts = { ...COB_ALARM_DEFAULTS, ...options };
  }

  /** Begin the alarm loop. Safe to call from any context; best from a user gesture. */
  start(muted: boolean): void {
    this.muted = muted;
    if (this.interval) return;
    this.ensureContext();
    this.beat();
    this.interval = setInterval(() => this.beat(), this.opts.beatIntervalMs);
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    try {
      navigator.vibrate?.(0);
    } catch {
      // vibration unsupported
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  isMuted(): boolean {
    return this.muted;
  }

  isRunning(): boolean {
    return this.interval !== null;
  }

  /** True when audio can't play (autoplay policy) and needs a user gesture. */
  isBlocked(): boolean {
    return this.blocked;
  }

  onBlockedChange(cb: (blocked: boolean) => void): void {
    this.blockedListeners.push(cb);
  }

  /** Call from any user gesture to unlock audio blocked by autoplay policy. */
  retryUnlock(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "suspended") return;
    ctx.resume().then(
      () => this.setBlocked(false),
      () => {},
    );
  }

  dispose(): void {
    this.stop();
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.blockedListeners.length = 0;
  }

  private ensureContext(): void {
    if (this.ctx) return;
    try {
      this.ctx = new AudioContext();
    } catch {
      this.ctx = null; // no Web Audio in this environment
    }
  }

  private setBlocked(blocked: boolean): void {
    if (this.blocked === blocked) return;
    this.blocked = blocked;
    for (const cb of this.blockedListeners) cb(blocked);
  }

  /** One cycle of the loop: the beat's tone sequence + vibration burst. */
  private beat(): void {
    if (this.muted) return;
    try {
      navigator.vibrate?.(this.opts.vibratePattern);
    } catch {
      // vibration unsupported
    }

    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.state === "suspended") {
      // Try to resume (works if we're inside a gesture); report blocked if not.
      ctx.resume().then(
        () => this.setBlocked(false),
        () => this.setBlocked(true),
      );
      if (ctx.state === "suspended") {
        this.setBlocked(true);
        return;
      }
    }
    try {
      const t0 = ctx.currentTime;
      const toneSec = this.opts.toneMs / 1000;
      const strideSec = toneSec + this.opts.toneGapMs / 1000;
      this.opts.toneHz.forEach((freqHz, index) => {
        this.tone(ctx, freqHz, t0 + index * strideSec, toneSec);
      });
      this.setBlocked(false);
    } catch {
      // scheduling failed — treat as silent beat
    }
  }

  private tone(
    ctx: AudioContext,
    freqHz: number,
    at: number,
    durationSec: number,
  ): void {
    playTone(ctx, freqHz, at, durationSec, this.opts.gain * this.volumeScale);
  }
}
