/**
 * Persisted crew-overboard (COB) event state.
 *
 * One event at a time, stored in localStorage so an emergency survives an
 * app crash or reload. The drop position itself lives in IndexedDB as a
 * regular waypoint (referenced by `waypointId`) — that's what lets the
 * existing goto-navigation restore machinery re-engage after a restart.
 */

import { createJsonStorageSlot } from "../utils/json-storage-slot";

export interface PersistedCobState {
  version: 1;
  /** Epoch ms when COB was activated — drives the elapsed timer. */
  startedAt: number;
  /** Id of the COB StandaloneWaypoint in IndexedDB. */
  waypointId: string;
  /** Alarm muted for this event. */
  muted: boolean;
  /** The GPS fix was already stale when the position was captured. */
  staleAtDrop: boolean;
  /** Age of that fix at capture time, for the panel's warning text. */
  fixAgeAtDropMs: number;
}

export function isValidCobState(value: unknown): value is PersistedCobState {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === 1 &&
    typeof v.startedAt === "number" &&
    Number.isFinite(v.startedAt) &&
    typeof v.waypointId === "string" &&
    v.waypointId.length > 0 &&
    typeof v.muted === "boolean" &&
    typeof v.staleAtDrop === "boolean" &&
    typeof v.fixAgeAtDropMs === "number" &&
    Number.isFinite(v.fixAgeAtDropMs)
  );
}

export const COB_STORAGE_KEY = "pelorus-nav-cob";

export const cobStateSlot = createJsonStorageSlot<PersistedCobState>(
  COB_STORAGE_KEY,
  isValidCobState,
);

/** "COB 14:32:05" — local wall-clock time of the drop. */
export function cobWaypointName(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `COB ${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`;
}

/** Notes annotation written to the waypoint when the event is resolved. */
export function resolvedNotes(startedAt: number, resolvedAt: number): string {
  const fmt = (ms: number) => {
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };
  return `Crew overboard ${fmt(startedAt)}, resolved ${fmt(resolvedAt)} (${formatCobElapsed(resolvedAt - startedAt)})`;
}

/**
 * Emergency elapsed time: "0:47", "4:32", "1:04:32". Seconds always visible —
 * unlike formatDurationShort, which rounds to minutes and is too coarse for
 * a live COB timer.
 */
export function formatCobElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const sec = totalSec % 60;
  const min = Math.floor(totalSec / 60) % 60;
  const hours = Math.floor(totalSec / 3600);
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(min)}:${pad(sec)}` : `${min}:${pad(sec)}`;
}
