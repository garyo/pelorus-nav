// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { relayoutTopbar, type TopbarOverflowElements } from "./topbar-overflow";

/** Build a bar whose menu holds the given children; "~Name" makes a
 *  non-action element (like the offline indicator). */
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

  it("promotes every action but never the settings wrapper", () => {
    relayoutTopbar(els, promoted, {
      fits: () => true,
      isNarrow: () => true,
    });
    expect(labels(els.actions)).toEqual([
      "WPT",
      "PLOT",
      "RGNS",
      "FIND",
      "TIME",
    ]);
    expect(labels(els.menu)).toEqual(["SET"]);
  });

  it("demotes back into original order when space shrinks", () => {
    relayoutTopbar(els, promoted, {
      fits: () => true,
      isNarrow: () => true,
    });
    relayoutTopbar(els, promoted, {
      fits: () => promoted.length <= 1,
      isNarrow: () => true,
    });
    expect(labels(els.actions)).toEqual(["WPT"]);
    expect(labels(els.menu)).toEqual(["PLOT", "RGNS", "FIND", "TIME", "SET"]);
  });

  it("restores canonical menu order in wide mode", () => {
    relayoutTopbar(els, promoted, {
      fits: () => true,
      isNarrow: () => true,
    });
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
    relayoutTopbar(els, promoted, {
      fits: () => true,
      isNarrow: () => true,
    });
    expect(labels(els.actions)).toEqual(["FULL", "INFO"]);
    expect(labels(els.menu)).toEqual(["Offline", "SET"]);

    relayoutTopbar(els, promoted, { isNarrow: () => false });
    expect(labels(els.menu)).toEqual(["FULL", "Offline", "INFO", "SET"]);
  });
});
