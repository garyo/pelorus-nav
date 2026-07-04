/**
 * Keyed status banners — persistent, high-contrast notices for conditions the
 * user must see and act on (e.g. "Bluetooth is off"). Unlike updateNotice
 * (bottom-center, one-at-a-time, clobbers by class), banners are keyed by id:
 * re-showing an id replaces only that banner, and multiple banners stack
 * top-center without interfering. No animations (e-ink friendly); a banner
 * stays until hidden by code or dismissed by the user.
 */

export interface StatusBannerOptions {
  /** Stable key — re-showing the same id replaces that banner only. */
  id: string;
  message: string;
  actionLabel?: string;
  /** Action does NOT auto-hide the banner; the caller hides it on success. */
  onAction?: () => void;
  onDismiss?: () => void;
}

const STACK_CLASS = "status-banner-stack";

function getStack(): HTMLElement {
  let stack = document.querySelector<HTMLElement>(`.${STACK_CLASS}`);
  if (!stack) {
    stack = document.createElement("div");
    stack.className = STACK_CLASS;
    document.body.appendChild(stack);
  }
  return stack;
}

function findBanner(id: string): HTMLElement | undefined {
  return Array.from(
    document.querySelectorAll<HTMLElement>(".status-banner"),
  ).find((el) => el.dataset.bannerId === id);
}

export function showStatusBanner(options: StatusBannerOptions): void {
  const stack = getStack();
  findBanner(options.id)?.remove();

  const banner = document.createElement("div");
  banner.className = "status-banner";
  banner.dataset.bannerId = options.id;

  const icon = document.createElement("span");
  icon.className = "status-banner-icon";
  icon.textContent = "⚠";

  const text = document.createElement("span");
  text.className = "status-banner-text";
  text.textContent = options.message;

  banner.append(icon, text);

  if (options.actionLabel && options.onAction) {
    const actionBtn = document.createElement("button");
    actionBtn.textContent = options.actionLabel;
    actionBtn.addEventListener("click", () => {
      options.onAction?.();
    });
    banner.appendChild(actionBtn);
  }

  const dismissBtn = document.createElement("button");
  dismissBtn.textContent = "Dismiss";
  dismissBtn.addEventListener("click", () => {
    banner.remove();
    options.onDismiss?.();
  });
  banner.appendChild(dismissBtn);

  stack.appendChild(banner);
}

export function hideStatusBanner(id: string): void {
  findBanner(id)?.remove();
}
