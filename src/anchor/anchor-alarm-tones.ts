/**
 * What the anchor alarms sound like — the single source of truth for both
 * players.
 *
 * On web {@link CobAlarm} synthesizes these with Web Audio; on Android the
 * foreground service loops a WAV rendered from these very constants by
 * tools/gen-alarm-sounds.ts. Keeping them here is what keeps the two identical:
 * change a frequency and re-running the generator is the only step needed.
 */

import type { CobAlarmOptions } from "../cob/CobAlarm";
import { COB_ALARM_DEFAULTS } from "../cob/CobAlarm";

/** Drag: the urgent two-tone siren, unchanged from the COB alarm. */
export const ANCHOR_DRAG_ALARM_TONE: Required<CobAlarmOptions> =
  COB_ALARM_DEFAULTS;

/**
 * GPS loss: one steady mid tone on a slower beat. Deliberately un-siren-like —
 * the boat may be fine and only the fix is gone, and a crew woken by it should
 * be able to tell the two apart before they are even awake enough to read.
 */
export const ANCHOR_GPS_LOSS_ALARM_TONE: Required<CobAlarmOptions> = {
  ...COB_ALARM_DEFAULTS,
  toneHz: [520, 520],
  beatIntervalMs: 2000,
};

/**
 * Watch failure: the anchor watch itself is compromised — nothing is watching,
 * or the watching device's battery is dying. Three short 660 Hz chirps, then a
 * long pause: quieter-but-waking, clearly different from both the drag siren
 * (no two-tone sweep, mostly silence) and the GPS-loss drone (chirps, not a
 * held tone). It says "get up and check", not "emergency" — the native player
 * also floors its volume lower for this kind (ANCHOR_WATCH_FAILURE_VOLUME_FLOOR
 * in AnchorWatch.kt).
 */
export const ANCHOR_WATCH_FAILURE_ALARM_TONE: Required<CobAlarmOptions> = {
  ...COB_ALARM_DEFAULTS,
  toneHz: [660, 660, 660],
  toneMs: 150,
  toneGapMs: 120,
  beatIntervalMs: 3000,
  vibratePattern: [150, 120, 150, 120, 150],
};
