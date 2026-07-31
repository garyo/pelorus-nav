import type { Theme } from "vitepress";
import DefaultTheme from "vitepress/theme";

/**
 * Default theme plus analytics, and analytics is the only reason this file
 * exists — the guide had none at all until 2026-07-31, so every pelorus-nav
 * figure before then is app-and-landing only.
 *
 * Page views are announced from the router rather than by the tracker's own
 * history hook. The hook fires on `pushState`, and VitePress pushes the URL
 * before Vue has applied the new page's title: measured on the built site, a
 * click through to Getting Started reported the right path with the INDEX's
 * title, so every page in the guide would have been filed under one name.
 * `onAfterRouteChange` runs after the route settles, and the deferral lets the
 * title watcher flush before the view is taken.
 */
export default {
  extends: DefaultTheme,
  enhanceApp({ router }) {
    // `enhanceApp` also runs during the static build, where there is no page
    // to measure and no `window` to measure it with.
    if (typeof window === "undefined") return;

    // A remote ESM module: there is nothing on disk for TypeScript to resolve,
    // and the tracker is deliberately served rather than bundled so a fix
    // reaches every site without rebuilding any of them.
    // @ts-expect-error - resolved by the browser at runtime, not by tsc
    void import("https://analytics.oberbrunner.com/tracker.js").then(
      ({ init, page }: { init: (c: unknown) => void; page: () => void }) => {
        init({
          site: 5,
          endpoint: "https://analytics.oberbrunner.com/api/collect",
          autoPageviews: false,
        });
        const view = (): void => {
          setTimeout(() => page(), 0);
        };
        view(); // the page they landed on
        router.onAfterRouteChange = view;
      },
    );
  },
} satisfies Theme;
