# Pelorus Nav - Project Conventions

## Overview
Pelorus Nav — open-source web-based marine chartplotter (PWA). See PLAN.md for full architecture and roadmap.

## Stack
- **Language**: TypeScript (strict mode, no `any`)
- **Runtime**: Bun (dev/build), browser (prod)
- **Map**: MapLibre GL JS
- **Bundler**: Vite
- **Testing**: Vitest (unit), Playwright (E2E)
- **Lint/format**: Biome

## Commands
- `bun dev` — start dev server
- `bun run build` — production build
- `bun run test` — unit tests (Vitest)
- `bun run e2e` — E2E tests (Playwright, Chromium only by default)
- `bun run lint` — check lint + format
- `bun run lint:fix` — auto-fix lint + format
- `bun run typecheck` — TypeScript type checking
- `bun run check` — run typecheck + lint + test (use before committing)

## Code Conventions
- Use `double quotes` and `semicolons` (enforced by Biome)
- 2-space indent (enforced by Biome)
- No `any` types (enforced by Biome + TS strict)
- Prefer pure functions and interfaces over classes where practical
- Keep modules small and focused; one concept per file
- All utility functions must have unit tests

## UI Conventions
- **Floating panels/bars register with `src/ui/SurfaceManager.ts`** (slot,
  group, priority) and call the handle's `opened()` when shown — never
  hand-pick z-indexes or hand-wire "panel A closes panel B". Opening a
  surface evicts other groups from its slot; same-group surfaces coexist
  (a manager panel and its detail panel form a click-through pair);
  `priority` surfaces (COB) are never evicted. Outside-tap dismissal is
  the default (touch devices have no Esc key); bars whose purpose is map
  interaction opt out with `closeOnOutsideClick: false`. Full contract in
  the module header.
- **Dialogs that consume Escape call `e.preventDefault()`** — the global
  Escape fallback (nav cancel, in ContextMenu.ts) defers one tick and
  checks `defaultPrevented`.
- **Detail-level visibility is documented in `docs/detail-levels.md`** —
  regenerate it with `bun tools/detail-levels-report.ts` after changing
  layer minzooms, `LAYER_CATEGORIES`, or the detail-level minzoom maps.

## File Structure
- `src/` — application source
  - `chart/` — chart providers, S-52 colours, vector tile styles (`styles/`)
  - `navigation/` — GPS providers (simulator, geolocation, NMEA, Signal K), active nav
  - `vessel/` — vessel display, chart mode state machine, course line
  - `map/` — map interactions (measurement, route editing, draggable points)
  - `ui/` — UI controls (HUD, settings panel, route/waypoint managers, context menu)
  - `data/` — IndexedDB storage, chart catalog
  - `utils/` — pure utility functions (coordinates, magnetic declination, units)
  - `plugins/` — Capacitor native plugins
- `tests/e2e/` — Playwright E2E tests
- `public/` — static assets (PMTiles, sprites, glyph fonts, coverage masks)
- `tools/` — offline tools (S-57 pipeline, sprite builder, tile upload/check scripts)
- `branding/` — brand assets + parametric logo generator (see its README)

## URL layout (production)
In production the **app lives at `/app`**; `/` is the static marketing landing
page (`public/landing.html`, assets in `public/landing/`). `src/worker.ts`
rewrites `/` to the landing page and handles `POST /api/subscribe` (newsletter
signups → SUBSCRIBERS KV; `run_worker_first` in wrangler.toml makes those routes
reach the worker at all). The Vite **dev server still serves the app at `/`**
(no worker); preview the landing page at `/landing.html`. To exercise the real
routing locally: `bun run build && bunx wrangler dev --local`. The PWA
`start_url` is `/app`; the service worker never intercepts `/`, `/landing.html`,
or `/api/*` (denylist in vite.config.ts), and landing assets stay out of the
app's precache. Capacitor builds are unaffected (they load the bundle directly).

## Testing
- Unit tests: colocate as `*.test.ts` next to source files
- E2E tests: in `tests/e2e/`
- Playwright needs WebGL flags for headless Chromium (configured in playwright.config.ts)
- Use SimulatorProvider for GPS data in tests (no real hardware needed)

## GPS Diagnostic Logging
The app has a built-in GPS diagnostic logger (`src/navigation/GPSDiagnosticLog.ts`)
that records raw, Kalman-filtered, and course-smoothed data at each stage of the
GPS pipeline. It's wired into `NavigationDataManager` and `main.ts`, exposed on
`window.gpsDiag` for console access:
- `gpsDiag.start()` / `gpsDiag.stop()` — toggle recording
- `gpsDiag.entryCount` — number of entries
- `gpsDiag.download()` — export CSV via share/file save
- `gpsDiag.csv()` — return CSV string

Useful for tuning filter constants across different GPS hardware. The logger is
off by default; enable it from the browser console or Chrome DevTools (via
`chrome://inspect` for Android WebView).

## S-57 Pipeline (tools/s57-pipeline/)
Python CLI for converting NOAA S-57 ENC data → PMTiles vector tiles.
Requires `gdal`, `tippecanoe`, and `uv` installed via brew.

**Important:** `tools/s57-pipeline/data` must be a **symlink** to `tile-data/` at the
project root (created by `build-tiles.sh`). Never create it as a real directory. Always
use `tools/build-tiles.sh` to run tile builds — don't invoke the pipeline CLI directly
for downloads or builds, as it bypasses the symlink setup.

### List attribute encoding
S-57 has list-typed attributes (COLOUR, CATSPM, STATUS, etc.) that ogr2ogr outputs
as JSON arrays (e.g. `["1","11"]`). Since MVT only supports flat values, the pipeline's
`enrich_geojson` step flattens **all** list-valued properties to comma-separated strings
(e.g. `"1,11"`). Front-end code should never expect JSON arrays — always comma-separated
strings or plain integers. The MapLibre style expressions use comma-padding (`",1,11,"`)
for reliable substring matching.

### Tile build scripts
All tile workflows go through `tools/build-tiles.sh` (run `--help` for full usage). Always use that to rebuild tiles, not manual commands. Note that multiple regions can serve overlapping tiles. Client-side rendering is preferred over server-side tile pipeline changes unless explicitly told otherwise, since a full tile rebuild takes 2 hours for the US Eastern seabord.
- `bun run tiles` — build boston-test region (quick dev iteration)
- `bun run tiles:build` — build all production regions
- `bun run tiles:build:fresh` — download ENCs then build all regions
- `bun run tiles:check` — check NOAA for ENC updates (report only)
- `bun run tiles:upload` — upload built tiles to CDN
- `bun run tiles:update` — full unattended cycle (check → download → build → upload)
- `tools/build-tiles.sh --build --region <name>` — build a single region
  - Regions (see `tools/regions.json`, the shared source of truth): `boston-test`,
    `northern-new-england`, `southern-new-england`, `new-york`, `mid-atlantic`,
    `south-atlantic`, `usvi`, `gulf-coast`, `great-lakes`, `ny-inland`, `washington`,
    `oregon`, `northern-california`, `central-california`, `southern-california`, `hawaii`
  - `--force` rebuilds all cells; `--download` downloads ENCs first; `--composite-only` re-composites only
  - Output goes to `public/nautical-<region>.pmtiles`
- `tools/build-tiles.sh --basemap --region <name>` — build the offline street basemap
  (`public/basemap-<region>.pmtiles`) from the Protomaps daily build: z0–13 over a
  10 nm coastal band + z14–15 around US5/US6 harbor cells (takes minutes, no ENC build).
  Needs the region's charts built first, plus `pmtiles` + `tippecanoe` (brew).
  New regions also need a `basemapSizeEstimate` in `src/data/chart-catalog.ts`
  before the basemap download appears in the app's Chart Regions panel.

### Low-level pipeline commands
- `cd tools/s57-pipeline && uv run python -m s57_pipeline download --region <region>` — download ENC cells
- `cd tools/s57-pipeline && uv run python -m s57_pipeline convert -i data/enc/US5MA22M/US5MA22M.000 -o data/tiles/` — convert single cell
- `cd tools/s57-pipeline && uv run python -m s57_pipeline pipeline --region <region> -o <output.pmtiles>` — run full pipeline
- `cd tools/s57-pipeline && uv run pytest` — run pipeline tests

## Android / Capacitor
- `bun run cap:sync` — build web + sync to Android project
- `bun run cap:run` — build, sync, and run on connected device/emulator
- `bun run cap:build` — build, sync, and assemble **release** APK (signed with local keystore)
- `bun run cap:build:debug` — build, sync, and assemble debug APK
- PMTiles, coverage GeoJSON, and search indices are excluded from the Android bundle and Cloudflare
  static-asset upload (served from R2 instead). Vite copies all of `public/` into `dist/` during build
  (no way to exclude files), so the `build` script itself runs
  `rm -f dist/*.pmtiles dist/*.coverage.geojson dist/*.search.json` after `vite build`. Originals in
  `public/` are untouched — the dev server (`bun run dev`) serves from `public/` directly, so running
  `cap:build` or `deploy` while the dev server is active is safe.
- Capacitor builds ship **no service worker** (`disable: isCapacitor` in vite.config.ts) —
  all assets are bundled, so installing a new APK just works with no stale-cache concerns.
  main.ts also unregisters any SW left behind by pre-0.10 installs at startup. The
  "Clear Cache & Reload" button in the About dialog remains as an escape hatch only.
- **Release signing**: keystore at `android/pelorus-release.keystore`, config in
  `android/signing.properties` (both gitignored). To set up on a new machine, generate a
  keystore with `keytool -genkeypair` and create `signing.properties` with storeFile,
  storePassword, keyAlias, keyPassword.
- `tools/upload-apk.sh [--build]` — upload APK to Dropbox (`garyo-dropbox:software/pelorus-nav/`)

### CI release builds
Pushing a `v*` tag triggers `.github/workflows/release.yml`, which produces a **signed** release
APK and publishes it as a GitHub Release (attached asset `app-release.apk`). To cut a new release:

1. Add a `## [X.Y.Z] - YYYY-MM-DD` section to `CHANGELOG.md` — compact and user-focused
   (omit changes users won't notice). This is the single source of truth for the in-app
   "What's New" dialog (`src/ui/WhatsNewDialog.ts`), which shows this version's entry once
   after an update and links to the changelog on GitHub.
2. Bump `version` in `package.json` to `X.Y.Z` — it's the app's `__APP_VERSION__` and what
   "What's New" keys on. Commit both.
3. Tag and push:

```
git tag -a vX.Y.Z -m "Pelorus Nav vX.Y.Z"
git push origin vX.Y.Z
```

The workflow requirements, worth knowing if it ever breaks:
- **Java 21** (not 17) — `capacitor.build.gradle` uses `sourceCompatibility VERSION_21`.
- **Node 22+** — the Capacitor CLI rejects the runner's preinstalled Node 20, so an explicit
  `setup-node@v4` step is required in addition to `setup-bun`.
- **`contents: write` permission** on the job, or `gh release create` returns HTTP 403.
- **`environment: release`** — signing secrets (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
  `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`) live in the `release` GitHub Actions environment,
  restricted to `v*` tag refs so PR workflows can't access them. PKCS12 keystore → store password and
  key password are the same value.

## Tides & Currents
Fully-offline tide and tidal-current predictions, computed client-side with
`@neaps/tide-predictor` from NOAA harmonic constituents bundled in
`public/tides-stations.json`. Overlay: `src/plugins/tides/TidesOverlay.ts`;
prediction core: `src/tides/` (schema, bundle loader, tide/current predictors,
formatters). Toggled by the "Tides & Currents" layer group (default off).

- `bun run tides:build` — regenerate the bundle by crawling NOAA MDAPI
  (~9k calls, ~25 min cold; responses cached in `tools/tides/.cache/` so
  re-runs take seconds). The bundle is committed to git; constituents change
  rarely (regenerate roughly yearly, or when NOAA adds stations).
- `bun tools/tides/make-fixture.ts` — re-extract the unit-test mini-bundle
  (`src/tides/__fixtures__/mini-bundle.json`) after regenerating the bundle.
- Model: reference stations carry harmonic constituents (tides: heights about
  MLLW via per-station datum offset; currents: signed major-axis velocity,
  + = flood toward `floodDir`, − = ebb toward `ebbDir`, zero crossing = slack).
  Subordinate stations apply NOAA time/height(/speed) offsets to their
  reference's events and get events-only predictions (no continuous curve).
- The trend arrows (↑/↓) in tide labels need glyph range `8448-8703.pbf`
  (bundled for Noto Sans Regular).

## Sprites
The app uses a single sprite system: **IHO S-52** (the only symbology scheme).

**S-52 sprites** (`tools/sprites/s52/source/`) — SVGs go in `tools/sprites/s52/source/`, use CSS
color classes (`fCHBLK`, `sCHMGD`, `fISDNG`, etc.) that are replaced per-theme (day/dusk/night/eink).
Named with S-52 symbol codes (e.g., `ISODGR01.svg`). Built into per-theme sheets
(`public/sprites/s52-{day,dusk,night,eink}.{json,png}` + `@2x`).
Color class reference: `tools/sprites/s52/daySvgStyle.css` and `tools/sprites/s52/colours.json`.

**Rebuild sprites** after any change: `bun run sprites`

The active display theme selects which S-52 sheet MapLibre loads. If a symbol is referenced in a
layer's `icon-image` but missing from the sprite sheet, MapLibre will log
"Image could not be loaded" and show nothing.

## Fonts / glyphs
MapLibre label glyphs are **bundled locally** under `public/fonts/{fontstack}/{range}.pbf`, served
same-origin through the `local-glyphs://` protocol (registered in `main.ts`; the style's `glyphs` URL is
set in `ChartManager.buildStyle`). This is required for offline use: the Android WebView has no service
worker, and the old demo-server CDN 404'd some stacks.

- Only the **Noto Sans** family is bundled — `Regular`, `Bold`, `Italic` — ranges `0-255` and `256-511`
  (Latin; enough for US chart text) plus `8448-8703` (tide trend arrows). Every `text-font` in the
  styles must use one of these stacks.
- Text needing a codepoint outside the bundled ranges (e.g. non-Latin place names in the basemap at
  world zooms) renders via MapLibre's **local system-font fallback**, with one console warning per
  codepoint ("glyph range not bundled"). The `local-glyphs` protocol exists to make missing ranges fail
  cleanly: SPA hosting and the Vite dev server answer missing `.pbf` paths with `index.html` + HTTP 200,
  which MapLibre would otherwise parse as protobuf ("Unimplemented type" console spam).
- A `text-font` referencing an unbundled font entirely (e.g. `Open Sans Regular`) falls back the same
  way; when adding a label layer, reuse an existing Noto stack.
- To add a stack/range, download it from `https://demotiles.maplibre.org/font/<stack>/<range>.pbf` into
  `public/fonts/`. The `pbf` extension is in the PWA precache glob (`vite.config.ts`).

## References
- IHO S-52/S-101 symbol SVGs (primary reference): https://github.com/iho-ohi/S-101_Portrayal-Catalogue/tree/main/PortrayalCatalog/Symbols
  - Raw SVG URL pattern: `https://raw.githubusercontent.com/iho-ohi/S-101_Portrayal-Catalogue/main/PortrayalCatalog/Symbols/{SYMBOL_NAME}.svg`
  - Note: these SVGs sometimes simplify shapes (e.g. circles instead of ovals). Cross-reference with
    OpenCPN's chartsymbols.xml HPGL definitions for exact geometry when needed.
- S-52 compliant chart sprites: https://github.com/openwatersio/enc-tiles

## Git
- Conventional commits: `feat:`, `fix:`, `test:`, `chore:`, `docs:`
- **Always** run `bun run check` before committing — this runs typecheck + lint + test.
  Do not substitute individual commands (`typecheck`, `test`) — the full `check` catches
  formatting issues that `typecheck` alone misses.
