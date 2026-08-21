/**
 * Scope math for the anchor-mode readout.
 *
 * Scope is the rode paid out divided by the vertical distance from the
 * seabed to the bow roller — depth plus the roller's height above the water
 * (bow height). A rising tide lifts the boat without lengthening the rode,
 * so the same anchorage reads a smaller scope at high water; that is what
 * {@link scopeAtTide} answers.
 *
 * Pure: no DOM, no tide bundle. The only tide contact is the {@link TideEvent}
 * type used to pick the governing high water out of a prediction.
 */

import type { TideEvent } from "../tides/predictor";

/**
 * Advisory thresholds, from common cruising practice: 5:1 is the usual
 * working scope for an overnight anchorage, 3:1 the usual floor (acceptable
 * for all-chain in settled conditions, thin for a rope rode, which needs
 * more scope to keep the pull on the anchor horizontal). Rode type, bottom,
 * and weather all move the real number, so this classification is advice,
 * never a gate.
 */
export const SCOPE_GOOD = 5;
export const SCOPE_MARGINAL = 3;

/** How far ahead the readout looks for the governing high water. */
export const TIDE_LOOKAHEAD_HRS = 12;

export type ScopeAdvice = "good" | "marginal" | "poor";

export interface ScopeInput {
  /** Rode paid out, meters. */
  rodeM?: number | null;
  /** Water depth under the boat, meters. */
  depthM?: number | null;
  /** Bow roller height above the water; missing counts as zero. */
  bowHeightM?: number | null;
}

export interface ScopeAtTideInput extends ScopeInput {
  /** Extra water height over the entered depth, meters. */
  tideRiseM?: number | null;
}

function finite(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Scope at the entered depth, or null when the inputs can't produce a
 * meaningful ratio (no rode, no depth, or a non-positive vertical distance).
 */
export function scopeRatio(input: ScopeInput): number | null {
  return scopeAtTide(input);
}

/** Scope with `tideRiseM` of extra water over the entered depth. */
export function scopeAtTide(input: ScopeAtTideInput): number | null {
  const rode = finite(input.rodeM);
  const depth = finite(input.depthM);
  const bow = finite(input.bowHeightM) ?? 0;
  const rise = finite(input.tideRiseM) ?? 0;
  if (rode === null || rode <= 0 || depth === null) return null;
  const vertical = depth + bow + rise;
  if (vertical <= 0) return null;
  return rode / vertical;
}

/** Advisory classification of a scope ratio; null for an unknown ratio. */
export function scopeAdvice(ratio: number | null): ScopeAdvice | null {
  if (ratio === null || !Number.isFinite(ratio)) return null;
  if (ratio >= SCOPE_GOOD) return "good";
  if (ratio >= SCOPE_MARGINAL) return "marginal";
  return "poor";
}

const ADVICE_ORDER: Record<ScopeAdvice, number> = {
  good: 2,
  marginal: 1,
  poor: 0,
};

/** The more cautious of two classifications; null only if both are null. */
export function worstAdvice(
  a: ScopeAdvice | null,
  b: ScopeAdvice | null,
): ScopeAdvice | null {
  if (a === null) return b;
  if (b === null) return a;
  return ADVICE_ORDER[a] <= ADVICE_ORDER[b] ? a : b;
}

/** "5.2:1" */
export function formatScopeRatio(ratio: number): string {
  return `${ratio.toFixed(1)}:1`;
}

/**
 * The governing high water: the highest high in `events` falling after
 * `from` and within `withinMs` — highest, not next, because a later, bigger
 * high is the one that shortens scope the most. Ties go to the earlier event.
 */
export function highestHighWithin(
  events: readonly TideEvent[],
  from: Date,
  withinMs: number,
): TideEvent | null {
  const start = from.getTime();
  let best: TideEvent | null = null;
  for (const e of events) {
    if (e.type !== "high") continue;
    const dt = e.time.getTime() - start;
    if (dt < 0 || dt > withinMs) continue;
    if (best === null || e.heightMeters > best.heightMeters) best = e;
  }
  return best;
}

/** Water rise from `currentM` to `highM`, never negative. */
export function riseToHigh(currentM: number, highM: number): number {
  return Math.max(0, highM - currentM);
}
