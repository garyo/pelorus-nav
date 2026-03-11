/**
 * Fixed-position container for stacking side panels (tracks, routes, etc.).
 * Panels are appended as children and flow vertically with a gap.
 * Each panel manages its own visibility via CSS classes; the stack
 * just provides layout.
 */

const CONTAINER_CLASS = "panel-stack";
const TOP_BAR_HEIGHT = 44;

let container: HTMLDivElement | null = null;

/** Get (or create) the shared panel stack container. */
export function getPanelStack(): HTMLDivElement {
  if (container) return container;
  container = document.createElement("div");
  container.className = CONTAINER_CLASS;
  document.body.appendChild(container);
  return container;
}

/**
 * Observe the instrument HUD element so the panel stack's top offset
 * stays below it (instead of overlapping).
 */
export function trackInstrumentHUD(hudElement: HTMLElement): void {
  const stack = getPanelStack();

  const update = () => {
    const rect = hudElement.getBoundingClientRect();
    // If the HUD is hidden (display:none), rect.height is 0 — fall back to top bar only
    const top = rect.height > 0 ? rect.bottom : TOP_BAR_HEIGHT;
    stack.style.top = `${top}px`;
    stack.style.maxHeight = `calc(100vh - ${top + 10}px)`;
  };

  const observer = new ResizeObserver(update);
  observer.observe(hudElement);
  update();
}
