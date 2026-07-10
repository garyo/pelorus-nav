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

## Importing Your Own Charts

Chart Regions → **Load from File…** imports a `.pmtiles` file straight into
the app's offline storage. Catalog charts (region charts, street basemaps,
RNCs) simply become available offline — handy for installing charts on a boat
tablet without re-downloading over cellular.

**Bring-your-own raster charts work too**: any raster PMTiles the catalog
doesn't know — e.g. the satellite-imagery `.mbtiles` collections cruisers
share (Sat2Chart, Soggy Paws, sv Ocelot) — is read on import (bounds, zoom
range, name) and rendered like any other chart, quilted with the vector ENC.
The conversion step is one line with the
[pmtiles CLI](https://github.com/protomaps/go-pmtiles):

```bash
pmtiles convert charts.mbtiles charts.pmtiles   # brew install pmtiles
```

An archive is only visible within its own zoom range — a z17-only satellite
export shows nothing when zoomed out (raster tiles can't be drawn below
their native zoom). Below a chart's minimum zoom the app draws its footprint
as a dashed magenta box so it stays findable. To make such a chart visible
at lower zooms too, add overview levels to the mbtiles before converting:

```bash
gdaladdo -r average charts.mbtiles 2 4 8 16   # brew install gdal
```

**Getting charts onto a phone or tablet**: convert on a desktop, then move
the `.pmtiles` to the device — cloud storage (Google Drive, Dropbox; iCloud
on iOS), a USB cable, or a direct download all work. "Load from File…" opens
the system file picker, which shows installed cloud providers directly. For
multi-GB archives, download the file to the device first (browser or Files
app) and import from Downloads — picking straight from a cloud provider
downloads the whole file inside the picker with no progress indication.
Importing copies the chart into the app's own storage, so a large chart
briefly exists twice on the device.

Vector (MVT) archives are stored but not drawn — the app has no style for
arbitrary vector data. Raster charts you build yourself with
`tools/rnc-pipeline/convert-kap.py` (any georeferenced BSB/KAP) can either be
imported the same way or added to `RASTER_CHARTS` in
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
