/**
 * Shared harmonic-predictor construction for tides and currents.
 * Wraps @neaps/tide-predictor with a per-station memo cache.
 */

import type {
  HarmonicConstituent,
  TidePrediction,
} from "@neaps/tide-predictor";
import createTidePredictor from "@neaps/tide-predictor";

const cache = new Map<string, TidePrediction>();

/**
 * Build (or reuse) a predictor from a station's parallel amp/phase arrays.
 * `offset` shifts the harmonic sum (≈MSL) onto the display datum; pass the
 * station's MLLW offset for tides, or false for currents (signed velocity
 * oscillating about zero).
 */
export function getPredictor(
  key: string,
  names: string[],
  amp: number[],
  phase: number[],
  offset: number | false,
): TidePrediction {
  let p = cache.get(key);
  if (!p) {
    const constituents: HarmonicConstituent[] = [];
    for (let i = 0; i < amp.length; i++) {
      if (amp[i] > 0) {
        constituents.push({
          name: names[i],
          amplitude: amp[i],
          phase: phase[i],
        });
      }
    }
    p = createTidePredictor(constituents, { offset });
    cache.set(key, p);
  }
  return p;
}
