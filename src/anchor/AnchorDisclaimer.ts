/**
 * One-time, blocking anchor-watch disclaimer. Shown the first time the user
 * enters anchor mode, before the setup card can be used: the anchor alarm is
 * a safety feature with real failure modes (dead receiver, dead battery, a
 * device the OS decides to kill), and nobody should sleep on it believing it
 * is infallible. Acknowledging persists; declining leaves anchor mode.
 *
 * ANCHOR_DISCLAIMER_VERSION is independent of the app version — bump it when
 * the warning text materially changes and every user re-acknowledges on
 * their next visit to anchor mode. Same pattern as DisclaimerDialog.ts.
 */

import type { StorageLike } from "../utils/json-storage-slot";
import {
  createJsonStorageSlot,
  defaultBrowserStorage,
} from "../utils/json-storage-slot";

declare const __APP_VERSION__: string;

export const ANCHOR_DISCLAIMER_VERSION = 1;

interface AnchorDisclaimerAcceptance {
  version: number;
  acceptedAt: number;
  appVersion: string;
}

function isAcceptance(v: unknown): v is AnchorDisclaimerAcceptance {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.version === "number" &&
    typeof r.acceptedAt === "number" &&
    typeof r.appVersion === "string"
  );
}

export const ANCHOR_DISCLAIMER_STORAGE_KEY = "pelorus-nav-anchor-disclaimer";

const slot = createJsonStorageSlot<AnchorDisclaimerAcceptance>(
  ANCHOR_DISCLAIMER_STORAGE_KEY,
  isAcceptance,
);

/** Whether the current disclaimer version has been acknowledged. */
export function isAnchorDisclaimerAcknowledged(
  storage: StorageLike | null = defaultBrowserStorage(),
): boolean {
  return slot.load(storage)?.version === ANCHOR_DISCLAIMER_VERSION;
}

/** Record acknowledgment of the current disclaimer version. */
export function recordAnchorDisclaimerAcknowledged(
  storage: StorageLike | null = defaultBrowserStorage(),
  now: () => number = Date.now,
): void {
  slot.save(
    {
      version: ANCHOR_DISCLAIMER_VERSION,
      acceptedAt: now(),
      appVersion: __APP_VERSION__,
    },
    storage,
  );
}

/**
 * Show the blocking disclaimer unless already acknowledged. "I Understand"
 * records and dismisses; "Not Now" (or Escape) calls `onDecline` — the
 * caller leaves anchor mode. There is no outside-tap dismissal: the point
 * is a deliberate choice, not a stray touch.
 */
export function maybeShowAnchorDisclaimer(onDecline: () => void): void {
  if (isAnchorDisclaimerAcknowledged()) return;

  const overlay = document.createElement("div");
  overlay.className = "about-overlay disclaimer-overlay anchor-disclaimer";
  overlay.style.display = "flex";

  const card = document.createElement("div");
  card.className = "about-card disclaimer-card";

  const title = document.createElement("div");
  title.className = "about-title";
  title.textContent = "Anchor Watch Warning";

  const body = document.createElement("div");
  body.className = "disclaimer-body";
  const lines = [
    "This feature is experimental.",
    "Check your anchor manually and use more than one drag alarm.",
    "Battery, GPS or other failures could cause incorrect results.",
  ];
  for (const line of lines) {
    const p = document.createElement("p");
    p.textContent = line;
    body.appendChild(p);
  }
  const emphatic = document.createElement("p");
  const strong = document.createElement("strong");
  strong.textContent = "Do not rely solely on this feature!";
  emphatic.appendChild(strong);
  body.appendChild(emphatic);

  const buttons = document.createElement("div");
  buttons.className = "disclaimer-buttons";

  const close = (): void => {
    document.removeEventListener("keydown", onKeydown);
    overlay.remove();
  };
  const onKeydown = (e: KeyboardEvent): void => {
    if (e.key !== "Escape") return;
    e.preventDefault(); // consumed — the global Escape fallback must not act
    close();
    onDecline();
  };

  const declineBtn = document.createElement("button");
  declineBtn.className = "screen-timeout-btn";
  declineBtn.textContent = "Not Now";
  declineBtn.addEventListener("click", () => {
    close();
    onDecline();
  });

  const okBtn = document.createElement("button");
  okBtn.className = "screen-timeout-btn primary";
  okBtn.textContent = "I Understand";
  okBtn.addEventListener("click", () => {
    recordAnchorDisclaimerAcknowledged();
    close();
  });

  buttons.append(declineBtn, okBtn);
  card.append(title, body, buttons);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  document.addEventListener("keydown", onKeydown);
}
