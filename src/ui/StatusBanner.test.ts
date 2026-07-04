// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hideStatusBanner, showStatusBanner } from "./StatusBanner";

function banners(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".status-banner"));
}

describe("StatusBanner", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("shows a banner with message and action", () => {
    showStatusBanner({
      id: "ble-bt",
      message: "Bluetooth is OFF",
      actionLabel: "Turn On",
      onAction: () => {},
    });
    const all = banners();
    expect(all).toHaveLength(1);
    expect(all[0].textContent).toContain("Bluetooth is OFF");
    const buttons = all[0].querySelectorAll("button");
    expect(buttons).toHaveLength(2); // action + dismiss
    expect(buttons[0].textContent).toBe("Turn On");
  });

  it("re-showing the same id replaces that banner, not others", () => {
    showStatusBanner({ id: "a", message: "first" });
    showStatusBanner({ id: "b", message: "other" });
    const bElement = banners().find((el) => el.dataset.bannerId === "b");
    showStatusBanner({ id: "a", message: "updated" });
    const all = banners();
    expect(all).toHaveLength(2);
    expect(
      all.find((el) => el.dataset.bannerId === "a")?.textContent,
    ).toContain("updated");
    expect(all.find((el) => el.dataset.bannerId === "b")).toBe(bElement);
  });

  it("hideStatusBanner removes only the matching id", () => {
    showStatusBanner({ id: "a", message: "first" });
    showStatusBanner({ id: "b", message: "other" });
    hideStatusBanner("a");
    const all = banners();
    expect(all).toHaveLength(1);
    expect(all[0].dataset.bannerId).toBe("b");
  });

  it("hideStatusBanner on an unknown id is a no-op", () => {
    showStatusBanner({ id: "a", message: "first" });
    expect(() => hideStatusBanner("nope")).not.toThrow();
    expect(banners()).toHaveLength(1);
  });

  it("action button invokes onAction and does not remove the banner", () => {
    const onAction = vi.fn();
    showStatusBanner({
      id: "a",
      message: "msg",
      actionLabel: "Do",
      onAction,
    });
    banners()[0].querySelectorAll("button")[0].click();
    expect(onAction).toHaveBeenCalledOnce();
    expect(banners()).toHaveLength(1);
  });

  it("dismiss removes the banner and calls onDismiss", () => {
    const onDismiss = vi.fn();
    showStatusBanner({ id: "a", message: "msg", onDismiss });
    const buttons = banners()[0].querySelectorAll("button");
    buttons[buttons.length - 1].click();
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(banners()).toHaveLength(0);
  });
});
