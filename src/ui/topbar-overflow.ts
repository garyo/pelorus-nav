/**
 * Priority+ overflow for the top bar on narrow screens.
 *
 * Desktop (>768px) shows every menu item inline via CSS (`display:
 * contents` on #topbar-menu), so this module stands down there. On
 * narrow screens the CSS collapses the menu into the hamburger dropdown
 * and only the core #topbar-actions buttons stay visible — but many
 * widths (e.g. iPad portrait at 744px) have room for more. This promotes
 * menu items into the visible row while they fit and demotes them back
 * when space shrinks, preserving menu order. The settings wrapper (gear)
 * promotes last, after all action buttons, so it stays reachable in the
 * dropdown whenever there IS overflow. When everything fits — nothing
 * left in the menu but a hidden offline indicator — the hamburger hides
 * entirely (an iPad in portrait shows the whole bar, no menu button).
 */

export interface TopbarOverflowElements {
  /** The whole bar — measured for overflow. */
  topBar: HTMLElement;
  /** Always-visible actions row that promoted items join. */
  actions: HTMLElement;
  /** Collapsible menu that owns the items when not promoted. */
  menu: HTMLElement;
  /** Hamburger button — hidden when the menu has nothing left to hold. */
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
  const { topBar, actions, menu, hamburger } = els;
  const fits = hooks.fits ?? (() => topBar.scrollWidth <= topBar.clientWidth);
  // Key off the CSS breakpoint directly, not the hamburger's display — this
  // function now controls that display, so reading it back would feed on
  // itself.
  const isNarrow =
    hooks.isNarrow ?? (() => window.matchMedia("(max-width: 768px)").matches);

  // Next thing to promote: leading action buttons first (scanning past the
  // offline indicator so it doesn't wall off later buttons), then the
  // settings wrapper last — it should be the first to fall back into the
  // dropdown when space is tight, so it's promoted only once nothing else
  // is left in the menu.
  const nextPromotable = (): HTMLElement | null => {
    for (const child of menu.children) {
      if (child instanceof HTMLElement && child.matches(".topbar-action")) {
        return child;
      }
    }
    const wrapper = menu.querySelector(".settings-wrapper");
    return wrapper instanceof HTMLElement ? wrapper : null;
  };
  const demote = () => {
    const item = promoted.pop();
    if (!item) return;
    // A null anchor means the item was the menu's last child — insertBefore
    // with a null reference node appends to the end, which is what we want.
    const anchor = item.anchor?.parentElement === menu ? item.anchor : null;
    menu.insertBefore(item.el, anchor);
  };

  // The hamburger is only needed if the menu still holds something the user
  // must reach through it — a visible child (offline indicator when shown,
  // or anything not yet promoted). A child's own `display` is independent of
  // the menu's collapsed display:none, so this reads correctly either way.
  const updateHamburger = () => {
    const needed = [...menu.children].some(
      (c) => c instanceof HTMLElement && getComputedStyle(c).display !== "none",
    );
    hamburger.style.display = needed ? "" : "none";
  };

  // Wide mode: CSS renders the whole menu inline — restore canonical order
  // and let CSS hide the hamburger.
  if (!isNarrow()) {
    while (promoted.length > 0) demote();
    hamburger.style.display = "";
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

  updateHamburger();
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
