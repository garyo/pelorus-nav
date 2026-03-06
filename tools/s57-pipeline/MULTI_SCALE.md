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

### 3. Priority merge (tile-level replacement)
For each tile (z,x,y), keep only the highest-band version. Lower bands
serve as geographic fallback.

**Result: L-shaped coverage gaps at band boundaries.** At z7 near NJ coast,
a higher-band cell only partially covers a tile's geographic area. The
priority merge replaces the lower-band tile entirely, losing coverage in
the uncovered portion. This creates visible L-shaped gaps where one band's
coverage clips the edge of a tile.

**Why it can't be fixed:** Tiles are atomic — you can't merge "part" of a
tile. Either you keep the whole lower-band tile (ghosting) or replace it
entirely (gaps). The boundary problem is fundamental to tile-level replacement.

### 4. Frontend filtering by `_scale_band`
Could we filter to only show `_scale_band == max(band in this tile)`?

**Result: Impossible.** MapLibre style expressions have no aggregate
functions across features in a tile. You can't write
`["==", ["get", "_scale_band"], ["max-in-tile", "_scale_band"]]`.

## Solution: tile-join + Frontend LINE_BAND_FILTER

**Use tile-join for full feature merge (no coverage gaps), then filter
line layers in the frontend to prevent ghosting.**

### How it works:
1. All INTU bands extend to z14 (geographic gap filling)
2. `tile-join` merges all bands' features into each tile
3. **Area fills**: Opaque fills + `fill-sort-key` by `_scale_band` — higher
   bands' fills cover lower bands' fills. No ghosting for areas.
4. **Lines**: `LINE_BAND_FILTER` hides lower-band lines at higher zooms:
   - z0-6: show all lines (overview scale)
   - z7-8: hide band 0 lines (general scale)
   - z9-10: hide bands 0-1 lines (coastal scale)
   - z11+: hide bands 0-2 lines (approach+ scale)

### Implementation:
```typescript
const LINE_BAND_FILTER = [
  ">=",
  ["coalesce", ["get", "_scale_band"], 0],
  ["step", ["zoom"], 0, 7, 1, 9, 2, 11, 3],
];
```
Applied to COALNE, DEPCNT, SLCONS line layers.

### Why it works:
- **No coverage gaps**: tile-join preserves all geographic coverage
- **No line ghosting**: LINE_BAND_FILTER hides stale lower-band lines
- **No area ghosting**: Opaque fills with sort-key handle area compositing
- **Graceful degradation**: In areas with only a lower band at a zoom where
  the filter expects a higher band, lines disappear but fills still define
  the coast shape. This is acceptable — the area is still visible, just
  without redundant coastline strokes.
- **Simple**: No custom merge logic needed in the pipeline

### Trade-offs:
- In transition zones where only a lower band exists, coastline LINES won't
  show (filtered out). But depth area fills still define the coast shape,
  so the chart remains usable.
- The filter thresholds (z7→band 1, z9→band 2, z11→band 3) are tuned for
  the typical INTU distribution in US East Coast data. Other regions may
  need adjustment.
