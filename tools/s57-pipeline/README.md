# S-57 → PMTiles Pipeline

Converts NOAA S-57 ENC (Electronic Navigational Chart) data into PMTiles
vector tiles for use with MapLibre GL JS in Pelorus Nav.

## Prerequisites

```bash
brew install gdal tippecanoe
```

## Usage

```bash
cd tools/s57-pipeline

# Download test ENC cells from NOAA
uv run python -m s57_pipeline download --output data/enc/

# Convert a single ENC cell (for testing)
uv run python -m s57_pipeline convert --input data/enc/US5MA22M/US5MA22M.000 --output data/tiles/

# Full pipeline: all ENCs in a directory → single PMTiles
uv run python -m s57_pipeline pipeline --input data/enc/ --output ../../public/nautical.pmtiles
```

## Testing

```bash
uv run pytest
```

## Pipeline Steps

1. **Download** — Fetch ENC .zip files from NOAA, extract .000 files
2. **Convert** — ogr2ogr converts S-57 layers to GeoJSON (with SCAMIN → minzoom)
3. **Tile** — tippecanoe converts each GeoJSON layer to PMTiles with layer-specific settings
4. **Merge** — tile-join combines per-layer PMTiles into a single file

## Layer Groups

| Group | Layers | Strategy |
|-------|--------|----------|
| Terrain | DEPARE, LNDARE, LAKARE, RIVERS, DRGARE, UNSARE | coalesce-densest |
| Lines | DEPCNT, COALNE, SLCONS | coalesce-densest |
| Dense points | SOUNDG | drop-densest |
| Nav aids | BOYLAT, BOYCAR, BCNLAT, BCNCAR, LIGHTS, FOGSIG | keep all (-r1) |
| Hazards | WRECKS, OBSTRN, UWTROC, ROCKAL | keep all (-r1) |
| Regulatory | TSSLPT, RESARE, ACHARE, FAIRWY, CTNARE | coalesce-densest |
| Infrastructure | BRIDGE, CBLOHD, CBLSUB, MORFAC, PONTON | default |
