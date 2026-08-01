// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  createFolderRow,
  pruneCollapsed,
  toggleCollapsed,
} from "./manager-folder-row";

interface Item {
  name: string;
  visible: boolean;
}

const item = (name: string, visible: boolean): Item => ({ name, visible });

function row(
  contents: Item[],
  overrides: Partial<Parameters<typeof createFolderRow<Item>>[0]> = {},
) {
  return createFolderRow<Item>({
    name: "Maine Cruise",
    contents,
    isCollapsed: false,
    onToggleCollapse: () => {},
    setVisible: async () => {},
    refresh: async () => {},
    ...overrides,
  });
}

describe("toggleCollapsed", () => {
  it("adds a folder that isn't collapsed", () => {
    expect(toggleCollapsed(["A"], "B")).toEqual(["A", "B"]);
  });

  it("removes one that is", () => {
    expect(toggleCollapsed(["A", "B"], "A")).toEqual(["B"]);
  });

  it("leaves the input untouched", () => {
    const before = ["A"];
    toggleCollapsed(before, "B");
    expect(before).toEqual(["A"]);
  });
});

describe("pruneCollapsed", () => {
  const folders = new Map([["A", []]]);

  it("drops entries for folders that no longer exist", () => {
    expect(pruneCollapsed(["A", "gone"], folders)).toEqual(["A"]);
  });

  it("returns the same array when nothing is stale, so callers can skip a write", () => {
    const stored = ["A"];
    expect(pruneCollapsed(stored, folders)).toBe(stored);
  });
});

describe("createFolderRow", () => {
  it("shows the name and item count", () => {
    const el = row([item("a", true), item("b", true)]);
    expect(el.textContent).toContain("Maine Cruise");
    expect(el.textContent).toContain("(2)");
  });

  it("offers to hide when everything is visible", () => {
    const el = row([item("a", true)]);
    expect(el.querySelector("button")?.title).toBe("Hide all");
  });

  it("offers to show when nothing is", () => {
    const el = row([item("a", false)]);
    expect(el.querySelector("button")?.title).toBe("Show all");
  });

  it("marks a partly visible folder mixed, and still offers to hide", () => {
    const el = row([item("a", true), item("b", false)]);
    const btn = el.querySelector("button");
    expect(btn?.classList.contains("mixed")).toBe(true);
    expect(btn?.title).toBe("Hide all");
  });

  it("hides the whole folder in one call, not one per item", async () => {
    const setVisible = vi.fn(async (_items: Item[], _visible: boolean) => {});
    const contents = [item("a", true), item("b", true)];
    const el = row(contents, { setVisible });

    el.querySelector("button")?.click();
    await vi.waitFor(() => expect(setVisible).toHaveBeenCalledTimes(1));

    expect(setVisible).toHaveBeenCalledWith(contents, false);
  });

  it("shows the whole folder when none of it is visible", async () => {
    const setVisible = vi.fn(async (_items: Item[], _visible: boolean) => {});
    const contents = [item("a", false), item("b", false)];
    const el = row(contents, { setVisible });

    el.querySelector("button")?.click();
    await vi.waitFor(() => expect(setVisible).toHaveBeenCalledTimes(1));

    expect(setVisible).toHaveBeenCalledWith(contents, true);
  });

  it("collapses on a row click but not on an eye click", () => {
    const onToggleCollapse = vi.fn();
    const el = row([item("a", true)], { onToggleCollapse });
    el.querySelector("button")?.click();
    expect(onToggleCollapse).not.toHaveBeenCalled();
    el.click();
    expect(onToggleCollapse).toHaveBeenCalledWith("Maine Cruise");
  });
});
