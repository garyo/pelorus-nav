/**
 * Pure grouping helpers for manager panels (routes today; tracks could adopt
 * the same mechanism later). Folders exist implicitly: a folder exists iff
 * at least one item references it — there are no folder objects anywhere.
 */

export interface FolderGroups<T> {
  /** Items with no folder, newest first (the panel's top-level order). */
  ungrouped: T[];
  /** Folder name → items newest first; insertion order is alphabetical. */
  folders: Map<string, T[]>;
}

/** Group items by their optional folder. Empty/whitespace folders count as
 *  ungrouped; folder names sort with localeCompare. */
export function groupByFolder<T extends { folder?: string; createdAt: number }>(
  items: readonly T[],
): FolderGroups<T> {
  const ungrouped: T[] = [];
  const byName = new Map<string, T[]>();
  for (const item of items) {
    const folder = item.folder?.trim();
    if (!folder) {
      ungrouped.push(item);
    } else {
      const list = byName.get(folder);
      if (list) list.push(item);
      else byName.set(folder, [item]);
    }
  }
  const newestFirst = (a: T, b: T) => b.createdAt - a.createdAt;
  ungrouped.sort(newestFirst);
  const folders = new Map(
    [...byName.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, list]) => [name, list.sort(newestFirst)] as const),
  );
  return { ungrouped, folders };
}

export type FolderVisibility = "all" | "none" | "mixed";

/** Bulk-eye state for a folder's contents. */
export function folderVisibility(
  items: readonly { visible: boolean }[],
): FolderVisibility {
  let visible = 0;
  for (const item of items) {
    if (item.visible) visible++;
  }
  if (visible === 0) return "none";
  return visible === items.length ? "all" : "mixed";
}
