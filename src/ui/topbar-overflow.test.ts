// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { relayoutTopbar, type TopbarOverflowElements } from "./topbar-overflow";

/** Build a bar whose menu holds the given children; "~Name" makes a
 *  non-action element (like the offline indicator, hidden by default to
 *  mirror the online case). The settings wrapper is always appended last. */
function makeBar(menuChildren: string[]): TopbarOverflowElements {
  const topBar = document.createElement("header");
  const actions = document.createElement("div");
  const menu = document.createElement("div");
  const hamburger = document.createElement("button");
  topBar.append(actions, hamburger, menu);
  for (const label of menuChildren) {
    if (label.startsWith("~")) {
      const div = document.createElement("div");
      div.className = "offline-indicator";
      div.style.display = "none";
      div.textContent = label.slice(1);
      menu.appendChild(div);
    } else {
      const btn = document.createElement("button");
      btn.className = "topbar-action";
      btn.textContent = label;
      menu.appendChild(btn);
    }
  }
  const settings = document.createElement("div");
  settings.className = "settings-wrapper";
  settings.textContent = "SET";
  menu.appendChild(settings);
  return { topBar, actions, menu, hamburger };
}

const labels = (el: HTMLElement) =>
  [...el.children].map((c) => c.textContent).filter(Boolean);

type Promoted = Parameters<typeof relayoutTopbar>[1];

describe("relayoutTopbar", () => {
  let els: TopbarOverflowElements;
  let promoted: Promoted;

  beforeEach(() => {
    els = makeBar(["WPT", "PLOT", "RGNS", "FIND", "TIME"]);
    promoted = [];
  });

  it("promotes leading menu items while they fit, in order", () => {
    const fits = () => promoted.length <= 3;
    relayoutTopbar(els, promoted, { fits, isNarrow: () => true });
    expect(labels(els.actions)).toEqual(["WPT", "PLOT", "RGNS"]);
    expect(labels(els.menu)).toEqual(["FIND", "TIME", "SET"]);
  });

  it("promotes the settings wrapper last, once actions are all promoted", () => {
    relayoutTopbar(els, promoted, { fits: () => true, isNarrow: () => true });
    expect(labels(els.actions)).toEqual([
      "WPT",
      "PLOT",
      "RGNS",
      "FIND",
      "TIME",
      "SET",
    ]);
    expect(labels(els.menu)).toEqual([]);
  });

  it("hides the hamburger when everything fits (menu empty)", () => {
    relayoutTopbar(els, promoted, { fits: () => true, isNarrow: () => true });
    expect(els.hamburger.style.display).toBe("none");
  });

  it("keeps the hamburger when there is overflow", () => {
    relayoutTopbar(els, promoted, {
      fits: () => promoted.length <= 2,
      isNarrow: () => true,
    });
    // WPT, PLOT promoted; RGNS/FIND/TIME/SET still in the menu.
    expect(els.hamburger.style.display).toBe("");
    expect(labels(els.menu)).toContain("SET");
  });

  it("keeps the hamburger when the offline indicator is showing", () => {
    els = makeBar(["WPT", "~Offline"]);
    promoted = [];
    const offline = els.menu.querySelector<HTMLElement>(".offline-indicator");
    if (offline) offline.style.display = "flex"; // gone offline
    relayoutTopbar(els, promoted, { fits: () => true, isNarrow: () => true });
    // All actions + settings promoted, but the visible offline indicator
    // still needs the hamburger to reach it.
    expect(labels(els.actions)).toEqual(["WPT", "SET"]);
    expect(els.hamburger.style.display).toBe("");
  });

  it("demotes back into original order when space shrinks", () => {
    relayoutTopbar(els, promoted, { fits: () => true, isNarrow: () => true });
    relayoutTopbar(els, promoted, {
      fits: () => promoted.length <= 1,
      isNarrow: () => true,
    });
    expect(labels(els.actions)).toEqual(["WPT"]);
    expect(labels(els.menu)).toEqual(["PLOT", "RGNS", "FIND", "TIME", "SET"]);
  });

  it("restores canonical menu order in wide mode", () => {
    relayoutTopbar(els, promoted, { fits: () => true, isNarrow: () => true });
    relayoutTopbar(els, promoted, { isNarrow: () => false });
    expect(labels(els.actions)).toEqual([]);
    expect(labels(els.menu)).toEqual([
      "WPT",
      "PLOT",
      "RGNS",
      "FIND",
      "TIME",
      "SET",
    ]);
    // Wide mode clears the inline display so CSS hides the hamburger.
    expect(els.hamburger.style.display).toBe("");
  });

  it("keeps nothing promoted when even the first item overflows", () => {
    relayoutTopbar(els, promoted, {
      fits: () => promoted.length === 0,
      isNarrow: () => true,
    });
    expect(labels(els.actions)).toEqual([]);
    expect(labels(els.menu)).toEqual([
      "WPT",
      "PLOT",
      "RGNS",
      "FIND",
      "TIME",
      "SET",
    ]);
  });

  it("promotes past non-action elements and restores their position", () => {
    els = makeBar(["FULL", "~Offline", "INFO"]);
    promoted = [];
    relayoutTopbar(els, promoted, { fits: () => true, isNarrow: () => true });
    expect(labels(els.actions)).toEqual(["FULL", "INFO", "SET"]);
    expect(labels(els.menu)).toEqual(["Offline"]);

    relayoutTopbar(els, promoted, { isNarrow: () => false });
    expect(labels(els.menu)).toEqual(["FULL", "Offline", "INFO", "SET"]);
  });
});
