/**
 * Ask the browser to protect this origin's storage from eviction: charts
 * (OPFS) and routes, tracks and waypoints (IndexedDB) otherwise live in a
 * best-effort bucket the browser may silently clear under storage pressure.
 *
 * Asked only once there is something to keep, and never in the middle of
 * creating it: when the user downloads or imports charts, or at launch once an
 * earlier session has saved routes, tracks or waypoints. Chromium and Safari
 * decide silently; Firefox shows a prompt, so a toast explains it whenever the
 * answer doesn't come straight back.
 *
 * Capacitor apps keep their storage regardless, and never ask.
 */

import { Capacitor } from "@capacitor/core";
import { hasSavedNavData } from "../data/db";
import { listStoredCharts } from "../data/tile-store";
import { showToast } from "./Toast";

/** A browser that answers within this long decided without asking the user. */
const PROMPT_DETECT_MS = 400;

export const PERSIST_PROMPT_MESSAGE =
  "Allow your browser to keep Pelorus Nav's data, so your charts and routes aren't cleared when space runs low.";

let requested = false;

function supported(): boolean {
  return !Capacitor.isNativePlatform() && !!navigator.storage?.persist;
}

/** At launch: request persistent storage if earlier sessions saved anything. */
export async function requestPersistentStorageOnLaunch(): Promise<void> {
  if (!supported()) return;
  try {
    const saved =
      (await hasSavedNavData()) || (await listStoredCharts()).length > 0;
    if (saved) await requestPersistentStorage();
  } catch (err) {
    console.warn("Saved-data check failed:", err);
  }
}

/** Request persistent storage, at most once per session. */
export async function requestPersistentStorage(): Promise<void> {
  if (requested || !supported()) return;
  requested = true;
  try {
    if (await navigator.storage.persisted()) return;
    const prompting = setTimeout(
      () => showToast({ message: PERSIST_PROMPT_MESSAGE }),
      PROMPT_DETECT_MS,
    );
    const granted = await navigator.storage
      .persist()
      .finally(() => clearTimeout(prompting));
    if (!granted) console.log("Persistent storage not granted (best-effort)");
  } catch (err) {
    console.warn("Persistent storage request failed:", err);
  }
}
