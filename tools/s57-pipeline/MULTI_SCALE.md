# Multi-Scale Compositing: MVT-Level M_COVR Clipping

## The Problem

NOAA ENC data comes in 6 scale bands (INTU 1-6). Each band has different
geographic coverage — not every area has every band. We need to display the
best available data at each zoom level without **ghosting** (coarse features
visible behind fine data) or **coverage gaps** (blank areas).

## Approaches Tried & Failed

### 1. Strict non-overlapping zoom ranges
Each INTU band tiles only at its "natural" zoom range. **Result: Coverage
gaps** — at z9 in an area with INTU 1+2 but no INTU 3, the tile is blank.

### 2. All bands extend to z14 + sort-key + opaque fills
`tile-join` merges features from ALL bands into each tile. **Result: Lines
ghost** — coastlines from different bands don't align.

### 3. Naive priority merge (tile-level replacement)
Highest band always wins per tile. **Result: L-shaped gaps** at band
boundaries (tippecanoe generates tiles for minimal feature intersection).

### 4. Priority merge with neighbor/children heuristics
Check neighbors/children before overwriting. **Still unreliable**.

### 5. Feature-level M_COVR clipping (all zooms)
Clip lower-band features by all higher-band M_COVR. **Result: Gaps at low
zooms** — clipping removes features at ALL zoom levels, but higher bands
only have tiles starting at z5-11. At z0-4, nothing fills in.

### 6. Tile-level M_COVR coverage check
Only overwrite when M_COVR fully contains the tile bbox. **Result: At
boundary tiles, forced to pick one band** — either gaps or ghosting.

### 7. Zoom-aware per-segment clipping
Tile each cell multiple times with different clip masks for different zoom
ranges. **Complex and still had boundary issues**.

## Solution: MVT-Level Per-Tile Compositing

The key insight: **do the compositing AFTER tippecanoe, at the MVT tile
level**. Decode individual tiles, clip features to each cell's exact M_COVR
polygon, and composite from multiple cells/bands into a single output tile.

### How it works

Each ENC cell produces its own PMTiles (via tippecanoe), with tiles at
all zoom levels in its range. The compositor then processes every tile
position (z,x,y):

1. Collect all cells that produced a tile at this position
2. Sort by band descending (highest/most-detailed first)
3. `filled = empty polygon`, `output_features = []`
4. For each cell (highest band first):
   - `cell_coverage = cell's M_COVR ∩ tile_bbox`
   - `unfilled = tile_bbox - filled`
   - `usable = cell_coverage ∩ unfilled`
   - If usable is empty → skip this cell
   - Decode MVT, clip features to `usable`
   - Append clipped features to `output_features`
   - `filled = filled ∪ cell_coverage`
   - If filled covers the whole tile_bbox → stop (100% covered)
5. Encode `output_features` as MVT → output tile

### Why this works

- **No ghosting**: At any zoom, features from different bands are
  geometrically clipped to non-overlapping regions within each tile
- **No gaps**: Lower-band features fill areas not covered by higher-band
  M_COVR. Since all bands extend to z14, there is always a lower-band
  tile to fill from
- **Correct compositing**: Each tile gets the best available data —
  higher-band features within their M_COVR, lower-band features outside
- **Per-cell M_COVR**: Uses individual cell coverage polygons, handling
  overlapping cells within the same band correctly
- **Scale transitions**: At M_COVR boundaries, coastlines from different
  bands meet but may not perfectly align. This is normal nautical chart
  behavior (paper chart folio boundaries)

### Performance optimizations

- **Single-source tiles** (no overlap with other cells): passed through
  as raw bytes without any MVT decoding. This is the majority of tiles.
- **Same-band tiles** (multiple cells, same band): features concatenated
  without coverage clipping (no band priority conflict)
- **Multi-band tiles** (boundary tiles): full decode/clip/composite/re-encode.
  Only a small fraction of total tiles.

### Implementation

- `composite.py`:
  - `CellTileSource`: dataclass linking a PMTiles file to its band and M_COVR
  - `composite_tiles()`: main compositing loop over all tile positions
  - `_clip_mvt_features()`: decode MVT, transform pixel→geo coords, clip to region
  - `_encode_mvt()`: encode features back to gzipped MVT
- `coverage.py`:
  - `extract_coverage_polygon()`: M_COVR → Shapely geometry (CATCOV=1 - CATCOV=2)
  - `build_cell_coverage()`: per-cell coverage extraction
- `cli.py`: three-pass pipeline (scan → convert/tile → composite)

### Dependencies

- `shapely>=2.0` for geometric operations (union, difference, intersection)
- `mapbox-vector-tile>=2.0` for MVT decode/encode
- `pmtiles>=3.7.0` for tile archive I/O
