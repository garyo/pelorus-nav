/**
 * Floating bottom-center notice with an action and a dismiss button.
 * Shared styling for the chart and app update notifiers, but each caller
 * passes its own `id` so one notifier's notice can't remove the other's —
 * only a notice with a matching id gets replaced.
 */

export interface UpdateNoticeOptions {
  /** DOM id — scopes removal/replacement to notices from the same caller. */
  id: string;
  message: string;
  actionLabel: string;
  onAction: () => void;
  /** Called when the user dismisses with "Later". */
  onDismiss?: () => void;
}

export function showUpdateNotice(options: UpdateNoticeOptions): void {
  document.getElementById(options.id)?.remove();

  const notice = document.createElement("div");
  notice.id = options.id;
  notice.className = "update-notice";

  const text = document.createElement("span");
  text.textContent = options.message;

  const actionBtn = document.createElement("button");
  actionBtn.textContent = options.actionLabel;
  actionBtn.addEventListener("click", () => {
    notice.remove();
    options.onAction();
  });

  const laterBtn = document.createElement("button");
  laterBtn.textContent = "Later";
  laterBtn.addEventListener("click", () => {
    notice.remove();
    options.onDismiss?.();
  });

  notice.append(text, actionBtn, laterBtn);
  document.body.appendChild(notice);
}
