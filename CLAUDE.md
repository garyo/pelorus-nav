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
- `public/` — static assets (PMTiles, sprites, coverage masks)
- `tools/` — offline tools (S-57 pipeline, sprite builder, tile upload/check scripts)

## Testing
- Unit tests: colocate as `*.test.ts` next to source files
- E2E tests: in `tests/e2e/`
- Playwright needs WebGL flags for headless Chromium (configured in playwright.config.ts)
- Use SimulatorProvider for GPS data in tests (no real hardware needed)

## S-57 Pipeline (tools/s57-pipeline/)
Python CLI for converting NOAA S-57 ENC data → PMTiles vector tiles.
Requires `gdal` and `tippecanoe` installed via brew.

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
  - Regions: `southern-new-england`, `northern-new-england`, `new-york`, `mid-atlantic`, `south-atlantic`, `usvi`, `boston-test`
  - `--force` rebuilds all cells; `--download` downloads ENCs first; `--composite-only` re-composites only
  - Output goes to `public/nautical-<region>.pmtiles`

### Low-level pipeline commands
- `cd tools/s57-pipeline && uv run python -m s57_pipeline download --region <region>` — download ENC cells
- `cd tools/s57-pipeline && uv run python -m s57_pipeline convert -i data/enc/US5MA22M/US5MA22M.000 -o data/tiles/` — convert single cell
- `cd tools/s57-pipeline && uv run python -m s57_pipeline pipeline --region <region> -o <output.pmtiles>` — run full pipeline
- `cd tools/s57-pipeline && uv run pytest` — run pipeline tests

## Android / Capacitor
- `bun run cap:sync` — build web + sync to Android project
- `bun run cap:run` — build, sync, and run on connected device/emulator
- `bun run cap:build` — build, sync, and assemble debug APK
- PMTiles and coverage GeoJSON are excluded from the Android bundle (stripped from `dist/`)
- Vite copies all of `public/` into `dist/` during build (no way to exclude files). The cap scripts
  then `rm -f dist/*.pmtiles dist/*.coverage.geojson` before syncing to Android to keep the APK small.
  The originals in `public/` are untouched — the dev server (`bun run dev`) serves from `public/` directly,
  so running `cap:build` while the dev server is active is safe.

## Sprites
The app uses **two separate sprite systems** — both must be updated when adding a new symbol:

1. **Nautical sprites** (`tools/sprites/svg/`) — used by Pelorus Standard and Minimal symbology.
   SVGs go in `tools/sprites/svg/`, use hardcoded colors, named `ecdis-*.svg`.

2. **S-52 sprites** (`tools/sprites/s52/source/`) — used by IHO S-52 symbology.
   SVGs go in `tools/sprites/s52/source/`, use CSS color classes (`fCHBLK`, `sCHMGD`, `fISDNG`, etc.)
   that are replaced per-theme (day/dusk/night/eink). Named with S-52 symbol codes (e.g., `ISODGR01.svg`).
   Color class reference: `tools/sprites/s52/daySvgStyle.css` and `tools/sprites/s52/colours.json`.

**Rebuild sprites** after any change: `bun run sprites`

The active symbology scheme determines which sprite sheet MapLibre loads. If a symbol is referenced in a
layer's `icon-image` but only exists in the wrong sprite sheet, MapLibre will log
"Image could not be loaded" and show nothing.

## References
- IHO S-52/S-101 symbol SVGs (primary reference): https://github.com/iho-ohi/S-101_Portrayal-Catalogue/tree/main/PortrayalCatalog/Symbols
  - Raw SVG URL pattern: `https://raw.githubusercontent.com/iho-ohi/S-101_Portrayal-Catalogue/main/PortrayalCatalog/Symbols/{SYMBOL_NAME}.svg`
  - Note: these SVGs sometimes simplify shapes (e.g. circles instead of ovals). Cross-reference with
    OpenCPN's chartsymbols.xml HPGL definitions for exact geometry when needed.
- S-52 compliant chart sprites: https://github.com/openwatersio/enc-tiles

## Git
- Conventional commits: `feat:`, `fix:`, `test:`, `chore:`, `docs:`
- Run `bun run check` before committing
