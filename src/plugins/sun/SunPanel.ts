/**
 * On-demand sun-times popup: sunrise, sunset, and civil twilight for the next
 * week at the current chart-center location, in the device's local time.
 * Opened from the Sun top-bar action; closes on outside click or Escape.
 */

import { sunTimes } from "../../astro/sun";
import { formatLatLon } from "../../utils/coordinates";
import type { PluginHost } from "../types";

const DAYS = 7;

const fmtTime = (d: Date | null): string =>
  d ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";

/** Local-noon instant `offset` days from today (rolls over months/years). */
function localNoon(offset: number): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate() + offset, 12);
}

export class SunPanel {
  private readonly host: PluginHost;
  private el: HTMLElement | null = null;
  /** Notified when the popup opens (true) / closes (false) — drives button state. */
  onVisibilityChange: ((open: boolean) => void) | null = null;
  private outside: ((e: Event) => void) | null = null;
  private onKey: ((e: KeyboardEvent) => void) | null = null;

  constructor(host: PluginHost) {
    this.host = host;
  }

  toggle(): void {
    if (this.el) this.close();
    else this.open();
  }

  open(): void {
    if (this.el) return;
    const c = this.host.map.raw.getCenter();
    this.el = this.render(c.lat, c.lng);
    document.body.appendChild(this.el);

    this.outside = (e) => {
      if (this.el && !this.el.contains(e.target as Node)) this.close();
    };
    this.onKey = (e) => {
      if (e.key === "Escape") this.close();
    };
    // Defer: the click that opened the popup is still bubbling.
    setTimeout(() => {
      document.addEventListener("pointerdown", this.outside as EventListener);
      document.addEventListener("keydown", this.onKey as EventListener);
    }, 0);
    this.onVisibilityChange?.(true);
  }

  close(): void {
    if (!this.el) return;
    if (this.outside) {
      document.removeEventListener(
        "pointerdown",
        this.outside as EventListener,
      );
    }
    if (this.onKey) {
      document.removeEventListener("keydown", this.onKey as EventListener);
    }
    this.outside = null;
    this.onKey = null;
    this.el.remove();
    this.el = null;
    this.onVisibilityChange?.(false);
  }

  destroy(): void {
    this.close();
  }

  private render(lat: number, lon: number): HTMLElement {
    const root = document.createElement("div");
    root.className = "sun-popup";

    const title = document.createElement("div");
    title.className = "sun-popup-title";
    title.textContent = `Sun · ${formatLatLon(lat, "lat")} ${formatLatLon(lon, "lon")}`;
    root.appendChild(title);

    const table = document.createElement("table");
    table.className = "sun-table";

    const head = document.createElement("tr");
    for (const label of ["", "Dawn", "Sunrise", "Sunset", "Dusk"]) {
      const th = document.createElement("th");
      th.textContent = label;
      head.appendChild(th);
    }
    const thead = document.createElement("thead");
    thead.appendChild(head);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (let i = 0; i < DAYS; i++) {
      const noon = localNoon(i);
      const t = sunTimes(noon, lat, lon);
      const tr = document.createElement("tr");

      const day = document.createElement("th");
      day.scope = "row";
      day.textContent =
        i === 0
          ? "Today"
          : noon.toLocaleDateString([], {
              weekday: "short",
              month: "short",
              day: "numeric",
            });
      tr.appendChild(day);

      const cols: [Date | null, boolean][] = [
        [t.civilDawn, true],
        [t.sunrise, false],
        [t.sunset, false],
        [t.civilDusk, true],
      ];
      for (const [val, twilight] of cols) {
        const td = document.createElement("td");
        if (twilight) td.className = "twilight";
        td.textContent = fmtTime(val);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    root.appendChild(table);

    const note = document.createElement("div");
    note.className = "sun-popup-note";
    note.textContent = "Local time · dawn/dusk = civil twilight";
    root.appendChild(note);
    return root;
  }
}
