/**
 * Crew-overboard attention alarm: a repeating two-tone siren via Web Audio
 * plus device vibration. Muting gates the output but keeps the loop running,
 * so unmute is instant. All audio calls are guarded — a missing or blocked
 * AudioContext (headless tests, autoplay policy after a crash-restore with
 * no user gesture) degrades to silence and reports via onBlockedChange so
 * the UI can offer a "tap to enable sound" unlock.
 */

const LOOP_INTERVAL_MS = 1200;
const TONE_HI_HZ = 880;
const TONE_LO_HZ = 660;
const TONE_MS = 400;
const GAIN = 0.4;
const VIBRATE_PATTERN = [400, 200, 400];

export class CobAlarm {
  private ctx: AudioContext | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private muted = false;
  private blocked = false;
  private blockedListeners: Array<(blocked: boolean) => void> = [];

  /** Begin the alarm loop. Safe to call from any context; best from a user gesture. */
  start(muted: boolean): void {
    this.muted = muted;
    if (this.interval) return;
    this.ensureContext();
    this.beat();
    this.interval = setInterval(() => this.beat(), LOOP_INTERVAL_MS);
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
      navigator.vibrate?.(VIBRATE_PATTERN);
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
      this.tone(ctx, TONE_HI_HZ, t0, TONE_MS / 1000);
      this.tone(ctx, TONE_LO_HZ, t0 + TONE_MS / 1000, TONE_MS / 1000);
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
    osc.type = "square";
    osc.frequency.value = freqHz;
    // Short attack/release ramps avoid clicks at tone edges.
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(GAIN, at + 0.02);
    gain.gain.setValueAtTime(GAIN, at + durationSec - 0.05);
    gain.gain.linearRampToValueAtTime(0, at + durationSec);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + durationSec);
  }
}
