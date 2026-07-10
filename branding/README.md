# Pelorus Nav — Branding

Brand assets and the palette/decisions behind them. This folder is the source of
truth for the project's visual identity; the app icon and blog logo both derive
from what's documented here.

## The mark: the sail-dart

The emblem is a heeled, two-tone sail riding a wave, drawn so it also reads as
the **GPS position arrow** — the dart every chartplotter puts at your position.
Sail + wave + arrow in one shape: abstract, a little whimsical, unmistakably
marine. It grew out of the original app icon's sail-wave-arrow idea
([`../public/icon.svg`](../public/icon.svg)), per the 2026-07-10 feedback
(no generic compass rose, no red accent).

Anatomy: the big lit panel is the main, the narrow shaded sliver the jib; the
10° heel says *under way*; the notched base makes it a position dart; the wave
and trailing wake dash put it in the water.

## Assets

| File | Purpose |
|------|---------|
| `make-logo.py` | Parametric generator for **all** SVGs below (geometry + wordmark computed, not hand-drawn) |
| `pelorus-nav-logo.svg` / `.png` | Horizontal card lockup, **1200×630** — blog project card / OG image |
| `pelorus-nav-emblem.svg` / `.png` | Square emblem in a sea-blue disc — **the app icon** (copied to `public/icon.svg`), avatars, favicons |
| `pelorus-nav-emblem-mono.svg` / `.png` | Single-colour emblem, transparent background — stickers, engraving, one-colour print |
| `pelorus-nav-appicon-fg.svg` | Android adaptive-icon foreground (transparent, mark shrunk into the launcher safe zone) |
| `pelorus-nav-appicon-square.svg` | Full-bleed square — iOS app icon source |
| `fonts/Outfit[wght].ttf` | Brand typeface (variable; OFL license alongside) |

The wordmark in the SVGs is **converted to vector paths** (HarfBuzz shaping via
fontTools), so the files render identically everywhere with no font installed.

## Palette

Rooted in the app itself (`public/icon.svg`, `public/manifest.json`) so every
surface reads as one product. No red/warm accent — the brand stays in the blues.

| Role | Hex | Notes |
|------|-----|-------|
| Background navy (dark) | `#1a1a2e` | `theme_color` / `background_color` in the PWA manifest |
| Background navy (card top) | `#12203a` | card background radial-gradient centre |
| Background navy (card edge) | `#0a1526` | card background radial-gradient edge |
| Sea blue | `#1a5276` | emblem disc fill; primary brand blue |
| Blue | `#2980b9` | emblem disc stroke; mid accent |
| Light blue | `#85c1e9` | wave + the "Nav" in the wordmark |
| Off-white | `#eef4f7` | lit sail panel; text on dark |
| Shaded sail | `#a9c6dc` | jib panel of the two-tone sail |
| Muted chrome | `#3d6d94` | tagline text, quiet UI chrome |

## Typography

**Outfit** (OFL, in `fonts/`) — a friendly geometric sans that matches the
mark's character:

- Wordmark `Pelorus Nav`: Outfit **600**; "Pelorus" off-white, "Nav" light blue
- Tagline `MARINE CHARTPLOTTER`: Outfit **500**, wide letterspacing, muted chrome

## Card layout & format

- **1200×630** (≈1.905:1), matching the sibling project logos in the personal
  blog (`bioviz`, `openfx`, `long-now-boston`) and the 2:1 crop the blog's
  `ProjectCard.astro` applies (`object-cover`, 400×200). The emblem tip and
  tagline are kept clear of the top/bottom crop lines.
- Composition: sail-dart emblem (no disc) floating on the navy radial gradient,
  wordmark and tagline centred below — the emblem-over-name pattern the other
  project cards use.

## Regenerating

```bash
cd branding
uv run make-logo.py     # writes all three SVGs (deps declared inline: fonttools, uharfbuzz)
rsvg-convert -w 1200 -h 630 pelorus-nav-logo.svg -o pelorus-nav-logo.png
rsvg-convert -w 512 -h 512 pelorus-nav-emblem.svg -o pelorus-nav-emblem.png
rsvg-convert -w 512 -h 512 pelorus-nav-emblem-mono.svg -o pelorus-nav-emblem-mono.png
```

Tunables (heel angle, control net for the sail curves, wave path, palette) live
at the top of `make-logo.py`. `rsvg-convert` comes from `librsvg`
(`brew install librsvg`); `inkscape` or `resvg` work as drop-in renderers too.
`emblem(mono="#1a5276")` in the generator produces a dark-on-light mono variant
if one is ever needed.

### App icons & splash screens (after changing the emblem)

```bash
cd branding
cp pelorus-nav-emblem.svg ../public/icon.svg          # web favicon + PWA manifest icon

# Android launchers: legacy/round from the disc emblem (48dp base),
# adaptive foreground from the safe-zone SVG (108dp base)
for d in mdpi:48 hdpi:72 xhdpi:96 xxhdpi:144 xxxhdpi:192; do
  rsvg-convert -w ${d##*:} -h ${d##*:} pelorus-nav-emblem.svg \
    -o ../android/app/src/main/res/mipmap-${d%%:*}/ic_launcher.png
  rsvg-convert -w ${d##*:} -h ${d##*:} pelorus-nav-emblem.svg \
    -o ../android/app/src/main/res/mipmap-${d%%:*}/ic_launcher_round.png
done
for d in mdpi:108 hdpi:162 xhdpi:216 xxhdpi:324 xxxhdpi:432; do
  rsvg-convert -w ${d##*:} -h ${d##*:} pelorus-nav-appicon-fg.svg \
    -o ../android/app/src/main/res/mipmap-${d%%:*}/ic_launcher_foreground.png
done

# iOS app icon
rsvg-convert -w 1024 -h 1024 pelorus-nav-appicon-square.svg \
  -o ../ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png
```

The adaptive-icon background colour (`#1a5276`) is set in
`android/app/src/main/res/values/ic_launcher_background.xml`.

Splash screens (Android `drawable*/splash.png`, iOS `Splash.imageset`) are the
disc emblem at 35% of the short edge, centred on `#1a1a2e`: render the emblem at
that size with `rsvg-convert`, then pad with
`sips -p <H> <W> --padColor 1A1A2E <file>`.

### Publishing to the blog

The blog's project entry (`garyo-blog/blog-2024/src/content/projects/pelorus-nav.md`)
references `image: pelorus-nav-logo.png`. Copy the rendered PNG next to that
markdown file to update the card.

## Design history

- **v1 (2026-07-10, retired):** compass-rose emblem with a red North marker.
  Feedback: the rose was too generic and the red didn't fit — build instead on
  the app icon's whimsical sail-wave-arrow, keep the layout, palette, and
  wordmark. v2 (the sail-dart) is that iteration.

## Open decisions / TODO

- **Domain/store consistency** — the app ships at `pelorus-nav.com`; keep this
  mark in sync wherever the app is listed.
