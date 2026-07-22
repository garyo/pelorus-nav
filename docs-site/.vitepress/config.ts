import { defineConfig } from "vitepress";

// The user guide is served at pelorus-nav.com/doc/userguide/ (see the /doc
// route in src/worker.ts). `bun run build` appends this site's output to
// dist/ after the app build, so it deploys with every push to main.
export default defineConfig({
  title: "Pelorus Nav User Guide",
  description: "How to use Pelorus Nav, the open-source marine chartplotter",
  lang: "en-US",
  base: "/doc/userguide/",
  outDir: "../dist/doc/userguide",
  // head hrefs are not base-prefixed automatically, so spell out the path.
  head: [
    [
      "link",
      { rel: "icon", type: "image/svg+xml", href: "/doc/userguide/icon.svg" },
    ],
  ],
  themeConfig: {
    logo: "/icon.svg",
    siteTitle: "Pelorus Nav User Guide",
    nav: [
      { text: "Pelorus Nav", link: "https://pelorus-nav.com/" },
      { text: "Open the App", link: "https://pelorus-nav.com/app" },
    ],
    sidebar: [
      {
        text: "User Guide",
        items: [
          { text: "Introduction", link: "/" },
          { text: "Getting Started", link: "/getting-started" },
          { text: "The Chart Display", link: "/chart-display" },
          { text: "Routes", link: "/routes" },
        ],
      },
    ],
    search: { provider: "local" },
    outline: { level: [2, 3] },
    socialLinks: [
      { icon: "github", link: "https://github.com/garyo/pelorus-nav" },
    ],
    footer: {
      message:
        "Not for primary navigation. Always maintain a proper lookout and use official charts.",
    },
  },
});
