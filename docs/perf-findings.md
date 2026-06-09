# Performance deep-dive: settings/layer change lag

_Investigated live (browser-harness against `bun dev`), CPU-profiled via CDP, and
confirmed with controlled experiments — no assumptions. All numbers from an
M1 dev machine, Boston harbor @ z14, symbology `iho-s52`._

## Headline

**Every settings change freezes the main thread for ~620 ms** (worst observed
2.9 s at max detail). The cause is the chart style carrying **~2436 layers** —
**16 full copies of the ~143-layer S-52 set, one per chart region** — even though
only the *active* region is ever visible. Each settings change reconstructs all
2436 layer specs (`buildStyle`, ~520 ms) and then `setStyle({diff:true})`
serializes + diffs all 2436 (~100 ms).

## Measurements

| Action | Main-thread block |
|---|---|
| Toggle a layer group (Routing/Anchorage) | **560–760 ms** (one spike 2.4 s) |
| Change display theme | ~620 ms |
| Drag detail-level slider (1 tick) | **2.9 s** (more layers at high detail) + 645 ms trailing |
| `setStyle({diff:true})` of an *identical* full style (diff machinery only) | 100 ms |
| `getStyle()` serialize | 1.6 ms |
| **`setLayoutProperty` visibility — 1 layer** | **0.1 ms** |
| **`setLayoutProperty` visibility — 15 layers** | **0.5 ms** |

### CPU profile of one toggle (top self-time)
All in `maplibre-gl.js`, all style-diff/serialization over the full layer set:
`j` 195 ms · `_serializedAllLayers` 115 ms · `_serializeByIds` 76 ms ·
`areTilesLoaded` 70 ms · `serialize` ~40 ms · `patchUpdatedImages` 25 ms.

### Layer inventory
16 region prefixes × ~143 layers (`getNauticalLayers` set), active region only =
`northern-new-england`. The other 15 regions' ~2150 layers are present in the
style but render nothing unless you pan into that region (and the app only ever
shows one region at a time; see `RegionAutoSwitch`).

### Proof the fix works (live experiment)
Reduced the running style to the active region's layers only:

| | Full (2852 layers*) | Active-region-only |
|---|---|---|
| `setStyle` no-op diff | 100.6 ms | **17.2 ms** (~6×) |
| active region still renders | — | ✅ |

_*count was 2852 mid-experiment because detail level was bumped; baseline is 2436._

Since `buildStyle` scales linearly with the region loop, generating 1 region
instead of 16 cuts the ~520 ms construction proportionally.
**Projected: ~620 ms → ~50 ms per settings change (~12×).**

## Root cause (code)

`src/chart/VectorChartProvider.ts` `getLayers()` loops over **all
`CHART_REGIONS`** and calls `getNauticalLayers()` (a ~143-layer S-52 set) for
each, prefixing ids by region. `src/chart/ChartManager.ts` `onSettingsChange`
funnels *every* tracked setting change (layer groups, theme, depth unit, scales,
detail, …) through `throttledRefreshStyle` → `buildStyle` (calls `getLayers`) →
`map.setStyle(style, {diff:true})`. So one checkbox click rebuilds + diffs all
16 regions.

Layer-group gating is by **inclusion/exclusion** (`getNauticalLayers` `.filter`
drops a group's layers), so a toggle changes layer *structure* → forces the diff
path rather than a cheap visibility flip.

## Recommendations (priority order)

1. **[Biggest, ~12×] Generate layers for the active region only.**
   In `getLayers()`, build layers for `getSettings().activeRegion` (optionally
   plus regions whose bbox intersects the current viewport, for boundary
   quilting). `getSources()` can stay (source defs are cheap; tiles lazy-load).
   `ChartManager` already rebuilds on `activeRegion` change, so switching regions
   swaps the set. Cuts 2436 → ~143 layers → faster settings changes, initial
   load, every-frame render, and memory.
   - **Risk:** at a region boundary, a neighbor wouldn't render. Mitigated by the
     existing region auto-switch; for true edge quilting, include
     viewport-overlapping neighbors (rebuild on cross-boundary pan).
   - **Decision needed:** active-only (simplest) vs active + overlapping
     neighbors (preserves boundary quilting, more code).

2. **[High] Apply non-structural settings without a full rebuild.**
   `ChartManager.onSettingsChange` already knows *which* `prev*` changed — route
   the cheap ones to targeted MapLibre calls instead of `setStyle`:
   - **Layer-group toggles** → keep the layers in the style and flip
     `visibility` (`setLayoutProperty`). 0.5 ms vs 620 ms. (Requires switching
     group gating from filter-out to visibility.)
   - **textScale / iconScale** → `setLayoutProperty` `text-size`/`icon-size`,
     ideally live during the drag.
   - **theme / depth colors** → `setPaintProperty` on affected layers (or accept
     a rebuild, which on the reduced layer set is only ~50 ms).
   Can land incrementally; layer-group + scale toggles are the easy wins.

3. **[Medium] Debounce slider `input`** (or apply live via paint/layout props) so
   dragging gives smooth feedback instead of a freeze on the first tick + a
   trailing rebuild.

4. **[Lower] Memoize `getNauticalLayers`** per (region, relevant settings) —
   limited value once the region count is fixed by #1.

#1 + #2 together would take most settings changes from ~620 ms to low-single-digit
ms.

## Verification notes for whoever implements this
- Per-region render check is automatable (load each region, confirm features
  render); **boundary quilting** when panning across regions needs a human eyeball.
- Keep the careful S-52 layer ordering / collision priority intact (the order in
  `getNauticalLayers` is load-bearing — see its header comment).
- Re-run the same harness measurements (toggle, theme, slider) to confirm the
  before/after numbers.
