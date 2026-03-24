# End-to-End ENC to Rendering Dataflow

## Step 1: S-57 ENC files (source data)
- **Format**: S-57 binary vector data (OGR-readable)
- **What they are**: Each `.000` file is a single chart cell — DEPARE (depth areas), COALNE (coastlines), SOUNDG (soundings), buoys, lights, etc.
- **Metadata**: Each cell has DSID_INTU (intended use scale 1-6) and M_COVR (coverage polygon with CATCOV=1/2)
- **No clipping**: Raw source, each cell covers its own geographic extent

## Step 2: ogr2ogr -> GeoJSON (per cell, per layer)
- **Tool**: `ogr2ogr` (GDAL)
- **Format**: Vector -> Vector (S-57 binary -> GeoJSON text)
- **What happens**: Each S-57 layer (DEPARE, COALNE, etc.) extracted to a separate `.geojson` file
- **No clipping**: Extracts all features as-is from the cell. RFC7946 (WGS84 lon/lat)
- **Bounds**: Features carry their original geometry from the ENC cell

## Step 3: GeoJSON enrichment (per cell, per layer)
- **Tool**: Python (our code)
- **Format**: Vector (GeoJSON modified in-place)
- **What happens**:
  - `enrich_geojson`: Single-pass enrichment that adds:
    - `tippecanoe.minzoom` from SCAMIN attribute + cell's INTU zoom range
    - `_scale_band` and `_cell_id` properties (source cell identification)
    - `LABEL` text for lights, buoys, seabed
    - List-attribute flattening (JSON arrays → comma-separated strings)
  - `correlate_topmarks`: Marks buoy/beacon features with co-located TOPMAR
  - `annotate_enclosing_depth`: Adds `_enclosing_depth` to hazard features for isolated danger detection
- **No clipping**: Features retain their full geometry

## Step 4: tippecanoe -> PMTiles (per cell, per layer)
- **Tool**: `tippecanoe` (felt/tippecanoe)
- **Format**: Vector -> Vector tiles (GeoJSON -> PMTiles containing MVT protobuf tiles)
- **What happens**: Generates a tile pyramid from `min_zoom` to `max_zoom` (from INTU ranges). Each tile is a self-contained MVT (Mapbox Vector Tile) — a binary protobuf blob containing clipped, simplified geometry for that tile's geographic extent
- **Clipping**: tippecanoe clips features to tile boundaries (with configurable buffer). Features that intersect a tile are included, even if they barely touch it
- **Simplification**: At lower zoom levels, tippecanoe simplifies geometry and drops low-priority features to manage tile size
- **Tile grid**: Web Mercator global grid — tiles are aligned to standard (z,x,y) positions, not to ENC cell boundaries. If a feature crosses a tile boundary, it gets clipped and included in both tiles.
- **Output**: One `.pmtiles` per layer per cell (e.g., `data/work/US2EC03M/tiles/depare.pmtiles`)

## Step 5: M_COVR-aware tile compositing
- **Tool**: Python (`composite.py` — `mapbox_vector_tile` for MVT decode/encode, `pmtiles` for tile I/O, `shapely` for geometric clipping)
- **Format**: Vector tiles -> Vector tiles (PMTiles -> single PMTiles)
- **What happens**: For each tile position (z,x,y) across all cells:
  1. Collect all cells that produced a tile at this position
  2. Sort by band descending (highest/most-detailed first)
  3. Track a "filled" polygon (starts empty)
  4. For each cell (highest band first):
     - `cell_coverage = cell's M_COVR ∩ tile_bbox`
     - `unfilled = tile_bbox - filled`
     - `usable = cell_coverage ∩ unfilled`
     - If usable is empty → skip this cell
     - Decode MVT, clip features to `usable`
     - Append clipped features to output
     - `filled = filled ∪ cell_coverage`
     - If filled covers the whole tile_bbox → stop (100% covered)
  5. Encode composited features as MVT → output tile
- **Fast paths**:
  - Single-source tiles (no overlap): passed through as-is, no decode needed
  - Same-band multiple cells: features concatenated without coverage clipping
  - Multi-band tiles: full decode/clip/composite/re-encode
- **Output**: Single `nautical.pmtiles` with all cells composited

### Why this works
- **No ghosting**: At any zoom, features from different bands are geometrically clipped to non-overlapping regions within each tile
- **No gaps**: Lower-band features fill areas not covered by higher-band M_COVR. Since all bands extend to z14, there is always data available at every zoom level
- **Correct compositing**: Each tile gets the best available data — higher-band features within their M_COVR, lower-band features outside
- **Per-cell M_COVR**: Uses each individual cell's coverage polygon (not per-band union), so overlapping cells within the same band are handled correctly

### Performance
- The majority of tiles are single-source (no overlap) and pass through without MVT decoding
- Only tiles at band boundaries require full decode/clip/re-encode
- The decode/clip/encode is done in pure Python (mapbox-vector-tile), which is slower than C but adequate for offline pipeline use

## Step 6: MapLibre GL JS rendering (frontend)
- **Format**: Vector tiles -> Raster (GPU rendering to screen)
- **What happens**: MapLibre fetches tiles from PMTiles, applies style rules (fill colors, line styles, symbol placement), renders to WebGL canvas
- **Each tile rendered independently**: MapLibre renders all features in a tile. No need for cross-tile or cross-band logic — the compositing step already ensured each tile has exactly the right features.

## Pipeline architecture

```
Pass 1: Scan
  For each ENC cell:
    - Read DSID_INTU → scale band
    - Extract M_COVR → per-cell coverage polygon
    - Compute INTU zoom ranges (with --zoom-shift, default 2)

Pass 2: Convert & Tile (parallel, skippable with --composite-only)
  For each ENC cell:
    - ogr2ogr → GeoJSON (step 2)
    - Enrich GeoJSON (step 3)
    - tippecanoe → PMTiles (step 4)
    - Incremental: skips cells where tiles are newer than source

Pass 3: Composite (step 5)
  - Read all per-cell PMTiles
  - For each (z,x,y): composite by M_COVR coverage priority
  - Write single output PMTiles
```

## CLI flags

| Flag | Description |
|------|-------------|
| `--region`, `-r` | Named region to filter cells (e.g., `boston-test`) |
| `--force`, `-f` | Force rebuild all cells (skip incremental check) |
| `--composite-only` | Skip Pass 2, only re-run compositing |
| `--zoom-shift N` | Shift INTU zoom ranges down by N levels (default: 2) |
| `--debug-latlon lat,lon` | Print detailed compositing info for tiles at this point |
| `--jobs`, `-j` | Parallel workers for Pass 2 (default: auto) |
