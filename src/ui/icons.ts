/**
 * SVG icon library. Returns inline SVG strings sized to 1em.
 * Icons use currentColor so they inherit text color from CSS.
 *
 * All icons are 24×24 viewBox, rendered at 1em × 1em.
 */

function svg(paths: string, opts?: { fill?: boolean }): string {
  const stroke = opts?.fill
    ? 'fill="currentColor"'
    : 'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="1em" height="1em" ${stroke}>${paths}</svg>`;
}

/** Gear / settings. */
export const iconSettings = svg(
  '<circle cx="12" cy="12" r="3"/>' +
    '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1.08z"/>',
);

/** Record (filled circle). */
export const iconRecord = svg('<circle cx="12" cy="12" r="7"/>', {
  fill: true,
});

/** Gauge / instrument panel. */
export const iconGauge = svg(
  '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z"/>' +
    '<path d="M12 6v2"/>' +
    '<path d="M16.24 7.76l-1.42 1.42"/>' +
    '<path d="M18 12h-2"/>' +
    '<path d="M14.83 14.83L12 12"/>',
);

/** Map/route line with pin markers. */
export const iconRoute = svg(
  '<path d="M3 17l4-4 4 4 4-4 4 4"/>' +
    '<circle cx="7" cy="7" r="2"/>' +
    '<line x1="7" y1="9" x2="7" y2="13"/>',
);

/** Track / footsteps path. */
export const iconTrack = svg(
  '<polyline points="4 19 8 13 12 17 16 10 20 14"/>',
);

/** Crosshair / recenter. */
export const iconCrosshair = svg(
  '<circle cx="12" cy="12" r="4"/>' +
    '<line x1="12" y1="2" x2="12" y2="6"/>' +
    '<line x1="12" y1="18" x2="12" y2="22"/>' +
    '<line x1="2" y1="12" x2="6" y2="12"/>' +
    '<line x1="18" y1="12" x2="22" y2="12"/>',
);

/** Eye / visible. */
export const iconEye = svg(
  '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/>' +
    '<circle cx="12" cy="12" r="3"/>',
);

/** Eye with slash / hidden. */
export const iconEyeOff = svg(
  '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>' +
    '<path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>' +
    '<path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/>' +
    '<line x1="1" y1="1" x2="23" y2="23"/>',
);

/** Trash can / delete. */
export const iconTrash = svg(
  '<polyline points="3 6 5 6 21 6"/>' +
    '<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>' +
    '<path d="M10 11v6"/>' +
    '<path d="M14 11v6"/>' +
    '<path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
);

/** Pencil / edit. */
export const iconEdit = svg(
  '<path d="M17 3a2.83 2.83 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>',
);

/** X / close. */
export const iconX = svg(
  '<line x1="18" y1="6" x2="6" y2="18"/>' +
    '<line x1="6" y1="6" x2="18" y2="18"/>',
);

/** Chevron up. */
export const iconChevronUp = svg('<polyline points="6 15 12 9 18 15"/>');

/** Chevron down. */
export const iconChevronDown = svg('<polyline points="6 9 12 15 18 9"/>');

/** Download / arrow-down-to-line. */
export const iconDownload = svg(
  '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>' +
    '<polyline points="7 10 12 15 17 10"/>' +
    '<line x1="12" y1="15" x2="12" y2="3"/>',
);

/** Globe / chart regions. */
export const iconGlobe = svg(
  '<circle cx="12" cy="12" r="10"/>' +
    '<line x1="2" y1="12" x2="22" y2="12"/>' +
    '<path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
);

/** Cloud with slash / offline. */
export const iconCloudOff = svg(
  '<path d="M22.61 16.95A5 5 0 0 0 18 10h-1.26a8 8 0 0 0-7.05-6"/>' +
    '<path d="M5 5a8 8 0 0 0 4 15h9a5 5 0 0 0 1.7-.3"/>' +
    '<line x1="1" y1="1" x2="23" y2="23"/>',
);

/** Map pin / waypoint marker. */
export const iconPin = svg(
  '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 1 1 18 0z"/>' +
    '<circle cx="12" cy="10" r="3"/>',
);

/** Compass / navigation arrow. */
export const iconNavigation = svg(
  '<polygon points="3 11 22 2 13 21 11 13 3 11"/>',
);

/** Square with X / stop-cancel. */
export const iconSquare = svg(
  '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>',
);

/** Upload / folder-up / import. */
export const iconUpload = svg(
  '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>' +
    '<polyline points="17 8 12 3 7 8"/>' +
    '<line x1="12" y1="3" x2="12" y2="15"/>',
);

/** Maximize / fullscreen (expand corners). */
export const iconMaximize = svg(
  '<polyline points="15 3 21 3 21 9"/>' +
    '<polyline points="9 21 3 21 3 15"/>' +
    '<line x1="21" y1="3" x2="14" y2="10"/>' +
    '<line x1="3" y1="21" x2="10" y2="14"/>',
);

/** Minimize / exit fullscreen (shrink corners). */
export const iconMinimize = svg(
  '<polyline points="4 14 10 14 10 20"/>' +
    '<polyline points="20 10 14 10 14 4"/>' +
    '<line x1="14" y1="10" x2="21" y2="3"/>' +
    '<line x1="10" y1="14" x2="3" y2="21"/>',
);

/** Plotting / drafting compass (two lines crossing). */
export const iconPlot = svg(
  '<line x1="4" y1="20" x2="20" y2="4"/>' +
    '<line x1="4" y1="4" x2="20" y2="20"/>' +
    '<circle cx="12" cy="12" r="2"/>',
);

/**
 * Set an element's innerHTML to an icon SVG.
 * Marks the SVG as aria-hidden so screen readers skip the decorative icon.
 */
export function setIcon(el: HTMLElement, icon: string): void {
  el.innerHTML = icon;
  const svg = el.querySelector("svg");
  if (svg) svg.setAttribute("aria-hidden", "true");
}
