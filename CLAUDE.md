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
- `src/utils/` — pure utility functions (coordinate math, unit conversion, etc.)
- `tests/e2e/` — Playwright E2E tests
- `tests/unit/` — additional unit tests (prefer colocated `*.test.ts` in src/)
- `public/` — static assets
- `tools/` — offline tools (S-57 pipeline, etc.)

## Testing
- Unit tests: colocate as `*.test.ts` next to source files
- E2E tests: in `tests/e2e/`
- Playwright needs WebGL flags for headless Chromium (configured in playwright.config.ts)
- Use SimulatorProvider for GPS data in tests (no real hardware needed)

## S-57 Pipeline (tools/s57-pipeline/)
Python CLI for converting NOAA S-57 ENC data → PMTiles vector tiles.
Requires `gdal` and `tippecanoe` installed via brew.

- `cd tools/s57-pipeline && uv run python -m s57_pipeline download` — download test ENC cells
- `cd tools/s57-pipeline && uv run python -m s57_pipeline convert -i data/enc/US5MA22M/US5MA22M.000 -o data/tiles/` — convert single cell
- `cd tools/s57-pipeline && uv run python -m s57_pipeline pipeline -i data/enc/ -o ../../public/nautical.pmtiles` — full pipeline
- `cd tools/s57-pipeline && uv run pytest` — run pipeline tests

## Git
- Conventional commits: `feat:`, `fix:`, `test:`, `chore:`, `docs:`
- Run `bun run check` before committing
