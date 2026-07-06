/**
 * Confirm dialog shown when something tries to cancel navigation while it is
 * targeting the active COB point (cancel-nav button, Escape). Ending a
 * crew-overboard emergency must never be a single accidental tap, so the
 * "End COB" choice requires its own press-and-hold.
 */

import { getSettings } from "../settings";
import { attachHoldGesture } from "./hold-gesture";

export type CobNavGuardChoice = "keep" | "stop-nav" | "end-cob";

const HOLD_MS = 1500;

/**
 * Show the guard dialog. Resolves with the user's choice; Escape or a click
 * outside the card resolves "keep" (the safe default). The dialog consumes
 * its own Escape via preventDefault so the global nav-cancel fallback stays
 * quiet.
 */
export function confirmEndCobNavigation(): Promise<CobNavGuardChoice> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "goto-overlay cob-guard-overlay";
    overlay.style.display = "flex";

    const card = document.createElement("div");
    card.className = "goto-card cob-guard-card";

    const title = document.createElement("div");
    title.className = "cob-guard-title";
    title.textContent = "Crew overboard is active";

    const text = document.createElement("div");
    text.className = "cob-guard-text";
    text.textContent =
      "Navigation is guiding you back to the COB point. What do you want to do?";

    const keepBtn = document.createElement("button");
    keepBtn.type = "button";
    keepBtn.className = "goto-btn goto-btn-go cob-guard-keep";
    keepBtn.textContent = "Keep navigating to COB";

    const stopNavBtn = document.createElement("button");
    stopNavBtn.type = "button";
    stopNavBtn.className = "goto-btn";
    stopNavBtn.textContent = "Stop navigation (keep COB timer + alarm)";

    const endBtn = document.createElement("button");
    endBtn.type = "button";
    endBtn.className = "goto-btn cob-guard-end";
    const endProgress = document.createElement("span");
    endProgress.className = "cob-resolve-progress";
    const endLabel = document.createElement("span");
    endLabel.textContent = "End COB emergency — hold";
    endBtn.append(endProgress, endLabel);

    let detachHold: (() => void) | null = null;
    let cleanupKeys: (() => void) | null = null;

    const finish = (choice: CobNavGuardChoice): void => {
      detachHold?.();
      cleanupKeys?.();
      overlay.remove();
      resolve(choice);
    };

    keepBtn.addEventListener("click", () => finish("keep"));
    stopNavBtn.addEventListener("click", () => finish("stop-nav"));
    detachHold = attachHoldGesture(endBtn, {
      holdMs: HOLD_MS,
      stepped: () => getSettings().displayTheme === "eink",
      onProgress: (frac) => {
        endProgress.style.width = `${frac * 100}%`;
      },
      onComplete: () => finish("end-cob"),
      onCancel: () => {
        endProgress.style.width = "0%";
      },
    });

    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) finish("keep");
    });

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      e.preventDefault(); // consume so the global Escape fallback stays quiet
      finish("keep");
    };
    document.addEventListener("keydown", onKeyDown);
    cleanupKeys = () => document.removeEventListener("keydown", onKeyDown);

    card.append(title, text, keepBtn, stopNavBtn, endBtn);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    keepBtn.focus();
  });
}
