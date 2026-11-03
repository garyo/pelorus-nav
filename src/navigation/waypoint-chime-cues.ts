/**
 * The waypoint chime's notes and vibration patterns: two rising notes on
 * passing a route waypoint, three on arriving at the last one. Kept free of
 * browser and Capacitor imports, since the Android service's WAVs are
 * rendered from them (tools/gen-alarm-sounds.ts) and its route sandbox
 * carries the vibrations (route-sandbox.ts).
 */

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
export const CHIME_GAIN = 0.3;
/** navigator.vibrate patterns: on, off, on… in ms. */
export const VIBRATE_PASS = [150, 80, 250];
export const VIBRATE_ARRIVAL = [150, 80, 150, 80, 400];
