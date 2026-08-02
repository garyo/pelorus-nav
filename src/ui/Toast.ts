/**
 * Transient bottom-center toast with an optional action, for reporting a
 * change the user just made and offering to take it back.
 *
 * The third notice shape in the app, and deliberately distinct from the other
 * two: updateNotice is a standing offer that waits for an answer, StatusBanner
 * is a condition that persists until it clears. A toast is neither — it
 * reports something already done and expires on its own, so it must never
 * carry anything the user has to act on.
 *
 * One at a time: a second toast replaces the first rather than stacking, since
 * a queue of expiring messages is a queue nobody reads.
 */

const TOAST_ID = "app-toast";

/** How long a toast stays up. Long enough to read a sentence and reach for
 *  the action on a moving boat. */
const TOAST_MS = 8000;

export interface ToastOptions {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Visible lifetime in ms (default 8 s). */
  durationMs?: number;
}

export function hideToast(): void {
  document.getElementById(TOAST_ID)?.remove();
}

export function showToast(options: ToastOptions): void {
  hideToast();

  const toast = document.createElement("div");
  toast.id = TOAST_ID;
  toast.className = "app-toast";

  const text = document.createElement("span");
  text.textContent = options.message;
  toast.appendChild(text);

  if (options.actionLabel && options.onAction) {
    const actionBtn = document.createElement("button");
    actionBtn.textContent = options.actionLabel;
    actionBtn.addEventListener("click", () => {
      // Clear the timeout with the element: an action fired at the last
      // moment must not race the auto-hide into removing a *newer* toast.
      hideToast();
      clearTimeout(timer);
      options.onAction?.();
    });
    toast.appendChild(actionBtn);
  }

  document.body.appendChild(toast);

  const timer = setTimeout(() => {
    // Only if it's still ours — a replacement toast owns the id by now.
    if (document.getElementById(TOAST_ID) === toast) toast.remove();
  }, options.durationMs ?? TOAST_MS);
}
