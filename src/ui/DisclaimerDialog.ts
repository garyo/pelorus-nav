/**
 * One-time, blocking navigation-liability disclaimer. `maybeShowDisclaimer()`
 * is awaited very early in main.ts, before any chart/GPS setup — the app has
 * nothing on screen until the user taps "I Agree".
 *
 * DISCLAIMER_VERSION is independent of the app's package.json version. Bump
 * it (and the text in `buildAgreementBody`) whenever the legal text changes
 * or a chart data source changes in a way that warrants re-acknowledgment —
 * that forces every user to re-accept on their next launch, regardless of
 * whether the app version itself changed.
 */

import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import {
  createJsonStorageSlot,
  defaultBrowserStorage,
} from "../utils/json-storage-slot";

declare const __APP_VERSION__: string;

export const DISCLAIMER_VERSION = 1;

interface DisclaimerAcceptance {
  disclaimerVersion: number;
  acceptedAt: number;
  appVersion: string;
}

function isDisclaimerAcceptance(v: unknown): v is DisclaimerAcceptance {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.disclaimerVersion === "number" &&
    typeof r.acceptedAt === "number" &&
    typeof r.appVersion === "string"
  );
}

const slot = createJsonStorageSlot<DisclaimerAcceptance>(
  "pelorus-nav-disclaimer-acceptance",
  isDisclaimerAcceptance,
);

/**
 * The stored acceptance record, but only if it's for the *current*
 * disclaimer version — a record from an older version means re-acceptance
 * is required, so callers should treat that as "not accepted".
 */
export function getDisclaimerAcceptance(): DisclaimerAcceptance | null {
  const record = slot.load(defaultBrowserStorage());
  return record?.disclaimerVersion === DISCLAIMER_VERSION ? record : null;
}

function recordAcceptance(): void {
  slot.save(
    {
      disclaimerVersion: DISCLAIMER_VERSION,
      acceptedAt: Date.now(),
      appVersion: __APP_VERSION__,
    },
    defaultBrowserStorage(),
  );
}

function buildAgreementBody(): HTMLDivElement {
  const body = document.createElement("div");
  body.className = "disclaimer-body";
  body.innerHTML = `
    <p>This app is a navigational aid only. It is not a substitute for
    official nautical charts, prudent seamanship, or your own judgment.
    Chart data, GPS positioning, depth soundings, and other displayed
    information may be inaccurate, outdated, or incomplete, and the app
    itself may contain errors or malfunctions.</p>
    <p>By tapping "I Agree," you acknowledge and agree that:</p>
    <ul>
      <li>You are solely responsible for the safe navigation of your vessel
      and for complying with all applicable navigation rules and
      regulations.</li>
      <li>You will not rely on this app as your sole means of navigation,
      and will maintain official charts and other required aids to
      navigation.</li>
      <li>This app is provided "as is," with no warranty of any kind —
      express or implied — including accuracy, reliability, or fitness for
      a particular purpose.</li>
      <li>To the fullest extent permitted by law, the developer is not
      liable for any injury, death, property damage, or other loss —
      including grounding, collision, or other marine casualty — arising
      from use of, or inability to use, this app, whether caused by
      inaccurate data, software defects, or otherwise.</li>
      <li>You release and agree not to sue the developer for claims
      arising from your use of the app.</li>
    </ul>
    <p><b>If you do not agree, do not use this app.</b></p>
  `;
  return body;
}

/** Show the blocking dialog. Resolves only once the user taps "I Agree". */
function showDisclaimerDialog(): Promise<void> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "about-overlay disclaimer-overlay";
    overlay.style.display = "flex";

    const card = document.createElement("div");
    card.className = "about-card disclaimer-card";
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const renderAgreement = (): void => {
      card.replaceChildren();

      const title = document.createElement("div");
      title.className = "about-title";
      title.textContent = "Navigation Disclaimer & Terms of Use";

      const buttons = document.createElement("div");
      buttons.className = "disclaimer-buttons";

      const declineBtn = document.createElement("button");
      declineBtn.className = "screen-timeout-btn";
      declineBtn.textContent = "Decline";
      declineBtn.addEventListener("click", renderDeclined);

      const agreeBtn = document.createElement("button");
      agreeBtn.className = "screen-timeout-btn primary";
      agreeBtn.textContent = "I Agree";
      agreeBtn.addEventListener("click", () => {
        recordAcceptance();
        overlay.remove();
        resolve();
      });

      buttons.append(declineBtn, agreeBtn);
      card.append(title, buildAgreementBody(), buttons);
    };

    const renderDeclined = (): void => {
      card.replaceChildren();

      const title = document.createElement("div");
      title.className = "about-title";
      title.textContent = "Agreement required";

      const body = document.createElement("div");
      body.className = "disclaimer-body";
      body.textContent =
        "Pelorus Nav can't be used without accepting the navigation " +
        "disclaimer.";

      const buttons = document.createElement("div");
      buttons.className = "disclaimer-buttons";

      const reviewBtn = document.createElement("button");
      reviewBtn.className = "screen-timeout-btn primary";
      reviewBtn.textContent = "Review Again";
      reviewBtn.addEventListener("click", renderAgreement);
      buttons.appendChild(reviewBtn);

      // App.exitApp() is Android-only (unimplemented on iOS/web, and Apple
      // guidelines disallow apps quitting themselves) — only offer it there.
      if (Capacitor.getPlatform() === "android") {
        const exitBtn = document.createElement("button");
        exitBtn.className = "screen-timeout-btn";
        exitBtn.textContent = "Exit App";
        exitBtn.addEventListener("click", () => {
          App.exitApp();
        });
        buttons.appendChild(exitBtn);
      }

      card.append(title, body, buttons);
    };

    renderAgreement();
  });
}

/**
 * Show the disclaimer once, blocking until the user agrees. No-op if the
 * user already accepted the currently-running disclaimer version.
 */
export async function maybeShowDisclaimer(): Promise<void> {
  if (getDisclaimerAcceptance()) return;
  await showDisclaimerDialog();
}
