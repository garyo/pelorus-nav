# Pelorus Nav

An open-source web-based marine chartplotter. Runs in any browser as a progressive web app — designed for phones, tablets, desktops, and e-ink devices on sailboats.

**Live demo**: [pelorus-nav.garyo.workers.dev](https://pelorus-nav.garyo.workers.dev/)

## Features

- **NOAA vector charts** — S-57 ENC data rendered as vector tiles with nautical symbology
- **Depth soundings** — with configurable units (meters, feet, fathoms)
- **Nav aids** — buoys, beacons, lights, fog signals with ECDIS-style symbology
- **Feature info** — tap any chart object to see its attributes
- **Detail level control** — adjustable from minimal to full chart detail
- **Multi-scale quilting** — seamless display across overview, coastal, and harbor chart scales
- **Fast** — PMTiles format with HTTP range requests, no tile server needed

## Tech Stack

- **TypeScript** (strict) + **Vite** + **Bun**
- **MapLibre GL JS** for map rendering
- **PMTiles** for efficient vector tile serving
- **Cloudflare Workers + R2** for deployment
- **Biome** for linting/formatting
- **Vitest** + **Playwright** for testing

## Getting Started

```bash
# Install dependencies
bun install

# Start dev server
bun dev

# Run checks
bun run check        # typecheck + lint + test
```

## Chart Data Pipeline

The S-57 pipeline converts NOAA ENC data into vector tiles. Requires `gdal`, `tippecanoe`,
and [`uv`](https://docs.astral.sh/uv/) (for the Python pipeline):

```bash
brew install gdal tippecanoe uv

# Generate vector tiles for the boston-test region (quick dev iteration)
bun run tiles

# Download ENCs then build all production regions
bun run tiles:build:fresh

# Build all production regions (ENCs already downloaded)
bun run tiles:build
```

See `tools/s57-pipeline/` for the Python pipeline code.

## Sideloading Charts

Chart Regions → **Load from File…** imports a `.pmtiles` file straight into the
app's offline storage — handy for installing charts on a boat tablet without
re-downloading over cellular. Any chart the app knows (region charts, street
basemaps, and raster charts like `rnc-bvi.pmtiles`) works offline immediately
after import.

Bring-your-own charts — e.g. the satellite-imagery `.mbtiles` collections
cruisers share (Sat2Chart, Soggy Paws, sv Ocelot) — are on the roadmap but not
rendered yet: today the map only draws charts in its catalog, so an imported
file with an unknown name is stored but not displayed. When that lands, the
conversion step is one line with the [pmtiles CLI](https://github.com/protomaps/go-pmtiles):

```bash
pmtiles convert charts.mbtiles charts.pmtiles   # brew install pmtiles
```

Raster charts you build yourself with `tools/rnc-pipeline/convert-kap.py`
(any georeferenced BSB/KAP) can be added to `RASTER_CHARTS` in
`src/data/chart-catalog.ts` — see the BVI chart entry for the pattern.

## Scripts

| Command | Description |
|---------|-------------|
| `bun dev` | Start dev server |
| `bun run build` | Production build |
| `bun run check` | Typecheck + lint + test |
| `bun run tiles` | Generate tiles (boston-test region) |
| `bun run tiles:build` | Generate tiles (all production regions) |
| `bun run tiles:build:fresh` | Download ENCs then build all regions |
| `bun run tiles:upload` | Upload tiles to R2 |
| `bun run deploy` | Build and deploy to Cloudflare Workers |

## Architecture

See [PLAN.md](PLAN.md) for the full roadmap and architecture decisions.

## License

MIT
