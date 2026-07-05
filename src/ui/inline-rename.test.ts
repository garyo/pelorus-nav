// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { startInlineRename } from "./inline-rename";

function makeLabel(name: string): HTMLDivElement {
  const container = document.createElement("div");
  const label = document.createElement("div");
  label.className = "manager-item-name";
  label.textContent = name;
  container.appendChild(label);
  document.body.appendChild(container);
  return label;
}

describe("startInlineRename", () => {
  it("replaces the label with a focused, pre-selected input", () => {
    const label = makeLabel("Original");
    const parent = label.parentElement as HTMLElement;
    startInlineRename(label, "Original", {
      setEditing: () => {},
      onCommit: () => {},
      refresh: () => {},
    });

    const input = parent.querySelector("input");
    expect(input).not.toBeNull();
    expect(input?.value).toBe("Original");
    expect(document.activeElement).toBe(input);
    expect(parent.contains(label)).toBe(false);
  });

  it("commits the trimmed value on blur", async () => {
    const label = makeLabel("Original");
    const parent = label.parentElement as HTMLElement;
    const onCommit = vi.fn();
    const refresh = vi.fn();
    startInlineRename(label, "Original", {
      setEditing: () => {},
      onCommit,
      refresh,
    });

    const input = parent.querySelector("input") as HTMLInputElement;
    input.value = "  New Name  ";
    input.dispatchEvent(new Event("blur"));
    await Promise.resolve();
    await Promise.resolve();

    expect(onCommit).toHaveBeenCalledWith("New Name");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("falls back to the original name when the input is left blank", async () => {
    const label = makeLabel("Original");
    const parent = label.parentElement as HTMLElement;
    const onCommit = vi.fn();
    startInlineRename(label, "Original", {
      setEditing: () => {},
      onCommit,
      refresh: () => {},
    });

    const input = parent.querySelector("input") as HTMLInputElement;
    input.value = "   ";
    input.dispatchEvent(new Event("blur"));
    await Promise.resolve();
    await Promise.resolve();

    expect(onCommit).toHaveBeenCalledWith("Original");
  });

  it("commits via Enter, which blurs the input", async () => {
    const label = makeLabel("Original");
    const parent = label.parentElement as HTMLElement;
    const onCommit = vi.fn();
    startInlineRename(label, "Original", {
      setEditing: () => {},
      onCommit,
      refresh: () => {},
    });

    const input = parent.querySelector("input") as HTMLInputElement;
    input.value = "Renamed";
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(onCommit).toHaveBeenCalledWith("Renamed");
  });

  it("reverts to the original value and still commits on Escape", async () => {
    const label = makeLabel("Original");
    const parent = label.parentElement as HTMLElement;
    const onCommit = vi.fn();
    startInlineRename(label, "Original", {
      setEditing: () => {},
      onCommit,
      refresh: () => {},
    });

    const input = parent.querySelector("input") as HTMLInputElement;
    input.value = "Half-typed edit";
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await Promise.resolve();
    await Promise.resolve();

    // Escape resets the visible value immediately (before blur commits).
    expect(input.value).toBe("Original");
    expect(onCommit).toHaveBeenCalledWith("Original");
  });

  it("sets editing true synchronously, and false before onCommit's async work resolves", async () => {
    const label = makeLabel("Original");
    const parent = label.parentElement as HTMLElement;
    const editingStates: boolean[] = [];
    let resolveCommit: () => void = () => {};
    const commitStarted = new Promise<void>((resolve) => {
      resolveCommit = resolve;
    });
    let onCommitCalledWhileEditingWasFalse = false;

    startInlineRename(label, "Original", {
      setEditing: (v) => editingStates.push(v),
      onCommit: async () => {
        onCommitCalledWhileEditingWasFalse =
          editingStates[editingStates.length - 1] === false;
        resolveCommit();
        await new Promise((r) => setTimeout(r, 0));
      },
      refresh: () => {},
    });

    expect(editingStates).toEqual([true]);

    const input = parent.querySelector("input") as HTMLInputElement;
    input.dispatchEvent(new Event("blur"));
    await commitStarted;

    expect(editingStates).toEqual([true, false]);
    expect(onCommitCalledWhileEditingWasFalse).toBe(true);
  });

  it("does not throw when the input is removed from the DOM without blur firing", () => {
    const label = makeLabel("Original");
    const parent = label.parentElement as HTMLElement;
    startInlineRename(label, "Original", {
      setEditing: () => {},
      onCommit: () => {},
      refresh: () => {},
    });

    const input = parent.querySelector("input") as HTMLInputElement;
    expect(() => input.remove()).not.toThrow();
    // No blur fired, so nothing commits — the panel's own defensive reset
    // (editing = false in show()/hide()) is what unsticks this case, not
    // this helper; see TrackManagerPanel.test.ts.
  });
});
