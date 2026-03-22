/**
 * Search dialog: type-ahead search for named chart features.
 * Displays autocomplete results and flies the map to the selected feature.
 */

import type maplibregl from "maplibre-gl";
import type { SearchEntry } from "../data/search-index";
import { type SearchResult, searchFeatures } from "../search/feature-search";
import { getSettings } from "../settings";

export class SearchDialog {
  private readonly overlay: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private readonly resultsList: HTMLDivElement;
  private readonly statusEl: HTMLDivElement;
  private readonly map: maplibregl.Map;
  private visible = false;
  private entries: SearchEntry[] = [];
  private results: SearchResult[] = [];
  private activeIndex = -1;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private loading = true;

  constructor(map: maplibregl.Map) {
    this.map = map;

    this.overlay = document.createElement("div");
    this.overlay.className = "search-overlay";

    const card = document.createElement("div");
    card.className = "search-card";

    this.input = document.createElement("input");
    this.input.type = "text";
    this.input.className = "search-input";
    this.input.placeholder = "Harbor, island, buoy\u2026";
    this.input.spellcheck = false;
    this.input.autocomplete = "off";

    this.resultsList = document.createElement("div");
    this.resultsList.className = "search-results";

    this.statusEl = document.createElement("div");
    this.statusEl.className = "search-status";
    this.statusEl.textContent = "Loading search index\u2026";

    card.append(this.input, this.resultsList, this.statusEl);
    this.overlay.append(card);
    document.body.appendChild(this.overlay);

    // Debounced search on input
    this.input.addEventListener("input", () => {
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => this.runSearch(), 150);
    });

    // Keyboard navigation
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        this.moveSelection(1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        this.moveSelection(-1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (this.activeIndex >= 0 && this.activeIndex < this.results.length) {
          this.selectResult(this.results[this.activeIndex]);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.hide();
      }
    });

    // Click outside to dismiss
    this.overlay.addEventListener("mousedown", (e) => {
      if (e.target === this.overlay) {
        this.hide();
      }
    });
  }

  /** Set the search entries (call after index loads). */
  setEntries(entries: SearchEntry[]): void {
    this.entries = entries;
    this.loading = false;
    if (this.visible) {
      this.updateStatus();
    }
  }

  show(): void {
    if (this.visible) return;
    this.visible = true;
    this.overlay.style.display = "flex";
    this.input.value = "";
    this.results = [];
    this.activeIndex = -1;
    this.resultsList.innerHTML = "";
    this.updateStatus();
    this.input.focus();
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.overlay.style.display = "none";
  }

  toggle(): void {
    if (this.visible) this.hide();
    else this.show();
  }

  private updateStatus(): void {
    if (this.loading) {
      this.statusEl.textContent = "Loading search index\u2026";
    } else if (this.input.value.trim().length < 2) {
      this.statusEl.textContent = "Type 2+ characters to search";
    } else if (this.results.length === 0) {
      this.statusEl.textContent = "No results found";
    } else {
      this.statusEl.textContent = "";
    }
  }

  private runSearch(): void {
    const query = this.input.value;

    if (query.trim().length < 2) {
      this.results = [];
      this.activeIndex = -1;
      this.resultsList.innerHTML = "";
      this.updateStatus();
      return;
    }

    // Get current viewport for proximity boost
    const bounds = this.map.getBounds();
    const center = this.map.getCenter();

    this.results = searchFeatures(query, this.entries, {
      referencePoint: [center.lng, center.lat],
      viewportBounds: [
        bounds.getWest(),
        bounds.getSouth(),
        bounds.getEast(),
        bounds.getNorth(),
      ],
    });

    this.activeIndex = this.results.length > 0 ? 0 : -1;
    this.renderResults(query);
    this.updateStatus();
  }

  private renderResults(query: string): void {
    this.resultsList.innerHTML = "";
    const queryLower = query.trim().toLowerCase();

    for (let i = 0; i < this.results.length; i++) {
      const result = this.results[i];
      const item = document.createElement("div");
      item.className = "search-result-item";
      if (i === this.activeIndex) item.classList.add("active");

      const nameSpan = document.createElement("span");
      nameSpan.className = "search-result-name";
      nameSpan.innerHTML = this.highlightMatch(result.entry.name, queryLower);

      const metaSpan = document.createElement("span");
      metaSpan.className = "search-result-meta";

      const typeSpan = document.createElement("span");
      typeSpan.className = "search-result-type";
      typeSpan.textContent = result.typeLabel;
      metaSpan.appendChild(typeSpan);

      if (result.distanceNM !== undefined) {
        const distSpan = document.createElement("span");
        distSpan.className = "search-result-dist";
        distSpan.textContent = this.formatDistance(result.distanceNM);
        metaSpan.appendChild(distSpan);
      }

      item.append(nameSpan, metaSpan);

      item.addEventListener("mousedown", (e) => {
        e.preventDefault(); // prevent blur
        this.selectResult(result);
      });

      item.addEventListener("mouseenter", () => {
        this.activeIndex = i;
        this.updateActiveHighlight();
      });

      this.resultsList.appendChild(item);
    }
  }

  /** Bold the matching portion of the name. */
  private highlightMatch(name: string, queryLower: string): string {
    const nameLower = name.toLowerCase();
    const idx = nameLower.indexOf(queryLower);
    if (idx === -1) return this.escapeHtml(name);

    const before = name.slice(0, idx);
    const match = name.slice(idx, idx + queryLower.length);
    const after = name.slice(idx + queryLower.length);
    return `${this.escapeHtml(before)}<b>${this.escapeHtml(match)}</b>${this.escapeHtml(after)}`;
  }

  private escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  private formatDistance(nm: number): string {
    const unit = getSettings().speedUnit;
    if (unit === "kph") {
      const km = nm * 1.852;
      if (km < 1) return `${Math.round(km * 1000)} m`;
      if (km < 100) return `${km.toFixed(1)} km`;
      return `${km.toFixed(0)} km`;
    }
    if (unit === "mph") {
      const mi = nm * 1.15078;
      if (mi < 0.5) return `${Math.round(mi * 5280)} ft`;
      if (mi < 100) return `${mi.toFixed(1)} mi`;
      return `${mi.toFixed(0)} mi`;
    }
    // knots → nautical miles
    if (nm < 0.5) {
      const meters = nm * 1852;
      return `${Math.round(meters)} m`;
    }
    if (nm < 100) return `${nm.toFixed(1)} nm`;
    return `${nm.toFixed(0)} nm`;
  }

  private moveSelection(delta: number): void {
    if (this.results.length === 0) return;
    this.activeIndex = Math.max(
      0,
      Math.min(this.results.length - 1, this.activeIndex + delta),
    );
    this.updateActiveHighlight();
    // Scroll into view
    const items = this.resultsList.children;
    if (items[this.activeIndex]) {
      (items[this.activeIndex] as HTMLElement).scrollIntoView({
        block: "nearest",
      });
    }
  }

  private updateActiveHighlight(): void {
    const items = this.resultsList.children;
    for (let i = 0; i < items.length; i++) {
      items[i].classList.toggle("active", i === this.activeIndex);
    }
  }

  private selectResult(result: SearchResult): void {
    const entry = result.entry;
    if (entry.bbox) {
      this.map.fitBounds(
        [
          [entry.bbox[0], entry.bbox[1]],
          [entry.bbox[2], entry.bbox[3]],
        ],
        { padding: 60, maxZoom: 15 },
      );
    } else {
      this.map.flyTo({
        center: entry.center,
        zoom: Math.max(this.map.getZoom(), 14),
      });
    }
    this.hide();
  }
}
