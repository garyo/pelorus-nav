/**
 * About dialog — shows app info, author, license, and open-source credits.
 */

import {
  buildDefaultSections,
  collectDiagnostics,
} from "../diagnostics/collectDiagnostics";
import { showBugReportDialog } from "./BugReportDialog";
import { showTermsDialog } from "./DisclaimerDialog";

declare const __APP_VERSION__: string;
declare const __BUILD_ID__: string;
declare const __TIDES_DATA_DATE__: string;

const REPO_URL = "https://github.com/garyo/pelorus-nav";

const CREDITS: { name: string; url: string; desc: string }[] = [
  {
    name: "NOAA ENC",
    url: "https://charts.noaa.gov/ENCs/ENCs.shtml",
    desc: "Nautical chart data",
  },
  {
    name: "OpenStreetMap",
    url: "https://www.openstreetmap.org",
    desc: "Land & road map data",
  },
  {
    name: "MapLibre GL JS",
    url: "https://maplibre.org",
    desc: "Map rendering engine",
  },
  {
    name: "OpenWaters enc-tiles",
    url: "https://github.com/openwatersio/enc-tiles",
    desc: "S-52 chart sprites",
  },
  {
    name: "PMTiles / Protomaps",
    url: "https://protomaps.com/docs/pmtiles",
    desc: "Tile archive format",
  },
  {
    name: "NOAA CO-OPS",
    url: "https://tidesandcurrents.noaa.gov",
    desc: "Tide & current harmonic data",
  },
  {
    name: "Neaps tide-predictor",
    url: "https://github.com/openwatersio/neaps",
    desc: "Harmonic prediction engine (MIT)",
  },
  {
    name: "World Magnetic Model",
    url: "https://www.ncei.noaa.gov/products/world-magnetic-model",
    desc: "Magnetic declination via magvar",
  },
  {
    name: "Noto Fonts",
    url: "https://fonts.google.com/noto",
    desc: "Map label fonts (SIL OFL)",
  },
];

/** Live-navigation hooks for the diagnostics bundle (see DiagnosticsDeps). */
export interface AboutDialogOptions {
  nav?: {
    diagnosticsSnapshot(): string;
    requestDeviceDiag(): Promise<string | null>;
  };
}

export class AboutDialog {
  private readonly overlay: HTMLDivElement;
  private visible = false;

  constructor(options: AboutDialogOptions = {}) {
    this.overlay = document.createElement("div");
    this.overlay.className = "about-overlay";

    const card = document.createElement("div");
    card.className = "about-card";

    // App name + version
    const title = document.createElement("div");
    title.className = "about-title";
    title.textContent = `Pelorus Nav v${__APP_VERSION__}`;

    // Tagline
    const tagline = document.createElement("div");
    tagline.className = "about-tagline";
    tagline.textContent = "Open-source web-based marine chartplotter";

    // Author
    const author = document.createElement("div");
    author.className = "about-author";
    author.textContent = "by Gary Oberbrunner";

    // Safety disclaimer
    const disclaimer = document.createElement("div");
    disclaimer.className = "about-disclaimer";
    disclaimer.textContent =
      "Beta software — not for navigation. Use as a planning and " +
      "situational-awareness aid alongside official charts and proper " +
      "seamanship.";

    // Links row
    const links = document.createElement("div");
    links.className = "about-links";

    // The only in-app path back to the landing page (email signup lives
    // there); native builds have no other route to the website at all.
    const siteLink = document.createElement("a");
    siteLink.href = "https://pelorus-nav.com/";
    siteLink.target = "_blank";
    siteLink.rel = "noopener";
    siteLink.textContent = "Website";

    const ghLink = document.createElement("a");
    ghLink.href = REPO_URL;
    ghLink.target = "_blank";
    ghLink.rel = "noopener";
    ghLink.textContent = "GitHub";

    const releasesLink = document.createElement("a");
    releasesLink.href = `${REPO_URL}/releases`;
    releasesLink.target = "_blank";
    releasesLink.rel = "noopener";
    releasesLink.textContent = "Releases";

    const changelogLink = document.createElement("a");
    changelogLink.href = `${REPO_URL}/blob/main/CHANGELOG.md`;
    changelogLink.target = "_blank";
    changelogLink.rel = "noopener";
    changelogLink.textContent = "Changelog";

    const licenseLink = document.createElement("a");
    licenseLink.href = `${REPO_URL}/blob/main/LICENSE`;
    licenseLink.target = "_blank";
    licenseLink.rel = "noopener";
    licenseLink.textContent = "MIT License";

    // Re-read the agreement accepted at first launch (read-only).
    const termsLink = document.createElement("a");
    termsLink.href = "#";
    termsLink.textContent = "Terms";
    termsLink.addEventListener("click", (e) => {
      e.preventDefault();
      showTermsDialog();
    });

    const privacyLink = document.createElement("a");
    privacyLink.href = "https://pelorus-nav.com/privacy";
    privacyLink.target = "_blank";
    privacyLink.rel = "noopener";
    privacyLink.textContent = "Privacy";

    links.append(
      siteLink,
      ghLink,
      releasesLink,
      changelogLink,
      licenseLink,
      termsLink,
      privacyLink,
    );

    // Credits
    const creditsHeading = document.createElement("div");
    creditsHeading.className = "about-credits-heading";
    creditsHeading.textContent = "Built with";

    const creditsList = document.createElement("ul");
    creditsList.className = "about-credits";
    for (const c of CREDITS) {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = c.url;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = c.name;
      li.append(a, ` — ${c.desc}`);
      creditsList.appendChild(li);
    }

    // Build ID
    const buildId = document.createElement("div");
    buildId.className = "about-build-id";
    buildId.textContent = `Build: ${__BUILD_ID__}`;

    // Tide/current harmonics crawl date — refresh with `bun run tides:build`
    const tidesDate = document.createElement("div");
    tidesDate.className = "about-build-id";
    tidesDate.textContent = `Tide & current data: ${__TIDES_DATA_DATE__}`;

    // Share diagnostics button — one plain-text report (settings, connection
    // log, JS errors, storage state, native diag log) via the share sheet /
    // browser download, so a beta tester can email it to the developer.
    // Bug reports upload description + diagnostics to the server directly
    // (share-as-file is the dialog's offline fallback), so a report arrives
    // with everything needed to debug — no "please send your settings" round
    // trips with beta testers.
    const shareDiagBtn = document.createElement("button");
    shareDiagBtn.className = "about-clear-cache about-share-diag";
    shareDiagBtn.textContent = "Report a Bug…";
    shareDiagBtn.addEventListener("click", () => {
      showBugReportDialog({
        collectDiagnostics: () =>
          collectDiagnostics(
            buildDefaultSections({
              appVersion: __APP_VERSION__,
              buildId: __BUILD_ID__,
              nav: options.nav,
            }),
          ),
      });
    });

    // Clear cache button
    const clearBtn = document.createElement("button");
    clearBtn.className = "about-clear-cache";
    clearBtn.textContent = "Clear Cache & Reload";
    clearBtn.addEventListener("click", async () => {
      clearBtn.textContent = "Clearing...";
      clearBtn.disabled = true;
      try {
        // Unregister service workers
        const regs = await navigator.serviceWorker?.getRegistrations();
        if (regs) {
          for (const r of regs) await r.unregister();
        }
        // Delete all Cache Storage entries
        const keys = await caches.keys();
        for (const k of keys) await caches.delete(k);
      } catch {
        // Cache API may not be available in all contexts
      }
      location.reload();
    });

    card.append(
      title,
      tagline,
      author,
      disclaimer,
      links,
      creditsHeading,
      creditsList,
      buildId,
      tidesDate,
      shareDiagBtn,
      clearBtn,
    );
    this.overlay.appendChild(card);
    document.body.appendChild(this.overlay);

    // Click outside to dismiss
    this.overlay.addEventListener("mousedown", (e) => {
      if (e.target === this.overlay) {
        this.hide();
      }
    });

    // Escape to dismiss
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.visible) {
        e.preventDefault(); // consumed — the global Escape fallback must not also act
        this.hide();
      }
    });
  }

  show(): void {
    if (this.visible) return;
    this.visible = true;
    this.overlay.style.display = "flex";
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.overlay.style.display = "none";
  }

  toggle(): void {
    if (this.visible) {
      this.hide();
    } else {
      this.show();
    }
  }
}
