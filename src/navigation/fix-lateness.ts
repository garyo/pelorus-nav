/**
 * How late a fix reaches the app: its age by the device clock, less that
 * clock's offset from the GPS's own. Fixes carry the receiver's time (GPS
 * time, for an NMEA receiver), and a device clock can disagree with it by
 * more than the lateness that matters — an offline tablet's clock drifts —
 * so the offset is measured: the smallest age among recent fixes received
 * while the app had been on screen a while, which are live, not a backlog
 * delivered on waking. Until there are any, the device clock is trusted.
 */

/** Steady fixes the offset is taken from: the latest, up to this many... */
const SAMPLES = 50;
/** ...received within this long, so a corrected device clock is soon
 *  followed. */
const SAMPLE_MAX_AGE_MS = 5 * 60_000;

export interface FixLateness {
  /** Note a fix as it arrives; `steady` when it is surely live (the app has
   *  been on screen long enough for any backlog to have drained). */
  note(fixTime: number, now: number, steady: boolean): void;
  /** How late a fix stamped `fixTime` is at `now`, in ms. */
  of(fixTime: number, now: number): number;
}

export function createFixLateness(): FixLateness {
  const samples: { at: number; offset: number }[] = [];
  return {
    note(fixTime, now, steady) {
      if (!steady) return;
      samples.push({ at: now, offset: now - fixTime });
      while (
        samples.length > SAMPLES ||
        (samples.length > 0 && now - samples[0].at > SAMPLE_MAX_AGE_MS)
      ) {
        samples.shift();
      }
    },
    of(fixTime, now) {
      const offset =
        samples.length > 0 ? Math.min(...samples.map((s) => s.offset)) : 0;
      return now - fixTime - offset;
    },
  };
}
