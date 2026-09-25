/**
 * Startup check for a newer app release — sideloaded Android APKs only.
 *
 * The web PWA updates itself through its service worker (AppUpdateNotifier),
 * and store installs (Play Store, TestFlight/App Store) update through the
 * store, which alone knows when a build has cleared review — a GitHub tag
 * precedes that by hours or days. A sideloaded APK has no such channel, so
 * each launch asks GitHub for the latest release and, when it is newer than
 * the running version, offers the release page (which carries the APK).
 * "Check for updates at startup" in the About dialog turns this off. One
 * check per launch: a "Later" is honoured until the next start.
 */

import { Capacitor } from "@capacitor/core";
import { logUiAction } from "../diagnostics/uiActionLog";
import { InstallSource } from "../plugins/InstallSource";
import { isNewerVersion } from "../utils/version";
import { showUpdateNotice } from "./updateNotice";

const LATEST_RELEASE_URL =
  "https://api.github.com/repos/garyo/pelorus-nav/releases/latest";
const PLAY_STORE_INSTALLER = "com.android.vending";

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

let sideloaded: Promise<boolean> | undefined;

/**
 * Whether this is an Android build installed from somewhere other than the
 * Play Store — the only kind that takes its updates from GitHub releases.
 * False if the installer can't be read: better no notice than a wrong one.
 */
export function isSideloadedAndroid(): Promise<boolean> {
  sideloaded ??=
    Capacitor.getPlatform() === "android"
      ? InstallSource.getInstaller().then(
          ({ installer }) => installer !== PLAY_STORE_INSTALLER,
          () => false,
        )
      : Promise.resolve(false);
  return sideloaded;
}

export async function startReleaseCheck(
  opts: ReleaseCheckOptions,
): Promise<void> {
  if (!opts.enabled() || !navigator.onLine) return;
  if (!(await isSideloadedAndroid())) return;

  const release = await fetchNewerRelease(opts.currentVersion);
  if (!release) return;
  logUiAction(`release check: v${release.version} available`);
  showUpdateNotice({
    id: "app-release-notice",
    message: `Pelorus Nav v${release.version} is available`,
    actionLabel: "Get update",
    onAction: () => openExternal(release.url),
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
