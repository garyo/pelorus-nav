/**
 * In-DOM replacement for `window.prompt()`.
 *
 * The native prompt is quietly suppressed in states this app spends real
 * time in — Chrome blocks it in fullscreen (the field report: "New folder"
 * never appeared while navigating) — and WebView shells render it
 * inconsistently. A card dialog in our own DOM cannot be suppressed and
 * matches the app's other dialogs.
 *
 * Resolves the entered text, or null on Cancel / Escape / outside tap.
 */

export function showTextPrompt(
  title: string,
  options: { placeholder?: string; confirmLabel?: string } = {},
): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "about-overlay text-prompt-overlay";
    overlay.style.display = "flex";

    const card = document.createElement("div");
    card.className = "about-card text-prompt-card";

    const titleEl = document.createElement("div");
    titleEl.className = "about-title";
    titleEl.textContent = title;

    const input = document.createElement("input");
    input.type = "text";
    input.className = "text-prompt-input";
    if (options.placeholder) input.placeholder = options.placeholder;

    const buttons = document.createElement("div");
    buttons.className = "import-buttons";
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "import-btn";
    cancelBtn.textContent = "Cancel";
    const okBtn = document.createElement("button");
    okBtn.className = "import-btn primary";
    okBtn.textContent = options.confirmLabel ?? "OK";
    buttons.append(cancelBtn, okBtn);

    const close = (value: string | null): void => {
      document.removeEventListener("keydown", onKeydown, true);
      overlay.remove();
      resolve(value);
    };
    cancelBtn.addEventListener("click", () => close(null));
    okBtn.addEventListener("click", () => close(input.value));
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) close(null);
    });
    // Capture phase: the input owns ordinary typing, but Enter/Escape end
    // the dialog before any underlying panel can react. Escape is consumed
    // (preventDefault) so the global Escape fallback stays quiet.
    const onKeydown = (e: KeyboardEvent): void => {
      if (e.key === "Enter") {
        e.preventDefault();
        close(input.value);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close(null);
      }
    };
    document.addEventListener("keydown", onKeydown, true);

    card.append(titleEl, input, buttons);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    input.focus();
  });
}
