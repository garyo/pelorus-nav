import { describe, expect, it } from "vitest";
import { folderVisibility, groupByFolder } from "./manager-folders";

interface Item {
  folder?: string;
  createdAt: number;
  name: string;
}

const item = (name: string, createdAt: number, folder?: string): Item => ({
  name,
  createdAt,
  ...(folder !== undefined ? { folder } : {}),
});

describe("groupByFolder", () => {
  it("returns empty groups for empty input", () => {
    const g = groupByFolder<Item>([]);
    expect(g.ungrouped).toEqual([]);
    expect(g.folders.size).toBe(0);
  });

  it("treats undefined, empty, and whitespace folders as ungrouped", () => {
    const g = groupByFolder([
      item("a", 1),
      item("b", 2, ""),
      item("c", 3, "   "),
    ]);
    expect(g.ungrouped.map((i) => i.name)).toEqual(["c", "b", "a"]);
    expect(g.folders.size).toBe(0);
  });

  it("sorts ungrouped newest-first, folders alphabetically, contents newest-first", () => {
    const g = groupByFolder([
      item("old-loose", 1),
      item("usvi-1", 10, "USVI"),
      item("new-loose", 5),
      item("maine-1", 20, "Maine"),
      item("usvi-2", 30, "USVI"),
    ]);
    expect(g.ungrouped.map((i) => i.name)).toEqual(["new-loose", "old-loose"]);
    expect([...g.folders.keys()]).toEqual(["Maine", "USVI"]);
    expect(g.folders.get("USVI")?.map((i) => i.name)).toEqual([
      "usvi-2",
      "usvi-1",
    ]);
  });

  it("trims folder names when grouping", () => {
    const g = groupByFolder([item("a", 1, " USVI "), item("b", 2, "USVI")]);
    expect([...g.folders.keys()]).toEqual(["USVI"]);
    expect(g.folders.get("USVI")).toHaveLength(2);
  });
});

describe("folderVisibility", () => {
  it("reports all / none / mixed", () => {
    expect(folderVisibility([{ visible: true }, { visible: true }])).toBe(
      "all",
    );
    expect(folderVisibility([{ visible: false }, { visible: false }])).toBe(
      "none",
    );
    expect(folderVisibility([{ visible: true }, { visible: false }])).toBe(
      "mixed",
    );
  });

  it("handles single-item folders", () => {
    expect(folderVisibility([{ visible: true }])).toBe("all");
    expect(folderVisibility([{ visible: false }])).toBe("none");
  });
});
