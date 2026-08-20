/**
 * Confirm dialog for stopping ordinary (non-COB) active navigation. The
 * floating cancel-nav button sits right where fingers land while handling
 * the chart underway, so a single stray tap must not silently end
 * guidance. Escape or a tap outside resolves "keep" (the safe default) and
 * consumes the event so the global Escape nav-cancel fallback stays quiet.
 * COB navigation has its own stricter guard (src/cob/CobNavGuard.ts).
 */

export function confirmStopNavigation(): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "goto-overlay";
    overlay.style.display = "flex";

    const card = document.createElement("div");
    card.className = "goto-card";

    const title = document.createElement("div");
    title.className = "about-title";
    title.textContent = "Stop navigation?";

    const text = document.createElement("div");
    text.className = "goto-hint";
    text.textContent = "This ends the current navigation guidance.";

    const keepBtn = document.createElement("button");
    keepBtn.type = "button";
    keepBtn.className = "goto-btn goto-btn-go";
    keepBtn.textContent = "Keep navigating";

    const stopBtn = document.createElement("button");
    stopBtn.type = "button";
    stopBtn.className = "goto-btn";
    stopBtn.textContent = "Stop navigation";

    let cleanupKeys: (() => void) | null = null;
    const finish = (stop: boolean): void => {
      cleanupKeys?.();
      overlay.remove();
      resolve(stop);
    };

    keepBtn.addEventListener("click", () => finish(false));
    stopBtn.addEventListener("click", () => finish(true));
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) finish(false);
    });

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      e.preventDefault(); // consume so the global Escape fallback stays quiet
      finish(false);
    };
    document.addEventListener("keydown", onKeyDown);
    cleanupKeys = () => document.removeEventListener("keydown", onKeyDown);

    card.append(title, text, keepBtn, stopBtn);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    keepBtn.focus();
  });
}
