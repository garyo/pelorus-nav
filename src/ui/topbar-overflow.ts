/**
 * Priority+ overflow for the top bar on narrow screens.
 *
 * Desktop (>768px) shows every menu item inline via CSS (`display:
 * contents` on #topbar-menu), so this module stands down there. On
 * narrow screens the CSS collapses the menu into the hamburger dropdown
 * and only the core #topbar-actions buttons stay visible — but many
 * widths (e.g. iPad portrait at 744px) have room for more. This promotes
 * menu items into the visible row while they fit and demotes them back
 * when space shrinks, preserving menu order. Non-action elements (the
 * offline indicator, the settings wrapper with its gear and badges)
 * always stay in the dropdown, so the hamburger keeps a purpose at
 * every width.
 */

export interface TopbarOverflowElements {
  /** The whole bar — measured for overflow. */
  topBar: HTMLElement;
  /** Always-visible actions row that promoted items join. */
  actions: HTMLElement;
  /** Collapsible menu that owns the items when not promoted. */
  menu: HTMLElement;
  /** Hamburger button — its visibility marks narrow mode. */
  hamburger: HTMLElement;
}

/** Overrides for tests (jsdom has no layout, so measurement is injectable). */
export interface TopbarOverflowHooks {
  fits?: () => boolean;
  isNarrow?: () => boolean;
}

/** A promoted item plus the sibling it sat before, for exact restoration.
 *  LIFO demotion keeps anchors valid: an item's anchor is either a later
 *  menu item (demoted first) or a never-promoted element. */
interface PromotedItem {
  el: HTMLElement;
  anchor: Element | null;
}

export function relayoutTopbar(
  els: TopbarOverflowElements,
  promoted: PromotedItem[],
  hooks: TopbarOverflowHooks = {},
): void {
  const { topBar, actions, menu } = els;
  const fits = hooks.fits ?? (() => topBar.scrollWidth <= topBar.clientWidth);
  const isNarrow =
    hooks.isNarrow ??
    (() => getComputedStyle(els.hamburger).display !== "none");

  // First remaining action button, scanning past non-action elements
  // (e.g. the offline indicator) so they don't wall off later buttons.
  const nextPromotable = (): HTMLElement | null => {
    for (const child of menu.children) {
      if (child instanceof HTMLElement && child.matches(".topbar-action")) {
        return child;
      }
    }
    return null;
  };
  const demote = () => {
    const item = promoted.pop();
    if (!item) return;
    const anchor = item.anchor?.parentElement === menu ? item.anchor : null;
    menu.insertBefore(item.el, anchor ?? menu.firstChild);
  };

  // Wide mode: CSS renders the whole menu inline — restore canonical order.
  if (!isNarrow()) {
    while (promoted.length > 0) demote();
    return;
  }

  // Grow while there's room (may overshoot by one item)…
  let candidate = nextPromotable();
  while (candidate && fits()) {
    promoted.push({ el: candidate, anchor: candidate.nextElementSibling });
    actions.appendChild(candidate);
    candidate = nextPromotable();
  }
  // …then shrink until the bar fits again.
  while (promoted.length > 0 && !fits()) demote();
}

/** Wire up the overflow manager: initial layout + relayout on resize and
 *  on menu mutations (plugins register their buttons asynchronously). */
export function initTopbarOverflow(els: TopbarOverflowElements): void {
  const promoted: PromotedItem[] = [];
  let scheduled = false;
  const relayout = () => {
    scheduled = false;
    relayoutTopbar(els, promoted);
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(relayout);
  };

  new ResizeObserver(schedule).observe(els.topBar);
  // Menu items can arrive after init (plugin actions); ignore our own
  // promote/demote churn — relayout is idempotent so extra runs are safe.
  new MutationObserver(schedule).observe(els.menu, { childList: true });

  relayoutTopbar(els, promoted);
}
