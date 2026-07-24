/**
 * "What's New" dialog — shows the running version's changelog highlights once
 * after an app update, with a link to the full changelog on GitHub. The notes
 * come straight from CHANGELOG.md (inlined at build time), so there's a single
 * source of truth.
 */

import changelogRaw from "../../CHANGELOG.md?raw";
import {
  type ChangelogSection,
  parseChangelogSection,
} from "./changelog-parse";

declare const __APP_VERSION__: string;

const REPO_URL = "https://github.com/garyo/pelorus-nav";
const CHANGELOG_URL = `${REPO_URL}/blob/main/CHANGELOG.md`;

/** Last version whose notes we showed — so each release's notes appear once. */
const SEEN_VERSION_KEY = "pelorus-nav-last-seen-version";
/**
 * Settings blob key. Its presence means the app has been used before —
 * `load()` only writes settings on first change or a migration, never on a
 * fresh load — so we can skip the notes on a brand-new install (nothing is
 * "new" to a first-time user).
 */
const SETTINGS_KEY = "pelorus-nav-settings";

function readSeenVersion(): string | null {
  try {
    return localStorage.getItem(SEEN_VERSION_KEY);
  } catch {
    return null;
  }
}

function markSeen(version: string): void {
  try {
    localStorage.setItem(SEEN_VERSION_KEY, version);
  } catch {
    // localStorage unavailable — we may re-show next launch; harmless.
  }
}

function isFreshInstall(): boolean {
  try {
    return localStorage.getItem(SETTINGS_KEY) === null;
  } catch {
    return false;
  }
}

class WhatsNewDialog {
  private readonly overlay: HTMLDivElement;

  constructor(section: ChangelogSection) {
    this.overlay = document.createElement("div");
    this.overlay.className = "about-overlay whatsnew-overlay";

    const card = document.createElement("div");
    card.className = "about-card whatsnew-card";

    const title = document.createElement("div");
    title.className = "about-title";
    title.textContent = "What's New";

    const sub = document.createElement("div");
    sub.className = "about-tagline";
    sub.textContent = section.date
      ? `Version ${section.version} · ${section.date}`
      : `Version ${section.version}`;

    card.append(title, sub);

    for (const para of section.preamble) {
      const p = document.createElement("p");
      p.className = "whatsnew-preamble";
      p.textContent = para;
      card.appendChild(p);
    }

    for (const group of section.groups) {
      if (group.title) {
        const h = document.createElement("div");
        h.className = "about-credits-heading";
        h.textContent = group.title;
        card.appendChild(h);
      }
      const ul = document.createElement("ul");
      ul.className = "whatsnew-list";
      for (const item of group.items) {
        const li = document.createElement("li");
        li.textContent = item;
        ul.appendChild(li);
      }
      card.appendChild(ul);
    }

    const links = document.createElement("div");
    links.className = "about-links whatsnew-links";
    const full = document.createElement("a");
    full.href = CHANGELOG_URL;
    full.target = "_blank";
    full.rel = "noopener";
    full.textContent = "Full changelog →";
    links.appendChild(full);
    card.appendChild(links);

    const close = document.createElement("button");
    close.className = "about-clear-cache whatsnew-close";
    close.textContent = "Got it";
    close.addEventListener("click", () => this.close());
    card.appendChild(close);

    this.overlay.appendChild(card);
    this.overlay.addEventListener("mousedown", (e) => {
      if (e.target === this.overlay) this.close();
    });
    document.addEventListener("keydown", this.onKeydown);
  }

  private readonly onKeydown = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.preventDefault(); // consumed — the global Escape fallback must not also act
      this.close();
    }
  };

  show(): void {
    document.body.appendChild(this.overlay);
    this.overlay.style.display = "flex";
  }

  private close(): void {
    document.removeEventListener("keydown", this.onKeydown);
    this.overlay.remove();
  }
}

/**
 * Show the What's New dialog once per new version. No-op when the user has
 * already seen this version, on a fresh install (nothing is new yet), or when
 * the changelog has no entry for the running version.
 */
export function maybeShowWhatsNew(): void {
  const current = __APP_VERSION__;
  if (readSeenVersion() === current) return;

  const fresh = readSeenVersion() === null && isFreshInstall();
  // Record before rendering so a parse/render hiccup can't reshow next launch.
  markSeen(current);
  if (fresh) return;

  const section = parseChangelogSection(changelogRaw, current);
  if (!section) return;

  new WhatsNewDialog(section).show();
}
