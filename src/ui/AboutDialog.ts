/**
 * About dialog — shows app info, author, license, and open-source credits.
 */

declare const __APP_VERSION__: string;
declare const __BUILD_ID__: string;

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
    name: "World Magnetic Model",
    url: "https://www.ncei.noaa.gov/products/world-magnetic-model",
    desc: "Magnetic declination via magvar",
  },
  {
    name: "OpenMapTiles",
    url: "https://openmaptiles.org",
    desc: "Map label fonts",
  },
];

export class AboutDialog {
  private readonly overlay: HTMLDivElement;
  private visible = false;

  constructor() {
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

    // Links row
    const links = document.createElement("div");
    links.className = "about-links";

    const ghLink = document.createElement("a");
    ghLink.href = REPO_URL;
    ghLink.target = "_blank";
    ghLink.rel = "noopener";
    ghLink.textContent = "GitHub";

    const licenseLink = document.createElement("a");
    licenseLink.href = `${REPO_URL}/blob/main/LICENSE`;
    licenseLink.target = "_blank";
    licenseLink.rel = "noopener";
    licenseLink.textContent = "MIT License";

    links.append(ghLink, licenseLink);

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

    card.append(
      title,
      tagline,
      author,
      links,
      creditsHeading,
      creditsList,
      buildId,
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
