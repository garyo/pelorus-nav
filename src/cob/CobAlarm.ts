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
export interface CobAlarmOptions {
  /** The two tone frequencies (Hz), played in order within each beat. */
  toneHz?: [number, number];
  /** Duration of each of the two tones, in milliseconds. */
  toneMs?: number;
  /** Gap between the start of successive beats, in milliseconds. */
  beatIntervalMs?: number;
  /** Peak oscillator gain, 0–1. */
  gain?: number;
  /** Vibration burst per beat, as navigator.vibrate's on/off milliseconds. */
  vibratePattern?: number[];
}

const DEFAULTS: Required<CobAlarmOptions> = {
  toneHz: [880, 660],
  toneMs: 400,
  beatIntervalMs: 1200,
  gain: 0.4,
  vibratePattern: [400, 200, 400],
};

export class CobAlarm {
  private ctx: AudioContext | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private muted = false;
  private blocked = false;
  private blockedListeners: Array<(blocked: boolean) => void> = [];
  private readonly opts: Required<CobAlarmOptions>;

  constructor(options: CobAlarmOptions = {}) {
    this.opts = { ...DEFAULTS, ...options };
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

  /** One cycle of the loop: hi-lo tones + vibration burst. */
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
      const [hiHz, loHz] = this.opts.toneHz;
      const toneSec = this.opts.toneMs / 1000;
      this.tone(ctx, hiHz, t0, toneSec);
      this.tone(ctx, loHz, t0 + toneSec, toneSec);
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
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const peak = this.opts.gain;
    osc.type = "square";
    osc.frequency.value = freqHz;
    // Short attack/release ramps avoid clicks at tone edges.
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(peak, at + 0.02);
    gain.gain.setValueAtTime(peak, at + durationSec - 0.05);
    gain.gain.linearRampToValueAtTime(0, at + durationSec);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + durationSec);
  }
}
