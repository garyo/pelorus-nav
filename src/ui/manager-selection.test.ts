// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  attachLongPress,
  ManagerSelection,
  type SelectionHost,
} from "./manager-selection";

interface Item {
  id: string;
  visible: boolean;
  folder?: string;
}

type TestHost = SelectionHost<Item> & {
  refresh: ReturnType<typeof vi.fn>;
  afterBulkChange: ReturnType<typeof vi.fn>;
};

function host(over: Partial<SelectionHost<Item>> = {}): TestHost {
  return {
    noun: "route",
    surfaceId: `sel-${Math.random().toString(36).slice(2)}`,
    group: "routes",
    idOf: (i: Item) => i.id,
    refresh: vi.fn(),
    setVisibleAll: vi.fn(async (items: Item[], visible: boolean) => {
      for (const item of items) item.visible = visible;
    }),
    setFolderAll: vi.fn(async (items: Item[], folder: string | undefined) => {
      for (const item of items) item.folder = folder;
    }),
    removeAll: vi.fn(async () => {}),
    allItems: vi.fn(async () => [] as Item[]),
    folders: vi.fn(async () => ["Maine Cruise"]),
    afterBulkChange: vi.fn(async () => {}),
    ...over,
  } as unknown as TestHost;
}

function makeSelection(h: TestHost) {
  return new ManagerSelection<Item>(h);
}

function row(): HTMLElement {
  const el = document.createElement("div");
  el.className = "manager-item";
  document.body.appendChild(el);
  return el;
}

function pointer(type: string, x = 0, y = 0): PointerEvent {
  return new PointerEvent(type, {
    clientX: x,
    clientY: y,
    bubbles: true,
    isPrimary: true,
    button: 0,
  });
}

describe("attachLongPress", () => {
  beforeEach(() => vi.useFakeTimers());

  it("fires after a held press", () => {
    const el = row();
    const onLong = vi.fn();
    attachLongPress(el, onLong);

    el.dispatchEvent(pointer("pointerdown"));
    vi.advanceTimersByTime(600);

    expect(onLong).toHaveBeenCalledTimes(1);
  });

  it("does not fire on a quick tap", () => {
    const el = row();
    const onLong = vi.fn();
    attachLongPress(el, onLong);

    el.dispatchEvent(pointer("pointerdown"));
    vi.advanceTimersByTime(200);
    el.dispatchEvent(pointer("pointerup"));
    vi.advanceTimersByTime(600);

    expect(onLong).not.toHaveBeenCalled();
  });

  it("cancels when the finger moves — that's a scroll, not a press", () => {
    const el = row();
    const onLong = vi.fn();
    attachLongPress(el, onLong);

    el.dispatchEvent(pointer("pointerdown", 0, 0));
    el.dispatchEvent(pointer("pointermove", 0, 40));
    vi.advanceTimersByTime(600);

    expect(onLong).not.toHaveBeenCalled();
  });

  it("tolerates a small wobble", () => {
    const el = row();
    const onLong = vi.fn();
    attachLongPress(el, onLong);

    el.dispatchEvent(pointer("pointerdown", 0, 0));
    el.dispatchEvent(pointer("pointermove", 3, 4));
    vi.advanceTimersByTime(600);

    expect(onLong).toHaveBeenCalledTimes(1);
  });

  it("stops firing once detached", () => {
    const el = row();
    const onLong = vi.fn();
    attachLongPress(el, onLong)();

    el.dispatchEvent(pointer("pointerdown"));
    vi.advanceTimersByTime(600);

    expect(onLong).not.toHaveBeenCalled();
  });
});

describe("ManagerSelection", () => {
  beforeEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("starts inactive and leaves rows alone", () => {
    const sel = makeSelection(host());
    const item = { id: "a", visible: true };
    const el = row();

    sel.decorateRow(item, el);

    expect(sel.isActive()).toBe(false);
    expect(el.querySelector(".manager-select-box")).toBeNull();
  });

  it("adds a checkbox and stands the row's own actions down", () => {
    const sel = makeSelection(host());
    sel.enter();
    const item = { id: "a", visible: true };
    const el = row();
    const actions = document.createElement("div");

    sel.decorateRow(item, el, actions);

    expect(el.querySelector(".manager-select-box")).not.toBeNull();
    expect(actions.style.display).toBe("none");
  });

  it("enters with the long-pressed row already ticked", () => {
    const sel = makeSelection(host());
    const item = { id: "a", visible: true };

    sel.enter(item);

    expect(sel.isActive()).toBe(true);
    expect(sel.isSelected(item)).toBe(true);
  });

  it("toggles a row on tap", () => {
    const h = host();
    const sel = makeSelection(h);
    sel.enter();
    const item = { id: "a", visible: true };
    const el = row();
    sel.decorateRow(item, el);

    el.click();
    expect(sel.isSelected(item)).toBe(true);
    el.click();
    expect(sel.isSelected(item)).toBe(false);
  });

  it("hides every selected item, then leaves the mode", async () => {
    const h = host();
    const sel = makeSelection(h);
    const a = { id: "a", visible: true };
    const b = { id: "b", visible: true };
    const c = { id: "c", visible: true };
    sel.enter(a);
    for (const item of [a, b, c]) sel.track(item);
    const bRow = row();
    sel.decorateRow(b, bRow);
    bRow.click(); // tick b as well

    (
      document.querySelector(
        '.manager-selection-btn[title="Hide"]',
      ) as HTMLButtonElement
    ).click();
    // Wait on the last step of the bulk action, not the first — asserting on
    // the first item's state can observe the run mid-flight.
    await vi.waitFor(() => expect(h.afterBulkChange).toHaveBeenCalled());

    expect(a.visible).toBe(false);
    expect(b.visible).toBe(false);
    expect(c.visible).toBe(true); // never selected
    expect(sel.isActive()).toBe(false);
  });

  it("counts the selection in the bar", () => {
    const sel = makeSelection(host());
    const a = { id: "a", visible: true };
    sel.enter(a);
    const bar = document.querySelector(".manager-selection-count");
    expect(bar?.textContent).toBe("1 route selected");
  });

  it("labels the select-all button by what it will do", () => {
    const sel = makeSelection(host());
    sel.enter();
    const all = document.querySelector(
      ".manager-selection-all",
    ) as HTMLButtonElement;
    expect(all.textContent).toBe("All");

    sel.enter(); // no-op while active
    const item = { id: "a", visible: true };
    const el = row();
    sel.decorateRow(item, el);
    el.click();

    expect(all.textContent).toBe("None");
  });

  it("disables the actions when nothing is selected", () => {
    const sel = makeSelection(host());
    sel.enter();
    const btn = document.querySelector(
      '.manager-selection-btn[title="Hide"]',
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("clears the selection on exit, so the next entry starts empty", () => {
    const sel = makeSelection(host());
    const a = { id: "a", visible: true };
    sel.enter(a);
    sel.exit();
    sel.enter();
    expect(sel.isSelected(a)).toBe(false);
  });

  it("leaves the mode on Escape", () => {
    const sel = makeSelection(host());
    sel.enter();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(sel.isActive()).toBe(false);
  });

  it("consumes Escape so it can't also cancel navigation behind the panel", () => {
    const sel = makeSelection(host());
    sel.enter();
    const e = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    document.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  });

  it("ignores Escape once inactive", () => {
    const sel = makeSelection(host());
    sel.enter();
    sel.exit();
    const e = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    document.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });
});
