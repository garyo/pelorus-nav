/**
 * Priority+ overflow for the top bar.
 *
 * The bar has two presentations, owned here via the `topbar-collapsed`
 * class on the bar (see style.css): inline (every menu item flows in the
 * bar via `display: contents`, no hamburger) and collapsed (menu items
 * live in the hamburger dropdown). Wide screens whose full inline row
 * fits stay inline. Everything else — narrow screens (≤768px), and wider
 * ones where optional buttons (e.g. Lock) overflow the inline row —
 * collapses, then promotes menu items into the visible row while they
 * fit and demotes them back when space shrinks, preserving menu order.
 * The settings wrapper (gear) promotes last, after all action buttons,
 * so it stays reachable in the dropdown whenever there IS overflow. When
 * everything fits — no visible element left in the menu — the hamburger
 * hides entirely (an iPad in portrait shows the whole bar, no menu
 * button).
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

  // Next thing to promote: leading action buttons first (scanning past any
  // non-action element so it doesn't wall off later buttons), then the
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
  // must reach through it — any visible child (a non-promotable element, or
  // anything not yet promoted). A child's own `display` is independent of
  // the menu's collapsed display:none, so this reads correctly either way.
  const updateHamburger = () => {
    const needed = [...menu.children].some(
      (c) => c instanceof HTMLElement && getComputedStyle(c).display !== "none",
    );
    hamburger.style.display = needed ? "" : "none";
  };

  // Try the inline presentation first: canonical order, no collapse. On a
  // wide screen whose full row fits, that's the final state (CSS hides the
  // hamburger). Narrow screens always collapse; a wide screen whose inline
  // row overflows (e.g. optional buttons enabled) collapses too, so every
  // item stays reachable through the dropdown.
  while (promoted.length > 0) demote();
  topBar.classList.remove("topbar-collapsed");
  hamburger.style.display = "";
  if (!isNarrow() && fits()) return;
  topBar.classList.add("topbar-collapsed");

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
export function initTopbarOverflow(
  els: TopbarOverflowElements,
  hooks: TopbarOverflowHooks = {},
): void {
  const promoted: PromotedItem[] = [];
  let scheduled = false;
  let selfMutating = false;
  const relayout = () => {
    scheduled = false;
    selfMutating = true;
    relayoutTopbar(els, promoted, hooks);
    // Our own promote/demote mutations are delivered to the observer in a
    // microtask queued before this one, so the flag is still set when the
    // observer sees them and clear by the time any external mutation lands.
    queueMicrotask(() => {
      selfMutating = false;
    });
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(relayout);
  };

  new ResizeObserver(schedule).observe(els.topBar);
  // Menu items can arrive after init (plugin actions), and existing items
  // can be shown/hidden via style.display (the Lock button follows a
  // setting) — width changes no resize or childList event reports, so
  // watch style attributes across the whole bar (a shown/hidden item may
  // currently be promoted into the actions row). Our own promote/demote
  // churn must NOT reschedule: when the bar is in overflow, every relayout
  // probes by moving one item out and back, and reacting to that probe
  // would re-run relayout every frame indefinitely.
  const onMutation = () => {
    if (!selfMutating) schedule();
  };
  new MutationObserver(onMutation).observe(els.menu, { childList: true });
  new MutationObserver(onMutation).observe(els.topBar, {
    subtree: true,
    attributeFilter: ["style"],
  });

  relayoutTopbar(els, promoted, hooks);
}
