# Multi-Scale Compositing: Failure Modes & Solution

## The Problem

NOAA ENC data comes in 6 scale bands (INTU 1-6). Each band has different
geographic coverage — not every area has every band. We need to display the
best available data at each zoom level without **ghosting** (coarse features
visible behind fine data) or **coverage gaps** (blank areas).

## Approaches Tried

### 1. Strict non-overlapping zoom ranges (enc-tiles approach)
Each INTU band tiles only at its "natural" zoom range.
- INTU 1 (Overview): z0-6
- INTU 2 (General): z7-8
- INTU 3 (Coastal): z9-10
- INTU 4 (Approach): z11-12
- INTU 5 (Harbour): z13-14

**Result: Coverage gaps.** At z9 in an area with INTU 1+2 but no INTU 3
(e.g., parts of Maine coast), the tile is blank. MapLibre can't overzoom
from a single merged source because other areas DO have z9 tiles.

### 2. All bands extend to z14 + sort-key + opaque fills
Every INTU band generates tiles from its minzoom up to z14. Features carry
`_scale_band` property. Fill layers use `fill-sort-key` so higher bands
render on top. DEPARE fills set to opacity 1.0 to cover lower-band fills.

**Result: Fills mostly work, but LINES GHOST.** `tile-join` merges features
from ALL bands into each tile. At z11 near Boston, a single tile contains
COALNE (coastline) features from INTU 1, 2, 3, AND 5. The sort-key controls
render ORDER but doesn't hide lower-band features. Line layers (COALNE,
DEPCNT, SLCONS) from all bands render simultaneously, creating visible
"echoes" of coastlines at different scales.

**Why sort-key can't fix lines:** Sort-key orders features within a layer
but doesn't make low-sort features invisible where high-sort features exist.
An opaque polygon from band 5 covers band 1's polygon, but band 1's
coastline LINES still show through because lines don't occlude each other.

### 3. Frontend filtering by `_scale_band`
Could we filter to only show `_scale_band == max(band in this tile)`?

**Result: Impossible.** MapLibre style expressions have no aggregate
functions across features in a tile. You can't write
`["==", ["get", "_scale_band"], ["max-in-tile", "_scale_band"]]`.

## Solution: Priority Merge

**Each tile should contain features from exactly ONE band — the highest
available.** This is done at the pipeline merge step.

### How it works:
1. After tiling each cell, group per-cell PMTiles by INTU band
2. `tile-join` within each band (same-band cells are same scale, no ghosting)
3. **Priority merge** across bands: for each tile (z,x,y), keep ONLY the
   highest-band version. Lower bands serve as fallback where higher bands
   have no coverage.

### Why it works:
- **No ghosting**: Each tile has exactly one band's features
- **No coverage gaps**: Lower bands extend to z14 as fallback, but are
  superseded wherever higher bands exist
- **Simple frontend**: Single source, no multi-band layer tricks needed
- **Correct behavior**: At scale boundaries, there's a visible scale jump
  (e.g., INTU 5 tile next to INTU 3 tile). This is normal nautical chart
  behavior — it's how paper charts work at folio boundaries.

### Implementation:
- `merge.py`: New `merge_tiles_priority()` function
  1. Groups input PMTiles by `_scale_band` (read from tile metadata or
     tracked during processing)
  2. Runs `tile-join` per band
  3. Iterates all tiles using pmtiles Python library
  4. For each (z,x,y), writes highest-band tile to output
- Pipeline tracks each cell's band alongside its PMTiles paths
- Frontend can remove sort-key complexity (each tile is single-band)
