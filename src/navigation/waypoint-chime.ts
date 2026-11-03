/**
 * The short chime that marks passing a route waypoint, played with Web Audio
 * (cues in waypoint-chime-cues.ts). Web Audio only plays while the page is in
 * the foreground; with the Android app in the background, its service chimes
 * instead (see route-sandbox.ts).
 */

import { Capacitor } from "@capacitor/core";
import { playTone } from "../utils/tone";
import {
  ARRIVAL_NOTES,
  CHIME_GAIN,
  PASS_NOTES,
  VIBRATE_ARRIVAL,
  VIBRATE_PASS,
} from "./waypoint-chime-cues";

/** Schedule the chime's notes from `ctx.currentTime`. Pure over the context. */
export function scheduleChime(ctx: AudioContext, final: boolean): void {
  let at = ctx.currentTime;
  for (const [freqHz, durationSec] of final ? ARRIVAL_NOTES : PASS_NOTES) {
    playTone(ctx, freqHz, at, durationSec, CHIME_GAIN);
    at += durationSec;
  }
}

let sharedContext: AudioContext | null = null;

/** Play the chime (and vibrate on a phone). Silently a no-op where it can't. */
export function playWaypointChime(final: boolean): void {
  // The Android service chimes whenever the app is off screen.
  if (Capacitor.getPlatform() === "android" && document.hidden) return;
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
