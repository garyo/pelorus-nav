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
    // A full-width top bar: the stack sits below it. A narrow side column
    // (landscape "side" layout): sit beside it, anchored at its top instead.
    // Hidden HUD (height 0): fall back to the top bar height.
    let top: number;
    if (rect.height <= 0) {
      top = TOP_BAR_HEIGHT;
    } else if (rect.width >= window.innerWidth * 0.6) {
      top = rect.bottom;
    } else {
      top = rect.top;
    }
    stack.style.top = `${top}px`;
    stack.style.maxHeight = `calc(100vh - ${top + 10}px)`;
  };

  const observer = new ResizeObserver(update);
  observer.observe(hudElement);
  update();
}
