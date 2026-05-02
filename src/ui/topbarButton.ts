/**
 * Builds a top-bar icon button with a small uppercase short label.
 * On mobile, items inside #topbar-menu collapse into a dropdown — pass
 * `fullLabel` for the longer descriptive text shown there.
 */
import { setIcon } from "./icons";

export interface TopbarActionOpts {
  /** Full descriptive label shown in the mobile hamburger dropdown. */
  fullLabel?: string;
  /** Extra space-separated class names. */
  extraClass?: string;
}

export function buildTopbarAction(
  icon: string,
  shortLabel: string,
  title: string,
  opts: TopbarActionOpts = {},
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = `topbar-action${opts.extraClass ? ` ${opts.extraClass}` : ""}`;
  btn.title = title;
  btn.setAttribute("aria-label", title);
  setIcon(btn, icon);
  const shortSpan = document.createElement("span");
  shortSpan.className = "topbar-action-label";
  shortSpan.textContent = shortLabel;
  btn.appendChild(shortSpan);
  if (opts.fullLabel) {
    const fullSpan = document.createElement("span");
    fullSpan.className = "topbar-menu-label";
    fullSpan.textContent = opts.fullLabel;
    btn.appendChild(fullSpan);
  }
  return btn;
}
