# Custom Region & ENC Import — Feature Plan

## Problem Statement

Pelorus Nav currently supports only pre-built NOAA ENC regions (US coastal waters).
Users who purchase ENC data from other hydrographic offices (UKHO, BSH, SHOM,
Kartverket, etc.) have no way to use it in the app. We want to let users import
their own S-57 `.000` files and see them rendered on the chart.

## Background: What the Pipeline Does

The existing S-57 pipeline (`tools/s57-pipeline/`) converts ENC cells through four passes:

1. **Scan** — read DSID metadata (INTU, CSCL) and M_COVR coverage polygons
2. **Convert** — `ogr2ogr` extracts 52 S-57 layers → GeoJSON
3. **Enrich** — flatten list attributes, compute SCAMIN→minzoom, generate labels
4. **Tile** — `tippecanoe` converts GeoJSON → PMTiles per layer
5. **Composite** — M_COVR-aware MVT compositing across scale bands → single PMTiles

Steps 1 and 2 depend on GDAL. Steps 3-5 are data transformation. Only the
*download* step is NOAA-specific — the conversion logic is S-57 standard and
works with any hydrographic office's data.

### What Users Would Provide

A folder (or zip) of S-57 `.000` files at various scales, possibly with update
files (`.001`, `.002`). European vendors typically deliver these as:

- **Unencrypted S-57** — ready to process (some free sources, older datasets)
- **S-63 encrypted** — the IHO standard encryption scheme used by most paid
  vendors (UKHO ADMIRALTY, Primar, IC-ENC, ChartWorld). Requires a `PERMIT.TXT`
  with per-cell decryption keys tied to the user's hardware ID.

---

## Options

### Option A: CLI Tool (Package the Existing Pipeline)

**Approach:** Distribute the Python pipeline as a standalone tool that users run
locally to convert their ENC files into a PMTiles file they can import.

**How it works:**
1. User installs the CLI: `pipx install pelorus-enc-converter` (or similar)
2. User runs: `pelorus-enc convert ~/Downloads/my-encs/ -o my-charts.pmtiles`
3. Tool scans `.000` files, runs ogr2ogr → enrich → tippecanoe → composite
4. User imports the resulting `.pmtiles` into the app (existing import flow)

**Pros:**
- Minimal new code — repackage what exists
- Full pipeline fidelity (compositing, SCAMIN, label generation)
- Handles large datasets efficiently (hundreds of cells)
- Native GDAL handles all S-57 edge cases reliably

**Cons:**
- Users must install Python, GDAL, and tippecanoe — major friction
  - GDAL installation is notoriously painful on Windows/macOS
  - tippecanoe requires compilation from source on non-macOS
- Not integrated into the app experience
- Requires command-line comfort (excludes most recreational sailors)
- S-63 decryption is a separate step the user must handle

**Effort:** Low (packaging + docs), but high user friction.

**Verdict:** Good for power users and developers. Not viable as the primary UX.

---

### Option B: Server-Side Conversion Service

**Approach:** Run the pipeline on a server. Users upload `.000` files via the
app, server converts them, user downloads the resulting PMTiles.

**How it works:**
1. User drags ENC files into the app
2. Files upload to a conversion endpoint
3. Server runs the full pipeline (GDAL + tippecanoe + compositing)
4. Returns PMTiles file, app stores it in OPFS

**Pros:**
- Zero local dependencies — seamless UX
- Full pipeline fidelity
- Can cache/optimize aggressively

**Cons:**
- Server costs (GDAL + tippecanoe are CPU-intensive)
- Licensing concerns — paid ENC data transiting our servers raises legal
  questions with hydrographic offices
- Privacy — users may not want to upload their licensed chart data
- Requires maintaining server infrastructure
- Upload size can be large (hundreds of MB for a full country's ENCs)

**Effort:** Medium (server infra, upload handling, queue management).

**Verdict:** Legal and privacy issues make this problematic for paid ENC data.
Could work for free/open ENC sources.

---

### Option C: In-Browser Conversion (WASM) — Recommended

**Approach:** Run the conversion entirely in the browser using GDAL compiled to
WebAssembly. Skip tippecanoe — feed GeoJSON directly to MapLibre.

**How it works:**
1. User drops `.000` files (or a zip) into the app
2. GDAL WASM reads S-57 data, outputs GeoJSON per layer
3. JS enrichment (port of `enrich.py`) flattens attributes, computes labels
4. GeoJSON stored in OPFS/IndexedDB
5. MapLibre renders via GeoJSON source (small imports) or `geojson-vt` for
   on-the-fly vector tile slicing (larger imports)

#### Key Technology Assessment

| Component | Library | Size | Status |
|-----------|---------|------|--------|
| S-57 parsing | [gdal3.js](https://github.com/bugra9/gdal3.js) | ~38 MB (wasm+data), ~12 MB gzipped | Mature; GDAL 3.8.4; S-57 driver confirmed |
| GeoJSON tiling | [geojson-vt](https://github.com/mapbox/geojson-vt) | ~6 KB gzipped | Very mature; used by MapLibre internally |
| Attribute enrichment | Custom JS | ~2 KB | Port of `enrich.py` — pure logic |
| S-63 decryption | Custom JS (Blowfish + CRC) | ~5 KB | IHO S-63 uses Blowfish; JS libs exist |
| PMTiles writing | None available in JS | — | Not needed if using GeoJSON source |

#### Why Skip tippecanoe / PMTiles Generation?

tippecanoe is a 50K+ line C++ program optimized for batch processing millions of
features. There is no WASM port. However, for user-imported charts (typically a
region, not an entire country), we don't need it:

- **MapLibre GeoJSON sources** handle moderate data well (a few MB of GeoJSON)
- **geojson-vt** (already a MapLibre dependency) slices GeoJSON into vector tiles
  on the fly in the browser — this is what MapLibre does internally for GeoJSON
  sources
- For a typical import (5-30 ENC cells), total GeoJSON would be 10-100 MB —
  within browser memory limits, especially when stored in OPFS and loaded per-layer
- The pre-built NOAA tiles remain PMTiles for performance at continental scale;
  user imports use the lighter GeoJSON path

#### The GDAL WASM Size Problem

38 MB is large but manageable with the right approach:

1. **Lazy-load only on first import** — never loaded during normal app use
2. **Cache in service worker** — downloaded once, cached indefinitely
3. **Show a one-time download prompt**: "To import ENC files, a 12 MB conversion
   engine needs to be downloaded. This only happens once."
4. **Possible optimization** — a custom GDAL WASM build including only the S-57
   driver (stripping raster drivers, other vector drivers) could reduce size
   significantly. The [cpp.js GDAL package](https://www.npmjs.com/package/@cpp.js/package-gdal-wasm)
   is exploring modular builds.

#### S-63 Encrypted ENCs

IHO S-63 uses Blowfish (a symmetric cipher) with per-cell keys derived from:
- The user's hardware ID (M_KEY, bound to their ECDIS or chart viewer license)
- A cell permit file (`PERMIT.TXT`) containing encrypted cell keys

The decryption flow:
1. User provides their `PERMIT.TXT` and hardware ID
2. For each cell: derive the cell key from the permit using the HW_ID
3. Decrypt the `.000` file using Blowfish in ECB mode
4. Verify CRC32 integrity
5. Feed decrypted S-57 data to GDAL WASM

This is cryptographically simple and entirely feasible in the browser.
The user's keys and data never leave their device — a significant privacy
advantage over server-side conversion.

**Pros:**
- Best UX — drag-and-drop in the app, no external tools
- Privacy-preserving — all data stays on-device
- No server costs
- Works offline (after initial WASM download)
- Existing MapLibre styles work with the same layer/attribute schema

**Cons:**
- GDAL WASM is large (12 MB gzipped, one-time download)
- Memory constraints for very large imports (100+ cells)
- No multi-scale compositing — overlapping scale bands may show artifacts
  (acceptable for user imports; can be mitigated with scale-band visibility rules)
- GDAL WASM is a dependency we don't fully control
- Initial development is more work than Option A

**Effort:** Medium-high (WASM integration, enrichment port, GeoJSON storage,
UI for import flow, S-63 if needed).

**Verdict:** Best balance of UX, privacy, and technical feasibility. Recommended
approach.

---

### Option D: Hybrid — CLI for Power Users, WASM for Everyone Else

Ship both:
- **Option C (WASM)** as the primary in-app experience
- **Option A (CLI)** for users with very large datasets or who want to pre-build
  PMTiles for maximum performance

The CLI path produces PMTiles files that go through the existing import flow.
The WASM path handles the common case (a few cells for a cruising area).

---

## Recommended Architecture (Option C)

### Data Flow

```
User drops .000 files
        │
        ▼
┌─────────────────┐
│  S-63 Decrypt    │  ← only if encrypted (user provides PERMIT.TXT)
│  (JS Blowfish)   │
└────────┬─────────┘
         │ plain S-57 bytes
         ▼
┌─────────────────┐
│  GDAL WASM       │  ← lazy-loaded (~12 MB gzipped, cached)
│  ogr2ogr S-57    │
│  → GeoJSON       │
└────────┬─────────┘
         │ per-layer GeoJSON
         ▼
┌──────────────────┐
│  JS Enrichment    │  ← port of enrich.py
│  • flatten lists  │
│  • SCAMIN→minzoom │
│  • compute labels │
│  • scale band     │
└────────┬──────────┘
         │ enriched GeoJSON
         ▼
┌──────────────────┐
│  OPFS Storage     │  ← persist for offline use
│  per-layer files  │
└────────┬──────────┘
         │
         ▼
┌──────────────────┐
│  MapLibre         │  ← GeoJSON source + geojson-vt (automatic)
│  + existing       │
│  nautical styles  │
└──────────────────┘
```

### Integration Points in Existing Code

| File | Change |
|------|--------|
| `src/ui/ChartCachePanel.ts` | Add "Import ENC files" button alongside existing PMTiles import |
| `src/data/tile-store.ts` | Add GeoJSON storage/retrieval functions for OPFS |
| `src/chart/VectorChartProvider.ts` | Register imported GeoJSON as additional MapLibre sources |
| `src/chart/styles/index.ts` | Ensure layer styles work with GeoJSON source (same property schema) |
| `src/main.ts` | Load imported GeoJSON sources on startup |
| New: `src/import/` | GDAL WASM wrapper, enrichment logic, S-63 decryption, import orchestration |

### Multi-Scale Handling Without Compositing

The full pipeline's MVT compositing (`composite.py`) solves ghosting at scale-band
boundaries — but it requires decoding and re-encoding MVT tiles, which is
impractical in-browser for large imports. Simpler alternatives:

1. **Scale-band visibility rules** — set `minzoom`/`maxzoom` on GeoJSON sources
   based on INTU, so only the appropriate scale band renders at each zoom level
2. **Highest-detail-wins** — at boundaries where multiple bands exist, show only
   the most detailed cell's data using `["case"]` expressions on `_scale_band`
3. **Accept minor artifacts** — for personal navigation, slight overlap at band
   boundaries is acceptable (the full pipeline's compositing is a polish step)

### Storage Estimates

| Import size | GeoJSON (approx) | OPFS storage |
|-------------|-------------------|--------------|
| 5 cells (harbor area) | 5-15 MB | ~15 MB |
| 20 cells (cruising region) | 30-80 MB | ~80 MB |
| 50 cells (small country) | 80-200 MB | ~200 MB |
| 100+ cells (large area) | 200+ MB | Consider CLI path |

OPFS storage is typically limited to a percentage of available disk space (varies
by browser, usually generous on desktop, tighter on mobile).

---

## Implementation Phases

### Phase 1: Unencrypted S-57 Import (MVP)

- GDAL WASM integration (lazy-loaded)
- Import UI (file picker for `.000` files)
- ogr2ogr → GeoJSON for core layers (DEPARE, COALNE, SOUNDG, LIGHTS, BOYLAT, etc.)
- JS enrichment (list flattening, basic labels)
- GeoJSON → OPFS storage
- MapLibre GeoJSON source registration
- Verify existing nautical styles render correctly

**Validates:** end-to-end flow, GDAL WASM reliability, rendering quality.

### Phase 2: Full Layer Support & Polish

- All 52 S-57 layers
- SCAMIN → minzoom enrichment
- Scale-band visibility rules
- Coverage mask generation from M_COVR
- Import progress UI (per-cell, per-layer)
- Delete/manage imported regions
- Search index generation for imported features

### Phase 3: S-63 Encrypted ENC Support

- Blowfish decryption in JS
- PERMIT.TXT parser
- Hardware ID input UI
- Decrypt → feed to GDAL WASM pipeline
- Key storage (optional, in-browser only)

### Phase 4: CLI Distribution (Optional)

- Package existing Python pipeline as standalone tool
- Dockerfile for easy GDAL/tippecanoe setup
- Produces PMTiles compatible with existing import flow
- For power users with large datasets

---

## Open Questions

1. **GDAL WASM build size** — Can we build a minimal WASM with only the S-57
   driver? The full gdal3.js includes dozens of raster/vector drivers we don't
   need. A custom Emscripten build could cut size significantly.

2. **Memory limits** — How many cells can we process in a single browser session?
   Web Workers would help isolate memory and keep the UI responsive. Need to
   test with real-world European ENC sets.

3. **Update files** — S-57 updates (`.001`, `.002`) need to be applied to the
   base `.000`. GDAL handles this natively, but we need to ensure the WASM
   build's virtual filesystem correctly presents the update files alongside
   the base file.

4. **Capacitor/mobile** — GDAL WASM will work in the mobile WebView, but memory
   is tighter. May need to process cells one at a time and stream results to OPFS.

5. **License compliance** — We should consult IHO/hydrographic office guidance on
   whether client-side rendering of licensed ENCs in an open-source viewer is
   permitted. Most ECDIS licensing allows "approved viewer" use — our case is
   novel.

6. **GeoJSON vs. generating PMTiles client-side** — If a JS PMTiles writer
   emerges (the format spec is simple), we could generate PMTiles in-browser
   for better rendering performance. Worth revisiting as the ecosystem evolves.
