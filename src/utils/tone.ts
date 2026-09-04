/**
 * One Web Audio tone, scheduled on an AudioContext. Shared by every alarm
 * and chime so they click and fade the same way.
 */

export function playTone(
  ctx: AudioContext,
  freqHz: number,
  at: number,
  durationSec: number,
  peak: number,
  type: OscillatorType = "square",
): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
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
