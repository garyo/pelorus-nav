# Pelorus Nav

An open-source web-based marine chartplotter. Runs in any browser as a progressive web app — designed for phones, tablets, desktops, and e-ink devices on sailboats. Dedicated app versions for Android and iOS have even more features.

I aim for the highest quality software in all projects, including this one. All code is thoroughly tested at all levels, including back end tile pipelines and end-to-end app tests. All code is linted and type-checked, and frequently reviewed and refactored when needed to reduce technical debt.

**Live demo**: [pelorus-nav.garyo.workers.dev](https://pelorus-nav.garyo.workers.dev/)

## Features

- **Routes and waypoints**, including import/export and folders for long trips
- **Track recording** (works in app versions only)
- **Track playback**, including import/export
- **Big instruments** for easy visibility while sailing
- **More instruments** added when navigating (VMG, course to steer etc.)
- **Search** for anything on the charts, worldwide
- **Detailed info** for all chart items (buoys/lights/etc.)
- **All NOAA S-57 entities decoded and shown using proper S-52 symbology**
- **Multi-scale quilting** — seamless display across overview, coastal, and harbor chart scales
- **Tides, currents and wind** (wind requires network), including future predictions
- **Crew Overboard** tracking
- **Themes**: Day, Dusk, Night and E-Ink
- **Download regions** to work 100% offline
- **Sunrise/set**
- **GPS: built-in device or various external options** (Signal K, Bluetooth, BLE)
- **Settings**: layers, text & icon sizes, detail level control

## Tech Stack

- **TypeScript** (strict) + **Vite** + **Bun**
- **MapLibre GL JS** for map rendering
- **PMTiles** for efficient vector tile serving
- **Cloudflare Workers + R2** for deployment
- **Biome** for linting/formatting
- **Vitest** + **Playwright** for testing

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
as a dashed magenta outline so it stays findable. To make such a chart
visible at lower zooms too, add overview levels to the mbtiles before
converting:

```bash
gdaladdo -r average charts.mbtiles 2 4 8 16   # brew install gdal
```

**Packing a whole collection**: cruiser chart collections are often dozens of
tiny single-anchorage mbtiles per country — tedious to convert and import
one at a time. `tools/pack-charts.ts` lists, filters, and merges them into
one importable archive (later files win where tiles overlap):

```bash
# See what's in a folder (recursive), with bounds and zoom ranges
bun tools/pack-charts.ts ~/Downloads/Greece --list

# Pack everything into one archive, with overview zooms down to z12 so
# every chart is visible (as imagery or footprint) when zoomed out
bun tools/pack-charts.ts ~/Downloads/Greece --overviews 12 \
    --name "Greece Anchorages" -o greece.pmtiles

# Only the charts intersecting an area (W,S,E,N)
bun tools/pack-charts.ts ~/Downloads/Greece --bounds 24,36,27,38 -o cyclades.pmtiles
```

Requires the `pmtiles` CLI; `--overviews` also needs `gdal` (both via brew).
One import then carries the whole collection, and the in-app footprint
outline shows every chart patch at planning zooms.

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

## Development

### Getting Started

```bash
# Install dependencies
bun install

# Start dev server
bun dev

# Run checks
bun run check        # typecheck + lint + test
```


### Scripts

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
