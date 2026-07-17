/**
 * Fixed-position container for stacking side panels (tracks, routes, etc.).
 * Panels are appended as children and flow vertically with a gap.
 * Each panel manages its own visibility via CSS classes; the stack
 * just provides layout.
 */

const CONTAINER_CLASS = "panel-stack";

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
    // Hidden HUD (height 0): clear our inline override so the stylesheet's
    // `top: var(--topbar-bottom)` positions the stack — that value includes
    // the safe-area inset (a hardcoded constant would sit too high under the
    // top bar in fullscreen, where the inset is nonzero).
    if (rect.height <= 0) {
      stack.style.top = "";
      stack.style.maxHeight = "";
      return;
    }
    // A full-width top bar: the stack sits below it. A narrow side column
    // (landscape "side" layout): sit beside it, anchored at its top instead.
    const top = rect.width >= window.innerWidth * 0.6 ? rect.bottom : rect.top;
    stack.style.top = `${top}px`;
    stack.style.maxHeight = `calc(100vh - ${top + 10}px)`;
  };

  const observer = new ResizeObserver(update);
  observer.observe(hudElement);

  // The observer only fires on HUD *size* changes. Entering fullscreen (or
  // Safari showing/hiding its chrome) shifts the HUD's position via a
  // safe-area-inset change without resizing it, so the stack's top would
  // otherwise keep its stale pre-transition value and overlap the HUD.
  // Recompute on the events that signal those repositions. fullscreenchange
  // can fire before the safe-area/reflow settles, so also re-read next frame.
  window.addEventListener("resize", update);
  window.visualViewport?.addEventListener("resize", update);
  document.addEventListener("fullscreenchange", () => {
    update();
    requestAnimationFrame(update);
  });

  update();
}
