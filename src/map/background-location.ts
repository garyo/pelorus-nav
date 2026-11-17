/**
 * Android's "Allow all the time" location. The native service records and
 * watches the anchor while the app is in the background, but if the system
 * kills the app, a location service may only restart in the background with
 * this permission; without it the restart is refused and nothing records
 * until the app is opened again. Offered once, with the disclosure Google
 * Play requires, when the user starts a recording from the device's GPS or
 * arms an anchor watch; offered again from the interruption notice.
 */

import { Capacitor } from "@capacitor/core";
import { BackgroundGPS } from "../plugins/BackgroundGPS";

const ASKED_KEY = "pelorus-nav-background-location-asked";

function wasAsked(): boolean {
  try {
    return localStorage.getItem(ASKED_KEY) !== null;
  } catch {
    return false;
  }
}

function markAsked(): void {
  try {
    localStorage.setItem(ASKED_KEY, "1");
  } catch {
    // Unavailable storage: the offer may come back, which is harmless.
  }
}

/** Granted, or null when the native side can't say (not Android). */
async function backgroundLocationGranted(): Promise<boolean | null> {
  if (Capacitor.getPlatform() !== "android") return null;
  try {
    return (await BackgroundGPS.getBackgroundInfo()).backgroundLocation;
  } catch {
    return null;
  }
}

/**
 * Offer it when it is known not to be granted (null: unknown, as off
 * Android), and unless `again`, only if never offered before.
 */
export function shouldOfferBackgroundLocation(opts: {
  granted: boolean | null;
  asked: boolean;
  again: boolean;
}): boolean {
  return opts.granted === false && (opts.again || !opts.asked);
}

/**
 * Explain background location and, on Continue, ask for it (see
 * shouldOfferBackgroundLocation). Resolves whether the explanation was
 * shown.
 */
export async function offerBackgroundLocation(
  opts: { again?: boolean } = {},
): Promise<boolean> {
  const again = opts.again ?? false;
  if (!again && wasAsked()) return false;
  const granted = await backgroundLocationGranted();
  if (!shouldOfferBackgroundLocation({ granted, asked: wasAsked(), again })) {
    return false;
  }
  markAsked();
  if (await showDisclosure()) {
    await BackgroundGPS.requestBackgroundLocation().catch(console.error);
  }
  return true;
}

/** The disclosure; resolves true on Continue. */
function showDisclosure(): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "about-overlay";
    overlay.style.display = "flex";

    const card = document.createElement("div");
    card.className = "about-card screen-timeout-card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-labelledby", "bg-location-title");

    const title = document.createElement("div");
    title.className = "about-title";
    title.id = "bg-location-title";
    title.textContent = "Location in the background";

    const body = document.createElement("div");
    body.className = "screen-timeout-body";
    body.innerHTML =
      "Pelorus Nav collects your location in the background, even when the " +
      "app is closed or not in use, to keep recording your track and " +
      "watching your anchor if Android stops the app to free memory. Your " +
      "location is stored on this device and used only for the chart, " +
      "tracks, navigation and the anchor alarm.<br><br>" +
      "To allow it, choose <b>Allow all the time</b> on the next screen.";

    const buttons = document.createElement("div");
    buttons.className = "screen-timeout-buttons";
    const close = (accepted: boolean) => {
      overlay.remove();
      resolve(accepted);
    };
    const continueBtn = document.createElement("button");
    continueBtn.className = "screen-timeout-btn primary";
    continueBtn.textContent = "Continue";
    continueBtn.addEventListener("click", () => close(true));
    const notNowBtn = document.createElement("button");
    notNowBtn.className = "screen-timeout-btn";
    notNowBtn.textContent = "Not now";
    notNowBtn.addEventListener("click", () => close(false));
    buttons.append(continueBtn, notNowBtn);

    card.append(title, body, buttons);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    continueBtn.focus();
  });
}
