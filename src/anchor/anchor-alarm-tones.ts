/**
 * What the two anchor alarms sound like — the single source of truth for both
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
