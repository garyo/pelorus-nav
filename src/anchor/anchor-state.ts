/**
 * Persisted anchor-watch state.
 *
 * Two localStorage slots: the armed watch itself, so a restart mid-watch —
 * or mid-alarm — resumes exactly where it left off, and the remembered setup
 * parameters (boat geometry, last rode/depth), which survive disarm and seed
 * the next anchorage's defaults in the anchor-mode setup surface.
 */

import { createJsonStorageSlot } from "../utils/json-storage-slot";

/** One swing-scatter sample: position + fix timestamp (epoch ms). */
export interface AnchorScatterPoint {
  lat: number;
  lon: number;
  t: number;
}

/** Scatter ring-buffer cap: 720 samples = 2 h at the 10 s sample interval. */
export const SCATTER_MAX_POINTS = 720;

export interface PersistedAnchorWatchState {
  version: 1;
  /** Epoch ms when the watch was armed — drives the time-at-anchor readout. */
  armedAt: number;
  /** Anchor position in decimal degrees. */
  anchor: { lat: number; lon: number };
  /** Alarm radius in meters. */
  radiusM: number;
  /** Warning-ring inset from the alarm radius, meters. */
  warnM: number;
  /** Alarm muted for the current watch. */
  muted: boolean;
  /** A drag alarm was sounding — restore() resumes it. */
  alarming: boolean;
  /** Swing scatter since arming (bounded ring buffer, session-scoped). */
  scatter: AnchorScatterPoint[];
}

const finiteNumber = (x: unknown): x is number =>
  typeof x === "number" && Number.isFinite(x);

const optionalFinite = (x: unknown): boolean =>
  x === undefined || finiteNumber(x);

function isValidScatterPoint(value: unknown): value is AnchorScatterPoint {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return finiteNumber(v.lat) && finiteNumber(v.lon) && finiteNumber(v.t);
}

export function isValidAnchorWatchState(
  value: unknown,
): value is PersistedAnchorWatchState {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const anchor = v.anchor as Record<string, unknown> | null | undefined;
  return (
    v.version === 1 &&
    finiteNumber(v.armedAt) &&
    typeof anchor === "object" &&
    anchor !== null &&
    finiteNumber(anchor.lat) &&
    finiteNumber(anchor.lon) &&
    finiteNumber(v.radiusM) &&
    v.radiusM > 0 &&
    finiteNumber(v.warnM) &&
    v.warnM >= 0 &&
    typeof v.muted === "boolean" &&
    typeof v.alarming === "boolean" &&
    Array.isArray(v.scatter) &&
    v.scatter.every(isValidScatterPoint)
  );
}

/**
 * Setup parameters remembered across anchorages: boat geometry plus the
 * last-used rode/depth, which seed the radius default at the next arm.
 * All optional — each field exists only once the user has entered it.
 */
export interface AnchorRememberedParams {
  version: 1;
  /** Boat length overall, meters. */
  boatLengthM?: number;
  /** Bow-roller height above the water, meters (scope calculation). */
  bowHeightM?: number;
  /** Rode paid out at the last anchorage, meters. */
  lastRodeM?: number;
  /** Water depth entered at the last anchorage, meters. */
  lastDepthM?: number;
  /** Chosen alarm loudness, 0-1 of the device's alarm-stream maximum. */
  alarmVolume?: number;
}

export function isValidAnchorParams(
  value: unknown,
): value is AnchorRememberedParams {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === 1 &&
    optionalFinite(v.boatLengthM) &&
    optionalFinite(v.bowHeightM) &&
    optionalFinite(v.lastRodeM) &&
    optionalFinite(v.lastDepthM) &&
    optionalFinite(v.alarmVolume)
  );
}

export const ANCHOR_WATCH_STORAGE_KEY = "pelorus-nav-anchor-watch";
export const ANCHOR_PARAMS_STORAGE_KEY = "pelorus-nav-anchor-params";

export const anchorWatchSlot = createJsonStorageSlot<PersistedAnchorWatchState>(
  ANCHOR_WATCH_STORAGE_KEY,
  isValidAnchorWatchState,
);

export const anchorParamsSlot = createJsonStorageSlot<AnchorRememberedParams>(
  ANCHOR_PARAMS_STORAGE_KEY,
  isValidAnchorParams,
);
