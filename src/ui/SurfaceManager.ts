/**
 * Slot-based window management for floating panels and bars.
 *
 * The app's surfaces contest two screen regions: the top-right column
 * (settings, manager panels, sun) and the bottom-center strip (time bar,
 * track viewer, COB). Historically every pair needed hand-wired "A
 * closes B" calls and hand-picked z-indexes, which is how Settings
 * (z=50) ended up rendering behind the route panel (z=10000).
 *
 * Instead, each surface registers once with a slot and a group:
 * - Opening a surface closes every open surface in the same slot with a
 *   different group. Same-group surfaces coexist (a manager panel and
 *   its detail panel form a click-through pair).
 * - `priority` surfaces (COB) are never evicted or auto-closed and sit
 *   in a higher z band, so an emergency panel can't lose to a scrubber.
 * - `pinned` surfaces are immune to eviction while their predicate holds
 *   (e.g. the route detail panel during editing) but still close
 *   normally by every other path.
 * - A tap/click outside any open surface closes it (touch devices have
 *   no Escape key); Escape closes the most recently opened one as a
 *   desktop convenience. Both respect per-surface opt-outs.
 *
 * Z bands: slot surfaces 10000, priority 10500. Modal overlays (the
 * about-dialog family, 10001+) intentionally sit above slot surfaces
 * and manage themselves — they already have uniform Escape/backdrop
 * behavior.
 */

import { logUiAction } from "../diagnostics/uiActionLog";

export type SurfaceSlot = "top-right" | "bottom-center";

export interface SurfaceDecl {
  id: string;
  slot: SurfaceSlot;
  /** Surfaces sharing a group coexist; different groups in a slot evict
   *  each other. Defaults to the id (every surface its own group). */
  group?: string;
  /** Never evicted, never closed by outside-click/Escape, higher z. */
  priority?: boolean;
  /** Queried at eviction time: while true, the surface is not evicted by
   *  other groups opening in its slot (it still closes via its own X,
   *  Escape, or outside click). For surfaces that are sometimes a
   *  workspace — e.g. the route detail panel during route editing. */
  pinned?: () => boolean;
  /** Close on tap/click outside the surface (default true; mode bars
   *  whose purpose is map interaction should pass false). */
  closeOnOutsideClick?: boolean;
  /** Root element (queried per event — may be recreated). */
  el: () => HTMLElement | null;
  isOpen: () => boolean;
  close: () => void;
}

export interface SurfaceHandle {
  /** Call from the surface's show()/open path, after it is visible. */
  opened: () => void;
}

const Z_SLOT = "10000";
const Z_PRIORITY = "10500";

const surfaces: SurfaceDecl[] = [];
/** Ids in open order; last = topmost for Escape. */
const openOrder: string[] = [];
/** When each surface last opened — a surface opened during the current
 *  event dispatch (toggle button, context-menu item) must not be closed
 *  by that same click bubbling to the document. */
const openedAt = new Map<string, number>();
let listenersInstalled = false;

function decl(id: string): SurfaceDecl | undefined {
  return surfaces.find((s) => s.id === id);
}

function noteClosed(id: string): void {
  const i = openOrder.indexOf(id);
  if (i >= 0) openOrder.splice(i, 1);
}

function handleOpened(s: SurfaceDecl): void {
  logUiAction(`open ${s.id}`);
  // Evict other groups from the slot (priority surfaces are immune).
  const group = s.group ?? s.id;
  for (const other of surfaces) {
    if (other === s || other.slot !== s.slot) continue;
    if ((other.group ?? other.id) === group) continue;
    if (other.priority || other.pinned?.()) continue;
    if (other.isOpen()) {
      other.close();
      noteClosed(other.id);
    }
  }
  const el = s.el();
  if (el) el.style.zIndex = s.priority ? Z_PRIORITY : Z_SLOT;
  noteClosed(s.id);
  openOrder.push(s.id);
  openedAt.set(s.id, performance.now());
}

/** Event timestamps are spec'd relative to the time origin (comparable
 *  with performance.now()), but older engines report epoch millis. */
function eventTime(e: Event): number {
  return e.timeStamp > 1e11
    ? e.timeStamp - performance.timeOrigin
    : e.timeStamp;
}

function onDocumentClick(e: MouseEvent): void {
  const target = e.target;
  if (!(target instanceof Node)) return;
  for (const s of surfaces) {
    if (s.priority || s.closeOnOutsideClick === false) continue;
    if (!s.isOpen()) continue;
    // Opened by this very click (toggle button, context-menu action) —
    // the click that opened it is not an "outside" click.
    if ((openedAt.get(s.id) ?? -1) >= eventTime(e)) continue;
    const el = s.el();
    if (el?.contains(target)) continue;
    // Don't let a tap on a sibling same-group surface (e.g. the route
    // manager while its detail is open) dismiss the group.
    const group = s.group ?? s.id;
    const inSibling = surfaces.some(
      (o) =>
        o !== s &&
        (o.group ?? o.id) === group &&
        o.isOpen() &&
        o.el()?.contains(target),
    );
    if (inSibling) continue;
    logUiAction(`close ${s.id} (outside tap)`);
    s.close();
    noteClosed(s.id);
  }
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key !== "Escape" || e.defaultPrevented) return;
  // Inputs own their Escape (e.g. inline rename cancel).
  const t = e.target;
  if (
    t instanceof HTMLElement &&
    (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)
  ) {
    return;
  }
  for (let i = openOrder.length - 1; i >= 0; i--) {
    const s = decl(openOrder[i]);
    if (!s || !s.isOpen()) {
      openOrder.splice(i, 1);
      continue;
    }
    if (s.priority) continue;
    logUiAction(`close ${s.id} (esc)`);
    s.close();
    noteClosed(s.id);
    e.preventDefault();
    return;
  }
}

function installListeners(): void {
  if (listenersInstalled) return;
  listenersInstalled = true;
  document.addEventListener("click", onDocumentClick);
  document.addEventListener("keydown", onKeydown);
}

/** Register a surface. Call once; invoke the returned handle's opened()
 *  every time the surface becomes visible. */
export function registerSurface(s: SurfaceDecl): SurfaceHandle {
  installListeners();
  const existing = surfaces.findIndex((o) => o.id === s.id);
  if (existing >= 0) surfaces.splice(existing, 1);
  surfaces.push(s);
  return { opened: () => handleOpened(s) };
}

/** Test hook: forget all surfaces (module-level state). */
export function resetSurfacesForTest(): void {
  surfaces.length = 0;
  openOrder.length = 0;
  openedAt.clear();
}
