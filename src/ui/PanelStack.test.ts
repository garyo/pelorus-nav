// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getPanelStack, trackInstrumentHUD } from "./PanelStack";

function fakeHud(rect: {
  top: number;
  bottom: number;
  width: number;
}): HTMLElement {
  const el = document.createElement("div");
  el.getBoundingClientRect = () =>
    ({
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.bottom - rect.top,
      left: 0,
      right: rect.width,
      x: 0,
      y: rect.top,
      toJSON: () => ({}),
    }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

describe("trackInstrumentHUD panel positioning", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    Object.defineProperty(window, "innerWidth", {
      value: 800,
      configurable: true,
    });
  });

  it("sits below a full-width HUD (top bar layout)", () => {
    const hud = fakeHud({ top: 70, bottom: 160, width: 800 });
    trackInstrumentHUD(hud);
    expect(getPanelStack().style.top).toBe("160px");
  });

  it("sits beside a narrow HUD (side column layout)", () => {
    const hud = fakeHud({ top: 70, bottom: 400, width: 160 });
    trackInstrumentHUD(hud);
    expect(getPanelStack().style.top).toBe("70px");
  });

  it("clears its inline top when the HUD is hidden, deferring to CSS", () => {
    const hud = fakeHud({ top: 0, bottom: 0, width: 0 });
    trackInstrumentHUD(hud);
    // Empty inline top → the stylesheet's top: var(--topbar-bottom) applies,
    // which accounts for the safe-area inset (a hardcoded px would sit too
    // high under the top bar in fullscreen).
    expect(getPanelStack().style.top).toBe("");
    expect(getPanelStack().style.maxHeight).toBe("");
  });

  it("recomputes when the HUD moves without resizing (fullscreen transition)", () => {
    let rect = { top: 46, bottom: 136, width: 800 };
    const hud = document.createElement("div");
    hud.getBoundingClientRect = () =>
      ({
        ...rect,
        height: rect.bottom - rect.top,
        left: 0,
        right: rect.width,
        x: 0,
        y: rect.top,
        toJSON: () => ({}),
      }) as DOMRect;
    document.body.appendChild(hud);
    trackInstrumentHUD(hud);
    expect(getPanelStack().style.top).toBe("136px");

    // Enter fullscreen: safe-area inset shifts the HUD down 24px, same height.
    rect = { top: 70, bottom: 160, width: 800 };
    document.dispatchEvent(new Event("fullscreenchange"));
    expect(getPanelStack().style.top).toBe("160px");
  });
});
