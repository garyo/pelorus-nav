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

### Tile build scripts (preferred)
- `bun run tiles:eastcoast` — build all east coast regions (SNE, NNE, NY, Mid-Atlantic, South Atlantic)
- `bun run tiles:usvi` — build USVI region
- `bun run tiles:all` — build all regions including USVI
- `bun run tiles:all:fresh` — download ENCs then build all regions
- `tools/build-tiles.sh <region> [--download] [--force]` — build a single region
  - Regions: `southern-new-england`, `northern-new-england`, `new-york`, `mid-atlantic`, `south-atlantic`, `usvi`, `boston-test`
  - `--force` rebuilds all cells; `--download` downloads ENCs first
  - Output goes to `public/nautical-<region>.pmtiles`
- `bun run tiles:upload` — upload built tiles to CDN
- `bun run tiles:check` — check for NOAA ENC updates
- `bun run tiles:update` — check, rebuild, and upload if updates found

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

## Git
- Conventional commits: `feat:`, `fix:`, `test:`, `chore:`, `docs:`
- Run `bun run check` before committing
