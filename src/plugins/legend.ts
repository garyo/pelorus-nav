/**
 * Host-owned legend renderer.
 *
 * Plugins can't (and shouldn't) draw their own on-map DOM — that breaks the
 * DOM-free boundary the SDK relies on for future sandboxing. Instead a plugin
 * declares a legend (`host.ui.setLegend(spec)`) and the host renders it here as
 * a small color-scale widget in the corner of the map. One legend per plugin;
 * they stack.
 */

export interface LegendStop {
  /** CSS color (may be rgba with alpha). */
  color: string;
  /** Label shown next to this stop (e.g. "20 kt"). */
  label: string;
}

export interface LegendSpec {
  /** Heading, e.g. "Wind (kt)". */
  title: string;
  /** Ordered low → high; rendered as a vertical gradient with labels. */
  stops: LegendStop[];
}

export class LegendHost {
  private readonly mapContainer: HTMLElement;
  private container: HTMLElement | null = null;
  private readonly legends = new Map<string, HTMLElement>();

  constructor(mapContainer: HTMLElement) {
    this.mapContainer = mapContainer;
  }

  /** Show/replace (spec) or remove (null) a plugin's legend. */
  set(pluginId: string, spec: LegendSpec | null): void {
    if (!spec || spec.stops.length === 0) {
      this.remove(pluginId);
      return;
    }
    const host = this.ensureContainer();
    let el = this.legends.get(pluginId);
    if (!el) {
      el = document.createElement("div");
      el.className = "plugin-legend";
      Object.assign(el.style, {
        background: "rgba(0,0,0,0.6)",
        color: "#fff",
        font: "11px/1.2 system-ui, sans-serif",
        padding: "5px 7px",
        borderRadius: "4px",
        pointerEvents: "none",
      } satisfies Partial<CSSStyleDeclaration>);
      host.appendChild(el);
      this.legends.set(pluginId, el);
    }
    el.replaceChildren(renderLegend(spec));
  }

  private remove(pluginId: string): void {
    this.legends.get(pluginId)?.remove();
    this.legends.delete(pluginId);
    if (this.legends.size === 0) {
      this.container?.remove();
      this.container = null;
    }
  }

  private ensureContainer(): HTMLElement {
    if (!this.container) {
      const c = document.createElement("div");
      c.className = "plugin-legends";
      Object.assign(c.style, {
        position: "absolute",
        right: "8px",
        top: "50%",
        transform: "translateY(-50%)",
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        zIndex: "5",
      } satisfies Partial<CSSStyleDeclaration>);
      this.mapContainer.appendChild(c);
      this.container = c;
    }
    return this.container;
  }
}

function renderLegend(spec: LegendSpec): HTMLElement {
  const wrap = document.createElement("div");

  const title = document.createElement("div");
  title.textContent = spec.title;
  Object.assign(title.style, { fontWeight: "600", marginBottom: "3px" });
  wrap.appendChild(title);

  const row = document.createElement("div");
  Object.assign(row.style, { display: "flex", gap: "5px", height: "104px" });

  // Vertical gradient bar (low at bottom → high at top).
  const bar = document.createElement("div");
  Object.assign(bar.style, {
    width: "12px",
    height: "100%",
    borderRadius: "2px",
    border: "1px solid rgba(255,255,255,0.4)",
    background: `linear-gradient(to top, ${spec.stops.map((s) => s.color).join(",")})`,
  });

  // Labels aligned high → low next to the bar.
  const labels = document.createElement("div");
  Object.assign(labels.style, {
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
  });
  for (const label of spec.stops.map((s) => s.label).reverse()) {
    const span = document.createElement("span");
    span.textContent = label;
    labels.appendChild(span);
  }

  row.append(bar, labels);
  wrap.appendChild(row);
  return wrap;
}
