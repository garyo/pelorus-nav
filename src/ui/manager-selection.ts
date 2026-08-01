/**
 * Selection mode for the manager panels: tick several rows, then act on all
 * of them at once.
 *
 * Folders only help if items can get into them. Importing a season's worth of
 * routes from another chartplotter lands dozens at a time, and before this the
 * only way to file or hide them was one row at a time — 363 taps for one real
 * import. Selection mode is the bulk half of that story.
 *
 * The mode is entered from the panel header's Select button or by long-
 * pressing a row (which also selects it, the phone idiom). While it's on,
 * rows show a checkbox and their per-row actions stand down, so a tap can
 * only ever mean "select". A bar at the bottom of the screen carries the
 * actions and the count.
 *
 * Generic over the item type: all three panels differ only in how an item is
 * shown, hidden, filed and deleted, which they supply as callbacks.
 */

import { showFolderPicker } from "./folder-picker";
import {
  iconEye,
  iconEyeOff,
  iconFolderOpen,
  iconTrash,
  setIcon,
} from "./icons";
import { registerSurface, type SurfaceHandle } from "./SurfaceManager";

/** How long a press becomes a long-press, ms. */
const LONG_PRESS_MS = 500;
/** Movement that means the user is scrolling, not pressing, px. */
const LONG_PRESS_SLOP = 10;

/**
 * Long-press for a row in a scrolling list.
 *
 * Deliberately not attachHoldGesture (src/cob/hold-gesture.ts): that one is
 * built for a stationary emergency button — it captures the pointer, sets
 * `touch-action: none`, and never cancels on movement, all of which would
 * stop the panel scrolling under the finger. Here a drag must win over the
 * press, so any movement past a small slop cancels.
 */
export function attachLongPress(
  el: HTMLElement,
  onLongPress: () => void,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let startX = 0;
  let startY = 0;

  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.isPrimary === false || e.button !== 0) return;
    startX = e.clientX;
    startY = e.clientY;
    cancel();
    timer = setTimeout(() => {
      timer = null;
      onLongPress();
    }, LONG_PRESS_MS);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!timer) return;
    if (
      Math.abs(e.clientX - startX) > LONG_PRESS_SLOP ||
      Math.abs(e.clientY - startY) > LONG_PRESS_SLOP
    ) {
      cancel();
    }
  };

  el.addEventListener("pointerdown", onPointerDown);
  el.addEventListener("pointermove", onPointerMove);
  el.addEventListener("pointerup", cancel);
  el.addEventListener("pointercancel", cancel);
  el.addEventListener("pointerleave", cancel);

  return () => {
    cancel();
    el.removeEventListener("pointerdown", onPointerDown);
    el.removeEventListener("pointermove", onPointerMove);
    el.removeEventListener("pointerup", cancel);
    el.removeEventListener("pointercancel", cancel);
    el.removeEventListener("pointerleave", cancel);
  };
}

export interface SelectionHost<T> {
  /** Singular noun for counts and confirmations ("route"). */
  noun: string;
  /** Unique id for the surface registration; also the bar's element id. */
  surfaceId: string;
  /** Surface group, so the bar coexists with its own panel. */
  group: string;
  idOf: (item: T) => string;
  /** Re-render the panel after the selection or the data changed. */
  refresh: () => void | Promise<void>;
  setVisible: (item: T, visible: boolean) => Promise<void>;
  /** Persist a folder change (undefined clears it). */
  setFolder: (item: T, folder: string | undefined) => Promise<void>;
  /** Delete one item; confirmation has already happened. */
  remove: (item: T) => Promise<void>;
  /** Folder names currently in use for this kind of item. */
  folders: () => Promise<string[]>;
  /** Redraw the chart after a bulk change, if the panel needs it. */
  afterBulkChange?: () => Promise<void>;
}

export class ManagerSelection<T> {
  private readonly host: SelectionHost<T>;
  private readonly bar: HTMLDivElement;
  private readonly countEl: HTMLSpanElement;
  private readonly surface: SurfaceHandle;
  private active = false;
  private readonly selected = new Set<string>();
  /** Latest object for each id — rows are rebuilt on every refresh, so the
   *  set of ids outlives the objects it was chosen from. */
  private readonly items = new Map<string, T>();

  constructor(host: SelectionHost<T>) {
    this.host = host;
    this.bar = document.createElement("div");
    this.bar.className = "manager-selection-bar";
    this.bar.id = host.surfaceId;

    this.countEl = document.createElement("span");
    this.countEl.className = "manager-selection-count";

    const actions = document.createElement("div");
    actions.className = "manager-selection-actions";

    const action = (icon: string, label: string, onClick: () => void) => {
      const btn = document.createElement("button");
      btn.className = "manager-selection-btn";
      setIcon(btn, icon);
      btn.title = label;
      btn.setAttribute("aria-label", label);
      btn.addEventListener("click", onClick);
      actions.appendChild(btn);
      return btn;
    };

    action(iconFolderOpen, "Move to folder", () => {
      this.moveToFolder().catch(console.error);
    });
    action(iconEye, "Show", () => this.setAllVisible(true));
    action(iconEyeOff, "Hide", () => this.setAllVisible(false));
    action(iconTrash, "Delete", () => {
      this.deleteAll().catch(console.error);
    });

    const done = document.createElement("button");
    done.className = "route-editor-btn manager-selection-done";
    done.textContent = "Done";
    done.addEventListener("click", () => this.exit());

    this.bar.append(this.countEl, actions, done);
    document.body.appendChild(this.bar);

    this.surface = registerSurface({
      id: host.surfaceId,
      slot: "bottom-center",
      group: host.group,
      // A mode bar: taps on the map and on its own panel's rows are the
      // point, so an outside tap must not dismiss it.
      closeOnOutsideClick: false,
      el: () => this.bar,
      isOpen: () => this.active,
      close: () => this.exit(),
    });
  }

  isActive(): boolean {
    return this.active;
  }

  isSelected(item: T): boolean {
    return this.selected.has(this.host.idOf(item));
  }

  /** Enter selection mode, optionally with one item already ticked. */
  enter(seed?: T): void {
    if (this.active) {
      if (seed) this.toggle(seed);
      return;
    }
    this.active = true;
    this.selected.clear();
    if (seed) this.selected.add(this.host.idOf(seed));
    this.bar.classList.add("open");
    this.surface.opened();
    document.addEventListener("keydown", this.onKeyDown);
    this.updateCount();
    void this.host.refresh();
  }

  exit(): void {
    if (!this.active) return;
    this.active = false;
    this.selected.clear();
    this.bar.classList.remove("open");
    document.removeEventListener("keydown", this.onKeyDown);
    void this.host.refresh();
  }

  toggleMode(): void {
    if (this.active) this.exit();
    else this.enter();
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== "Escape" || !this.active) return;
    // Consume it: the global Escape fallback would otherwise cancel
    // navigation behind an open selection (see ContextMenu.ts).
    e.preventDefault();
    this.exit();
  };

  private toggle(item: T): void {
    const id = this.host.idOf(item);
    if (this.selected.has(id)) this.selected.delete(id);
    else this.selected.add(id);
    this.updateCount();
    void this.host.refresh();
  }

  private updateCount(): void {
    const n = this.selected.size;
    this.countEl.textContent = `${n} selected`;
    for (const btn of this.bar.querySelectorAll(
      "button.manager-selection-btn",
    )) {
      (btn as HTMLButtonElement).disabled = n === 0;
    }
  }

  /**
   * Prepare a row for the current mode. Call while building each row, before
   * appending it.
   *
   * In selection mode the row gets a checkbox, its own actions are hidden so
   * a stray tap can't fire one, and a tap anywhere toggles it. Out of
   * selection mode, a long press enters the mode with this row selected.
   */
  decorateRow(item: T, row: HTMLElement, actions?: HTMLElement): void {
    if (!this.active) {
      // Listeners die with the row (panels rebuild their list wholesale), but
      // a press in flight when that happens would otherwise fire against a
      // row the user is no longer touching.
      attachLongPress(row, () => {
        if (row.isConnected) this.enter(item);
      });
      return;
    }

    row.classList.add("manager-item--selectable");
    if (actions) actions.style.display = "none";

    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "manager-select-box";
    box.checked = this.isSelected(item);
    box.addEventListener("click", (e) => e.stopPropagation());
    box.addEventListener("change", () => this.toggle(item));
    row.prepend(box);

    row.classList.toggle("selected", this.isSelected(item));
    row.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggle(item);
    });
  }

  /** Remember the live object behind an id, so actions use fresh data. */
  track(item: T): void {
    this.items.set(this.host.idOf(item), item);
  }

  private chosen(): T[] {
    const out: T[] = [];
    for (const id of this.selected) {
      const item = this.items.get(id);
      if (item) out.push(item);
    }
    return out;
  }

  private setAllVisible(visible: boolean): void {
    (async () => {
      for (const item of this.chosen()) {
        await this.host.setVisible(item, visible);
      }
      await this.host.afterBulkChange?.();
      this.exit();
    })().catch(console.error);
  }

  private async moveToFolder(): Promise<void> {
    const items = this.chosen();
    if (items.length === 0) return;
    const choice = await showFolderPicker(
      await this.host.folders(),
      items.length,
      this.host.noun,
    );
    if (!choice) return;
    for (const item of items) {
      await this.host.setFolder(item, choice.folder);
    }
    await this.host.afterBulkChange?.();
    this.exit();
  }

  private async deleteAll(): Promise<void> {
    const items = this.chosen();
    if (items.length === 0) return;
    const what = `${items.length} ${this.host.noun}${items.length === 1 ? "" : "s"}`;
    if (!confirm(`Delete ${what}?`)) return;
    for (const item of items) {
      await this.host.remove(item);
    }
    await this.host.afterBulkChange?.();
    this.exit();
  }
}
