# NOAA ENC Data Notes

## Cell Naming
- **Old scheme**: `US{band}{state}{number}` e.g. `US5MA22M` (Band 5, Massachusetts, cell 22)
- **New Harmonized (NH) scheme**: `US{band}NH1{grid}` e.g. `US4NH1BC` — NOAA is re-scheming all ENCs
- NH catalog: `https://charts.noaa.gov/ENCs/NH_ENCProdCat.xml`
- Old catalog: `https://charts.noaa.gov/ENCs/ENCProdCat_19115.xml` (ISO 19115 XML)

## Scale Bands
| Band | Scale Range | Usage | Tile zoom approx |
|------|------------|-------|-----------------|
| 1 | < 1:1.5M | Overview | z0-5 |
| 2 | 1:600K-1.5M | General | z5-8 |
| 3 | 1:150K-600K | Coastal | z8-10 |
| 4 | 1:50K-150K | Approach | z10-12 |
| 5 | 1:5K-50K | Harbor | z12-14+ |
| 6 | > 1:5K | Berthing | z14+ |

## Compilation Scale (DSPM_CSCL)
Read from DSID record: `ogrinfo -ro -al <file> DSID | grep DSPM_CSCL`
- US2EC04M: 1:675,000 (Band 2)
- US4MA14M: 1:80,000 (Band 4) — covers Cape Cod Canal area only
- US5MA22M: 1:40,000 (Band 5) — covers Buzzards Bay, NOT Boston Harbor

## Cells Covering Boston Harbor (-71.06, 42.36)
From NH catalog search:
- US2EC03M (1:1,200,000) — Cape Sable to Cape Hatteras
- US2EC04M (1:675,000) — West Quoddy Head to New York
- US3EC10M (1:350,000) — Bay of Fundy to Cape Cod

**No Band 4 or 5 NH cells found covering Boston yet.** The NH re-scheming may not be complete for this area, or the old-scheme cells may still be the ones to use.

## Old-Scheme Cells for Boston Area
Old-scheme cells are still downloadable from NOAA even though they're not in the NH catalog.
Many Band 4/5 cells exist — probed `US5MA{10..34}M` and `US4MA13M`.

### Cells covering Boston Harbor (-71.06, 42.36):
- **US4MA13M** (1:80,000) — lon [-71.11, -70.00] lat [42.00, 42.67] — Mass Bay approach, has COALNE + LNDARE
- **US5MA10M** (1:25,000) — lon [-71.08, -70.73] lat [42.32, 42.41] — Boston Harbor, has COALNE + LNDARE
- **US5MA11M** (1:10,000) — lon [-71.12, -70.95] lat [42.32, 42.42] — Inner Boston Harbor, has COALNE + LNDARE
- **US5MA12M** (1:25,000) — lon [-71.08, -70.73] lat [42.21, 42.33] — South of Boston Harbor
- **US5MA17M** (1:25,000) — lon [-71.00, -70.73] lat [42.36, 42.59] — North Shore

### Other Band 5 MA cells found:
US5MA10M through US5MA34M exist (with some gaps). Coverage varies — many are Cape Cod / south shore.

## S-57 Layer Notes
- Not all cells have all layers. E.g. US5MA22M has no COALNE or LNDARE.
- Band 5 harbor cells may rely on Band 3/4 approach cells for coastline.
- SCAMIN attribute is often absent, especially on COALNE/LNDARE.
- When SCAMIN is absent, the cell's DSPM_CSCL should be used as fallback.

## Multi-Scale Compositing Strategy
The key challenge is compositing data from multiple scale bands without:
1. Coarse polygons (DEPARE, LNDARE) overlaying fine-detail data at high zoom
2. Gaps when zooming past a cell's detail level with no finer data available

**Solution**: Use tippecanoe `maxzoom` on **terrain polygon layers only** (DEPARE, LNDARE,
LAKARE, RIVERS, DRGARE, UNSARE, and regulatory areas). Lines (COALNE, DEPCNT) and
points (SOUNDG, buoys, lights) do NOT get maxzoom — they just overlay without conflict.

This means:
- Band 2 DEPARE/LNDARE disappears at z10, replaced by Band 4 data
- Band 4 DEPARE/LNDARE disappears at z13, replaced by Band 5 data
- Band 2 COALNE stays visible at all zooms (coarse but better than nothing)
- Band 4/5 COALNE overlays at higher zooms with more detail

## Coverage Extents (from our test cells)
- US2EC04M COALNE: lon [-74.17, -68.50] lat [39.72, 44.80] (347 features) — full east coast
- US4MA14M COALNE: lon [-70.73, -70.20] lat [41.70, 42.14] (259 features) — Cape Cod only
- US5MA22M: no COALNE/LNDARE at all

## Download URLs
- Individual cell: `https://charts.noaa.gov/ENCs/{CELLNAME}.zip`
- State package: available via chart downloader at `https://charts.noaa.gov/ENCs/ENCs.shtml`
