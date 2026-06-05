/**
 * Tides & currents bundle schema — the compact JSON produced at build time by
 * `tools/tides/build-bundle.ts` (NOAA CO-OPS MDAPI crawl) and consumed at
 * runtime for fully-offline harmonic prediction.
 *
 * Conventions:
 * - Heights in metres relative to MLLW; current speeds in cm/s along the
 *   flood(+)/ebb(−) major axis; phases in degrees GMT; times in minutes.
 * - `amp`/`phase` are parallel arrays indexed by the shared
 *   `TidesBundle.constituents` name table; amplitude 0 = constituent absent.
 */

export interface TidesBundle {
  version: 1;
  /** ISO date of the MDAPI crawl that produced this bundle. */
  generated: string;
  /** Shared constituent-name table; per-station arrays index into this. */
  constituents: string[];
  tideRef: TideRefStation[];
  tideSub: TideSubStation[];
  currentRef: CurrentRefStation[];
  currentSub: CurrentSubStation[];
}

export interface StationBase {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

/** Harmonic tide station — full constituent set, continuous curve. */
export interface TideRefStation extends StationBase {
  /** Datum shift (metres) added to the harmonic sum (≈MSL) to get MLLW heights. */
  datum: number;
  /** Amplitude (metres) per bundle constituent. */
  amp: number[];
  /** Phase lag (degrees GMT) parallel to `amp`. */
  phase: number[];
}

/** Subordinate tide station — high/low events derived from a reference. */
export interface TideSubStation extends StationBase {
  refId: string;
  /** Time offsets (minutes) applied to reference high/low times. */
  tHigh: number;
  tLow: number;
  /** Height adjustments: ratio (hAdjType "R") or metres offset ("F"). */
  hHigh: number;
  hLow: number;
  hAdjType: "R" | "F";
}

/** Harmonic current station — one record per kept depth bin. */
export interface CurrentRefStation extends StationBase {
  bin: number;
  /** Bin depth in metres, when reported. */
  binDepth: number | null;
  /** Mean flood/ebb set (degrees true) for arrow rotation. */
  floodDir: number;
  ebbDir: number;
  /** Marks the surface-most bin — the one displayed on the chart. */
  disp?: 1;
  /** Major-axis amplitude (cm/s) per bundle constituent. */
  amp: number[];
  /** Major-axis phase (degrees GMT) parallel to `amp`. */
  phase: number[];
}

/** Subordinate current station — events offset from a reference station bin. */
export interface CurrentSubStation extends StationBase {
  refId: string;
  refBin: number;
  floodDir: number;
  ebbDir: number;
  /** Event time adjustments (minutes): max flood, slack-before-ebb, max ebb, slack-before-flood. */
  mfcTime: number;
  sbeTime: number;
  mecTime: number;
  sbfTime: number;
  /** Speed ratios applied to reference max flood / max ebb. */
  mfcAmp: number;
  mecAmp: number;
}
