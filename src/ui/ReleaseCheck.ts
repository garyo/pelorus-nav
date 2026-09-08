/**
 * Startup check for a newer app release — native builds only.
 *
 * The web PWA updates itself through its service worker (AppUpdateNotifier);
 * an installed Android or iOS build has no such channel, so each launch asks
 * GitHub for the latest release and, when it is newer than the running
 * version, offers the Play Store listing (Android) or the release notes
 * (iOS). "Check for updates at startup" in the
 * About dialog turns this off. One check per launch: a "Later" is honoured
 * until the next start.
 */

import { Capacitor } from "@capacitor/core";
import { logUiAction } from "../diagnostics/uiActionLog";
import { isNewerVersion } from "../utils/version";
import { showUpdateNotice } from "./updateNotice";

const LATEST_RELEASE_URL =
  "https://api.github.com/repos/garyo/pelorus-nav/releases/latest";
/** The Play Store listing (private beta: visible to enrolled testers). */
const PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=nav.pelorus.app";

export interface ReleaseInfo {
  version: string;
  url: string;
}

/**
 * The latest published release when it is newer than `currentVersion`, else
 * null. Network or parse failures are null too — a missed check is never
 * worth a startup error.
 */
export async function fetchNewerRelease(
  currentVersion: string,
  fetchFn: typeof fetch = fetch,
): Promise<ReleaseInfo | null> {
  try {
    const resp = await fetchFn(LATEST_RELEASE_URL, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!resp.ok) return null;
    const body: unknown = await resp.json();
    if (typeof body !== "object" || body === null) return null;
    const { tag_name: tag, html_url: url } = body as Record<string, unknown>;
    if (typeof tag !== "string" || typeof url !== "string") return null;
    const version = tag.replace(/^v/, "");
    return isNewerVersion(version, currentVersion) ? { version, url } : null;
  } catch {
    return null;
  }
}

export interface ReleaseCheckOptions {
  currentVersion: string;
  /** Read at check time — the user's "Check for updates at startup" setting. */
  enabled: () => boolean;
}

export function startReleaseCheck(opts: ReleaseCheckOptions): void {
  if (!Capacitor.isNativePlatform()) return;
  if (!opts.enabled() || !navigator.onLine) return;

  fetchNewerRelease(opts.currentVersion).then((release) => {
    if (!release) return;
    logUiAction(`release check: v${release.version} available`);
    // Android updates come from the Play Store (the release's APK is for
    // sideloading only); TestFlight delivers iOS builds itself, so there
    // the release page is just the notes.
    const android = Capacitor.getPlatform() === "android";
    showUpdateNotice({
      id: "app-release-notice",
      message: `Pelorus Nav v${release.version} is available`,
      actionLabel: android ? "Open Play Store" : "Release notes",
      onAction: () => openExternal(android ? PLAY_STORE_URL : release.url),
    });
  });
}

/** Open a URL in the system browser — the way the About dialog's links do. */
function openExternal(url: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener";
  a.click();
}
