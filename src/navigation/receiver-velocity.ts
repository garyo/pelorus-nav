/**
 * Checks a GPS receiver's own speed and course (the Doppler velocity it
 * sends, in RMC) against its positions.
 *
 * A good receiver's Doppler velocity beats differencing positions, so it is
 * shown as sent. But some receivers get it badly wrong: a Garmin GLO 2 on
 * foot under trees reported 40% of the true speed and a course some 30° off,
 * while its positions were clean. So each stretch of travel is judged: the
 * receiver's velocity integrated over it should arrive where its positions
 * did. That holds on a winding course too, since the displacement over a
 * stretch is the velocity's integral, whatever the path between. A stretch
 * ends once the vessel has moved far enough that position error is small
 * beside the distance; slower than that, nothing is judged.
 *
 * A run of stretches that miss marks the receiver's velocity untrusted (the
 * caller then derives speed and course from positions), and a run that agree
 * trusts it again, so a few bad stretches don't flip the source back and
 * forth.
 */

import type { NavigationData } from "./NavigationData";

/** A stretch is judged once its displacement is at least this... */
const MIN_STRETCH_M = 50;
/** ...and this many times the fixes' stated accuracy. */
const STRETCH_ACCURACIES = 10;
/** Slower than a judgeable stretch in this long: start over unjudged. */
const MAX_STRETCH_S = 120;
/** A gap between fixes this long breaks the integration. */
const MAX_GAP_S = 20;
/** The receiver's displacement may miss its positions' by this fraction. */
const MAX_MISS = 0.35;
/** Consecutive missing stretches that distrust the receiver's velocity... */
const MISSES_TO_DISTRUST = 3;
/** ...and consecutive agreeing ones that trust it again. */
const AGREEMENTS_TO_TRUST = 3;

const M_PER_DEG = 111_111;
const MS_PER_KN = 1852 / 3600;

/** One judged stretch: the receiver's displacement against the positions'. */
export interface StretchVerdict {
  /** Receiver's distance over positions' distance. */
  ratio: number;
  /** Angle between the two displacements, degrees. */
  angleDeg: number;
  agrees: boolean;
}

interface Stretch {
  startLat: number;
  startLon: number;
  startT: number;
  lastT: number;
  /** Receiver's velocity at the last fix, m/s east and north. */
  lastV: [number, number];
  /** Receiver's integrated displacement, m east and north. */
  east: number;
  north: number;
  accuracyM: number;
}

export class ReceiverVelocityCheck {
  private stretch: Stretch | null = null;
  private misses = 0;
  private agreements = 0;
  private isTrusted = true;
  private verdict: StretchVerdict | null = null;

  /** Whether the receiver's speed and course can be shown as sent. */
  get trusted(): boolean {
    return this.isTrusted;
  }

  /** The most recent judged stretch, for diagnostics. */
  get lastVerdict(): StretchVerdict | null {
    return this.verdict;
  }

  reset(): void {
    this.stretch = null;
    this.misses = 0;
    this.agreements = 0;
    this.isTrusted = true;
    this.verdict = null;
  }

  /** Feed a raw fix. Returns the stretch it completed, if it did. */
  add(fix: NavigationData): StretchVerdict | null {
    const t = fix.timestamp / 1000;
    if (fix.sog === null || fix.cog === null || fix.sog < 0) {
      this.stretch = null; // no velocity to integrate
      return null;
    }
    const rad = (fix.cog * Math.PI) / 180;
    const v: [number, number] = [
      fix.sog * MS_PER_KN * Math.sin(rad),
      fix.sog * MS_PER_KN * Math.cos(rad),
    ];
    const s = this.stretch;
    const dt = s ? t - s.lastT : 0;
    if (!s || dt <= 0 || dt > MAX_GAP_S || t - s.startT > MAX_STRETCH_S) {
      this.start(fix, t, v);
      return null;
    }
    // Trapezoidal integration of the receiver's velocity.
    s.east += ((s.lastV[0] + v[0]) / 2) * dt;
    s.north += ((s.lastV[1] + v[1]) / 2) * dt;
    s.lastT = t;
    s.lastV = v;
    s.accuracyM = Math.max(s.accuracyM, fix.accuracy ?? 0);

    const cosLat = Math.cos((fix.latitude * Math.PI) / 180);
    const posEast = (fix.longitude - s.startLon) * M_PER_DEG * cosLat;
    const posNorth = (fix.latitude - s.startLat) * M_PER_DEG;
    const posDist = Math.hypot(posEast, posNorth);
    if (posDist < Math.max(MIN_STRETCH_M, STRETCH_ACCURACIES * s.accuracyM)) {
      return null;
    }

    const miss = Math.hypot(s.east - posEast, s.north - posNorth) / posDist;
    const dot = s.east * posEast + s.north * posNorth;
    const cross = s.east * posNorth - s.north * posEast;
    const verdict: StretchVerdict = {
      ratio: Math.hypot(s.east, s.north) / posDist,
      angleDeg: Math.abs((Math.atan2(cross, dot) * 180) / Math.PI),
      agrees: miss <= MAX_MISS,
    };
    this.judge(verdict);
    this.start(fix, t, v);
    return verdict;
  }

  private start(fix: NavigationData, t: number, v: [number, number]): void {
    this.stretch = {
      startLat: fix.latitude,
      startLon: fix.longitude,
      startT: t,
      lastT: t,
      lastV: v,
      east: 0,
      north: 0,
      accuracyM: fix.accuracy ?? 0,
    };
  }

  private judge(verdict: StretchVerdict): void {
    this.verdict = verdict;
    if (verdict.agrees) {
      this.misses = 0;
      if (++this.agreements >= AGREEMENTS_TO_TRUST) this.isTrusted = true;
    } else {
      this.agreements = 0;
      if (++this.misses >= MISSES_TO_DISTRUST) this.isTrusted = false;
    }
  }
}
