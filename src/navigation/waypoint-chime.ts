/**
 * The short chime that marks passing a route waypoint: two rising notes,
 * three on arriving at the last one. Web Audio only plays while the page
 * is in the foreground (a backgrounded WebView's context is suspended), so
 * on a phone a vibration burst carries the cue when the screen is off.
 */

import { Capacitor } from "@capacitor/core";
import { playTone } from "../utils/tone";

/** [frequency Hz, duration s] per note, played back to back. */
export const PASS_NOTES: [number, number][] = [
  [660, 0.12],
  [880, 0.18],
];
export const ARRIVAL_NOTES: [number, number][] = [
  [660, 0.12],
  [880, 0.12],
  [1100, 0.28],
];
const GAIN = 0.3;
const VIBRATE_PASS = [150, 80, 250];
const VIBRATE_ARRIVAL = [150, 80, 150, 80, 400];

/** Schedule the chime's notes from `ctx.currentTime`. Pure over the context. */
export function scheduleChime(ctx: AudioContext, final: boolean): void {
  let at = ctx.currentTime;
  for (const [freqHz, durationSec] of final ? ARRIVAL_NOTES : PASS_NOTES) {
    playTone(ctx, freqHz, at, durationSec, GAIN);
    at += durationSec;
  }
}

let sharedContext: AudioContext | null = null;

/** Play the chime (and vibrate on a phone). Silently a no-op where it can't. */
export function playWaypointChime(final: boolean): void {
  if (Capacitor.isNativePlatform()) {
    navigator.vibrate?.(final ? VIBRATE_ARRIVAL : VIBRATE_PASS);
  }
  try {
    sharedContext ??= new AudioContext();
    // A context created without a user gesture stays suspended; a courtesy
    // beep is not worth the unblock plumbing the alarms carry.
    if (sharedContext.state !== "running") return;
    scheduleChime(sharedContext, final);
  } catch {
    // No Web Audio here (headless, an ancient WebView) — the toast still shows.
  }
}
