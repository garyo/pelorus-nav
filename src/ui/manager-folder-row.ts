/**
 * The folder header row shared by the Routes, Waypoints and Tracks panels:
 * chevron + name + count + bulk-visibility eye.
 *
 * Folders exist implicitly (see manager-folders.ts) and behave identically in
 * all three panels, so the row is built here and the panel supplies only what
 * differs: how to persist the collapse state and how to show or hide one of
 * its items. Clicking the row collapses or expands the list; the eye acts on
 * the chart and never on the list.
 */

import {
  iconChevronDown,
  iconChevronRight,
  iconEye,
  iconEyeOff,
  iconTrash,
  setIcon,
} from "./icons";
import { folderVisibility } from "./manager-folders";

export interface FolderRowOptions<T extends { visible: boolean }> {
  name: string;
  contents: T[];
  isCollapsed: boolean;
  /** Persist the new collapse state and re-render. */
  onToggleCollapse: (name: string) => void;
  /** Show or hide the folder's whole contents in one pass — one write and
   *  one redraw, not one per item (a 300-waypoint folder is common). */
  setVisible: (items: T[], visible: boolean) => Promise<void>;
  /** True while the panel is in selection mode: the row selects its contents
   *  rather than collapsing, so one tap can't mean two things. */
  selecting?: boolean;
  /** Ticks the folder's contents when the panel is in selection mode. */
  decorateSelection?: (contents: T[], row: HTMLDivElement) => void;
  /** Delete the folder's whole contents. Confirmation is the panel's, since
   *  only it can name what is about to go. Omit for no delete button. */
  onDelete?: (contents: T[]) => void;
  /** Re-render after a bulk show/hide. */
  refresh: () => Promise<void>;
}

export function createFolderRow<T extends { visible: boolean }>(
  opts: FolderRowOptions<T>,
): HTMLDivElement {
  const { name, contents, isCollapsed } = opts;

  const item = document.createElement("div");
  item.className = "manager-item manager-folder";
  item.title = opts.selecting
    ? "Select this folder"
    : isCollapsed
      ? "Expand folder"
      : "Collapse folder";

  const chevron = document.createElement("span");
  chevron.className = "manager-folder-chevron";
  setIcon(chevron, isCollapsed ? iconChevronRight : iconChevronDown);

  const info = document.createElement("div");
  info.className = "manager-item-info";
  const nameEl = document.createElement("div");
  nameEl.className = "manager-item-name";
  nameEl.textContent = name;
  const count = document.createElement("span");
  count.className = "manager-folder-count";
  count.textContent = ` (${contents.length})`;
  nameEl.appendChild(count);
  info.appendChild(nameEl);

  const actions = document.createElement("div");
  actions.className = "manager-item-actions";
  const eyeBtn = document.createElement("button");
  eyeBtn.className = "manager-item-btn";
  const vis = folderVisibility(contents);
  setIcon(eyeBtn, vis === "none" ? iconEyeOff : iconEye);
  eyeBtn.classList.toggle("mixed", vis === "mixed");
  eyeBtn.title = vis === "none" ? "Show all" : "Hide all";
  eyeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    (async () => {
      await opts.setVisible(contents, folderVisibility(contents) === "none");
      await opts.refresh();
    })().catch(console.error);
  });
  actions.appendChild(eyeBtn);

  if (opts.onDelete) {
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "manager-item-btn";
    setIcon(deleteBtn, iconTrash);
    deleteBtn.title = "Delete folder and its contents";
    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      opts.onDelete?.(contents);
    });
    actions.appendChild(deleteBtn);
  }

  // In selection mode the row belongs to the selection: collapsing here would
  // fire alongside it (at the target, listeners run in registration order —
  // a capture-phase handler added later does not get to go first).
  if (!opts.selecting) {
    item.addEventListener("click", () => opts.onToggleCollapse(name));
  }

  item.append(chevron, info, actions);
  opts.decorateSelection?.(contents, item);
  return item;
}

/** Toggle `name`'s membership in a stored collapsed-folder list. */
export function toggleCollapsed(
  collapsed: readonly string[],
  name: string,
): string[] {
  return collapsed.includes(name)
    ? collapsed.filter((f) => f !== name)
    : [...collapsed, name];
}

/** Drop collapse-state entries for folders that no longer exist. Returns the
 *  same array when nothing is stale, so callers can skip a settings write. */
export function pruneCollapsed(
  collapsed: readonly string[],
  folders: ReadonlyMap<string, unknown>,
): readonly string[] {
  const kept = collapsed.filter((f) => folders.has(f));
  return kept.length === collapsed.length ? collapsed : kept;
}
