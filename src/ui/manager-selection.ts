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
  /** Show or hide every item in one pass — one write, one redraw. Acting
   *  per item is what made hiding 300 waypoints take 16 seconds of winking. */
  setVisibleAll: (items: T[], visible: boolean) => Promise<void>;
  /** File every item (undefined clears the folder), in one pass. */
  setFolderAll: (items: T[], folder: string | undefined) => Promise<void>;
  /** Delete every item in one pass; confirmation has already happened. */
  removeAll: (items: T[]) => Promise<void>;
  /** Everything the panel could list, including inside collapsed folders. */
  allItems: () => Promise<T[]>;
  /** Folder names currently in use for this kind of item. */
  folders: () => Promise<string[]>;
  /** Redraw the chart after a bulk change, if the panel needs it. */
  afterBulkChange?: () => Promise<void>;
}

export class ManagerSelection<T> {
  private readonly host: SelectionHost<T>;
  private readonly bar: HTMLDivElement;
  private readonly countEl: HTMLSpanElement;
  private readonly allBtn: HTMLButtonElement;
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

    this.allBtn = document.createElement("button");
    this.allBtn.className = "route-editor-btn manager-selection-all";
    this.allBtn.addEventListener("click", () => {
      this.selectAll().catch(console.error);
    });

    const done = document.createElement("button");
    done.className = "route-editor-btn manager-selection-done";
    done.textContent = "Done";
    done.addEventListener("click", () => this.exit());

    this.bar.append(this.countEl, actions, this.allBtn, done);
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
    // Name the kind: the bar can be the only thing on screen once a panel is
    // scrolled away, and "4 selected" doesn't say four of what.
    this.countEl.textContent = `${n} ${this.host.noun}${n === 1 ? "" : "s"} selected`;
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

  /**
   * Tick everything, or clear the lot if it's already all ticked.
   *
   * Reads the full list rather than the rendered rows: a collapsed folder
   * shows no rows, and "Select all" that skipped it would be a quiet lie —
   * the folder the user just filed 300 waypoints into is exactly the one
   * they want to act on.
   */
  private async selectAll(): Promise<void> {
    const all = await this.host.allItems();
    const everything = all.length > 0 && this.selected.size === all.length;
    this.selected.clear();
    if (!everything) {
      for (const item of all) {
        this.items.set(this.host.idOf(item), item);
        this.selected.add(this.host.idOf(item));
      }
    }
    this.updateCount();
    await this.host.refresh();
  }

  /** Tick or clear one folder's contents (its header row in selection mode). */
  private toggleFolder(contents: T[]): void {
    const all = contents.every((item) => this.isSelected(item));
    for (const item of contents) {
      const id = this.host.idOf(item);
      this.items.set(id, item);
      if (all) this.selected.delete(id);
      else this.selected.add(id);
    }
    this.updateCount();
    void this.host.refresh();
  }

  /**
   * Put a checkbox on a folder header so a whole folder is one tap. In
   * selection mode the header's collapse-on-click is suppressed — the
   * checkbox is what a tap there means.
   */
  decorateFolderRow(contents: T[], row: HTMLElement): void {
    if (!this.active) return;
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "manager-select-box";
    box.checked =
      contents.length > 0 && contents.every((item) => this.isSelected(item));
    box.addEventListener("click", (e) => e.stopPropagation());
    box.addEventListener("change", () => this.toggleFolder(contents));
    row.prepend(box);
    row.addEventListener(
      "click",
      (e) => {
        e.stopPropagation();
        this.toggleFolder(contents);
      },
      true,
    );
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
      await this.host.setVisibleAll(this.chosen(), visible);
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
    await this.host.setFolderAll(items, choice.folder);
    await this.host.afterBulkChange?.();
    this.exit();
  }

  private async deleteAll(): Promise<void> {
    const items = this.chosen();
    if (items.length === 0) return;
    const what = `${items.length} ${this.host.noun}${items.length === 1 ? "" : "s"}`;
    if (!confirm(`Delete ${what}?`)) return;
    await this.host.removeAll(items);
    await this.host.afterBulkChange?.();
    this.exit();
  }
}
