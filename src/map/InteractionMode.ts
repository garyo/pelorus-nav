/**
 * Global interaction mode manager. Controls what map clicks do.
 * Same pub-sub pattern as settings.ts.
 */

export type MapInteractionMode = "query" | "measure" | "route-edit";

type ModeListener = (mode: MapInteractionMode) => void;

let current: MapInteractionMode = "query";
const listeners: ModeListener[] = [];

export function getMode(): MapInteractionMode {
  return current;
}

export function setMode(mode: MapInteractionMode): void {
  if (mode === current) return;
  current = mode;
  for (const fn of listeners) {
    fn(current);
  }
}

export function onModeChange(fn: ModeListener): void {
  listeners.push(fn);
}
