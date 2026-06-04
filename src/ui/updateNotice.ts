/**
 * Floating bottom-center notice with an action and a dismiss button.
 * Shared by the chart and app update notifiers; one notice at a time.
 */

export interface UpdateNoticeOptions {
  message: string;
  actionLabel: string;
  onAction: () => void;
  /** Called when the user dismisses with "Later". */
  onDismiss?: () => void;
}

export function showUpdateNotice(options: UpdateNoticeOptions): void {
  document.querySelector(".update-notice")?.remove();

  const notice = document.createElement("div");
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
