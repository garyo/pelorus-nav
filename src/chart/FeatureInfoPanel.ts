import { iconChevronDown, iconChevronUp, iconX, setIcon } from "../ui/icons";
import type { FeatureInfo } from "./feature-info";

/**
 * Floating panel that displays feature attribute information.
 * Positioned at the bottom of the map viewport.
 */
export class FeatureInfoPanel {
  private readonly panel: HTMLElement;
  private readonly titleSpan: HTMLElement;
  private readonly closeBtn: HTMLButtonElement;
  private readonly body: HTMLElement;
  private readonly footer: HTMLElement;
  private readonly prevBtn: HTMLButtonElement;
  private readonly nextBtn: HTMLButtonElement;
  private readonly footerLabel: HTMLSpanElement;

  onCycleNext?: () => void;
  onCyclePrev?: () => void;
  onClose?: () => void;

  constructor(container: HTMLElement) {
    this.panel = document.createElement("div");
    this.panel.className = "feature-info-panel";

    // Header
    const header = document.createElement("div");
    header.className = "feature-info-header";

    this.titleSpan = document.createElement("span");
    this.titleSpan.className = "feature-info-title";

    this.closeBtn = document.createElement("button");
    this.closeBtn.className = "feature-info-close";
    setIcon(this.closeBtn, iconX);
    this.closeBtn.setAttribute("aria-label", "Close");
    this.closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.onClose?.();
    });

    header.append(this.titleSpan, this.closeBtn);

    // Body
    this.body = document.createElement("div");
    this.body.className = "feature-info-body";

    // Footer with prev/next navigation
    this.footer = document.createElement("div");
    this.footer.className = "feature-info-footer";

    this.prevBtn = document.createElement("button");
    this.prevBtn.className = "feature-info-nav-btn";
    setIcon(this.prevBtn, iconChevronUp);
    this.prevBtn.setAttribute("aria-label", "Previous feature");
    this.prevBtn.addEventListener("click", () => this.onCyclePrev?.());

    this.footerLabel = document.createElement("span");

    this.nextBtn = document.createElement("button");
    this.nextBtn.className = "feature-info-nav-btn";
    setIcon(this.nextBtn, iconChevronDown);
    this.nextBtn.setAttribute("aria-label", "Next feature");
    this.nextBtn.addEventListener("click", () => this.onCycleNext?.());

    this.footer.append(this.prevBtn, this.footerLabel, this.nextBtn);

    this.panel.append(header, this.body, this.footer);
    container.appendChild(this.panel);

    // ESC to close
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.isVisible()) {
        this.onClose?.();
      }
    });
  }

  show(info: FeatureInfo, currentIndex: number, totalCount: number): void {
    const title = info.name ? `${info.type}: ${info.name}` : info.type;
    this.titleSpan.textContent = title;

    // Body: property rows
    this.body.innerHTML = "";
    for (const { label, value } of info.details) {
      const row = document.createElement("div");
      row.className = "feature-info-row";
      row.innerHTML = `<span class="feature-info-label">${escapeHtml(label)}</span><span class="feature-info-value">${escapeHtml(value)}</span>`;
      this.body.appendChild(row);
    }

    // Children: grouped slave features (lights, fog signals, topmarks)
    if (info.children && info.children.length > 0) {
      for (const child of info.children) {
        const childSection = document.createElement("div");
        childSection.className = "feature-info-child";

        const childHeader = document.createElement("div");
        childHeader.className = "feature-info-child-header";
        const childTitle = child.name
          ? `${child.type}: ${child.name}`
          : child.type;
        childHeader.textContent = childTitle;
        childSection.appendChild(childHeader);

        for (const { label, value } of child.details) {
          const row = document.createElement("div");
          row.className = "feature-info-row feature-info-child-row";
          row.innerHTML = `<span class="feature-info-label">${escapeHtml(label)}</span><span class="feature-info-value">${escapeHtml(value)}</span>`;
          childSection.appendChild(row);
        }

        this.body.appendChild(childSection);
      }
    }

    // Footer: navigation between stacked features
    if (totalCount > 1) {
      this.footerLabel.textContent = `${currentIndex + 1} of ${totalCount}`;
      this.prevBtn.disabled = currentIndex === 0;
      this.nextBtn.disabled = currentIndex === totalCount - 1;
      this.footer.style.display = "";
    } else {
      this.footer.style.display = "none";
    }

    this.panel.classList.add("visible");
  }

  hide(): void {
    this.panel.classList.remove("visible");
  }

  isVisible(): boolean {
    return this.panel.classList.contains("visible");
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
