// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { uiActionLog } from "../diagnostics/uiActionLog";
import {
  registerSurface,
  resetSurfacesForTest,
  type SurfaceDecl,
} from "./SurfaceManager";

interface Fake {
  el: HTMLElement;
  open: boolean;
  opened: () => void;
}

function makeSurface(
  id: string,
  opts: Partial<Omit<SurfaceDecl, "id" | "el" | "isOpen" | "close">> & {
    slot?: SurfaceDecl["slot"];
  } = {},
): Fake {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const fake: Fake = { el, open: false, opened: () => {} };
  const handle = registerSurface({
    id,
    slot: opts.slot ?? "top-right",
    group: opts.group,
    priority: opts.priority,
    closeOnOutsideClick: opts.closeOnOutsideClick,
    el: () => el,
    isOpen: () => fake.open,
    close: () => {
      fake.open = false;
    },
  });
  fake.opened = () => {
    fake.open = true;
    handle.opened();
  };
  return fake;
}

const settle = () => new Promise((r) => setTimeout(r, 5));

describe("SurfaceManager", () => {
  beforeEach(() => {
    resetSurfacesForTest();
    document.body.innerHTML = "";
  });

  it("evicts other groups in the same slot on open", () => {
    const a = makeSurface("a");
    const b = makeSurface("b");
    a.opened();
    b.opened();
    expect(a.open).toBe(false);
    expect(b.open).toBe(true);
  });

  it("lets same-group surfaces coexist", () => {
    const mgr = makeSurface("mgr", { group: "routes" });
    const detail = makeSurface("detail", { group: "routes" });
    mgr.opened();
    detail.opened();
    expect(mgr.open).toBe(true);
    expect(detail.open).toBe(true);
  });

  it("does not touch surfaces in other slots", () => {
    const panel = makeSurface("panel", { slot: "top-right" });
    const bar = makeSurface("bar", { slot: "bottom-center" });
    panel.opened();
    bar.opened();
    expect(panel.open).toBe(true);
    expect(bar.open).toBe(true);
  });

  it("never evicts or outside-closes a priority surface", async () => {
    const cob = makeSurface("cob", { slot: "bottom-center", priority: true });
    const time = makeSurface("time", { slot: "bottom-center" });
    cob.opened();
    time.opened();
    expect(cob.open).toBe(true);
    await settle();
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(cob.open).toBe(true);
  });

  it("assigns z bands: slot 10000, priority 10500", () => {
    const panel = makeSurface("panel");
    const cob = makeSurface("cob", { slot: "bottom-center", priority: true });
    panel.opened();
    cob.opened();
    expect(panel.el.style.zIndex).toBe("10000");
    expect(cob.el.style.zIndex).toBe("10500");
  });

  it("closes on outside click but not on inside click", async () => {
    const a = makeSurface("a");
    a.opened();
    await settle();
    a.el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(a.open).toBe(true);
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(a.open).toBe(false);
  });

  it("ignores the click that opened the surface (toggle/menu race)", () => {
    const a = makeSurface("a");
    // Simulate: a button's click handler opens the surface, then the same
    // click bubbles to the document. The event predates opened().
    const evt = new MouseEvent("click", { bubbles: true });
    a.opened();
    document.body.dispatchEvent(evt);
    expect(a.open).toBe(true);
  });

  it("respects closeOnOutsideClick: false", async () => {
    const bar = makeSurface("bar", {
      slot: "bottom-center",
      closeOnOutsideClick: false,
    });
    bar.opened();
    await settle();
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(bar.open).toBe(true);
  });

  it("Escape closes the most recently opened surface first", () => {
    const a = makeSurface("a", { group: "a" });
    const b = makeSurface("b", { slot: "bottom-center" });
    a.opened();
    b.opened();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(b.open).toBe(false);
    expect(a.open).toBe(true);
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(a.open).toBe(false);
  });

  it("leaves Escape alone while typing in an input", () => {
    const a = makeSurface("a");
    a.opened();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(a.open).toBe(true);
  });

  it("leaves a breadcrumb trail in the UI action log", () => {
    uiActionLog.clear();
    const a = makeSurface("a");
    a.opened();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(uiActionLog.getEntries().map((e) => e.detail)).toEqual([
      "open a",
      "close a (esc)",
    ]);
  });
});
