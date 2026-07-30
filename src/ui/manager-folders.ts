/**
 * Pure grouping helpers for manager panels (routes today; tracks could adopt
 * the same mechanism later). Folders exist implicitly: a folder exists iff
 * at least one item references it — there are no folder objects anywhere.
 */

export type ManagerSort = "name" | "recent";

/** Item comparator for the manager panels: name A–Z or newest first. */
export function managerSortComparator<
  T extends { createdAt: number; name: string },
>(sort: ManagerSort): (a: T, b: T) => number {
  return sort === "recent"
    ? (a, b) => b.createdAt - a.createdAt
    : (a, b) => a.name.localeCompare(b.name);
}

export interface FolderGroups<T> {
  /** Items with no folder, in the requested sort (the panel's top-level order). */
  ungrouped: T[];
  /** Folder name → items in the requested sort; insertion order is
   *  alphabetical regardless — recency-ordered headers would feel random. */
  folders: Map<string, T[]>;
}

/** Group items by their optional folder. Empty/whitespace folders count as
 *  ungrouped; folder names sort with localeCompare. */
export function groupByFolder<
  T extends { folder?: string; createdAt: number; name: string },
>(items: readonly T[], sort: ManagerSort = "name"): FolderGroups<T> {
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
  const cmp = managerSortComparator<T>(sort);
  ungrouped.sort(cmp);
  const folders = new Map(
    [...byName.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, list]) => [name, list.sort(cmp)] as const),
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
