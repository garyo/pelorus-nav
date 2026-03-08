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
