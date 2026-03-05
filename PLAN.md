# Pelorus Nav: Open-Source Web Chartplotter

## Project Vision

A modern, open-source marine chartplotter built as a progressive web app (PWA) in TypeScript. Targets e-ink tablets (Boox) on sailboats, but runs on any phone, tablet, or desktop browser. Emphasis on reliability, offline operation, and clean architecture.

---

## Technology Stack

| Layer                 | Choice                                                        | Rationale                                                          |
|-----------------------|---------------------------------------------------------------|--------------------------------------------------------------------|
| **Language**          | TypeScript (strict mode)                                      | Type safety, tooling, ecosystem                                    |
| **Runtime**           | Bun (dev/build), browser (prod)                               | Fast builds, native TS support                                     |
| **Map renderer**      | MapLibre GL JS                                                | WebGL, vector tiles, extensible, OSS, active community             |
| **Chart data (Ph 1)** | NOAA NCDS raster tiles (MBTiles/WMTS)                         | Free, offline-capable, no parsing needed                           |
| **Chart data (Ph 2)** | S-57 → vector tiles pipeline                                  | Custom styling, object querying, better quilting                   |
| **GPS bridge**        | Signal K server (1), Web Geoloc API (2), WebSerial (dir. USB) | Standard marine data protocol, broad hw support                    |
| **UI framework**      | Solid.js or vanilla TS + Web Components                       | Minimal overhead, fine-grained reactivity, no VDOM churn for e-ink |
| **Testing**           | Vitest (unit), Playwright (E2E/cross-device)                  | Fast, TS-native, real browser testing                              |
| **Bundler**           | Vite                                                          | Fast HMR, Bun-compatible, PWA plugin                               |
| **PWA**               | vite-plugin-pwa (Workbox)                                     | Offline caching, installable                                       |
| **Linting/format**    | Biome                                                         | Fast, replaces ESLint + Prettier                                   |

### Key Architectural Decisions

- **Offline-first**: All chart tiles cached locally (MBTiles in IndexedDB or filesystem). App works without network.
- **Data source abstraction**: Chart data accessed through a `ChartProvider` interface so we can swap raster tiles → vector tiles → S-101 later.
- **GPS abstraction**: Position data consumed through a `NavigationDataProvider` interface supporting Signal K WebSocket, Web Geolocation API, Web Serial NMEA, and simulated/replay sources.
- **E-ink aware rendering**: CSS `prefers-reduced-motion`, configurable update rates, high-contrast mode, no animations.
- **No server requirement for basic operation**: The app can run standalone with downloaded tiles and browser GPS. Signal K server is optional (adds instrument data, AIS, etc.).

---

## Phase 0: Project Scaffolding

**Goal**: Working dev environment, CI, empty app shell.

### Tasks
1. Initialize project with Bun + Vite + TypeScript (strict)
2. Configure Biome for linting/formatting
3. Set up Vitest for unit tests, Playwright for E2E
4. Create basic PWA manifest and service worker skeleton
5. Set up GitHub repo with CI (lint, typecheck, test on push)
6. Create basic HTML shell with a full-viewport `<div id="map">`
7. Add MapLibre GL JS, render a world basemap (OSM raster tiles) to confirm setup
8. Add CLAUDE.md with project conventions

### Acceptance Criteria
- [ ] `bun dev` starts dev server with HMR
- [ ] `bun run build` produces production bundle
- [ ] `bun test` runs Vitest suite (with at least one passing test)
- [ ] `bun run e2e` runs Playwright against dev server
- [ ] Biome passes with zero warnings
- [ ] TypeScript strict mode, no `any` types
- [ ] MapLibre renders OSM tiles full-viewport in Chrome, Firefox, Safari
- [ ] PWA installable (passes Lighthouse PWA audit basics)

### Test Plan
- **Desktop**: Chrome, Firefox, Safari on macOS
- **Mobile**: Chrome on Android (Boox if available), Safari on iOS
- **Automated**: Playwright E2E confirms map renders (screenshot comparison baseline)

---

## Phase 1: NOAA Raster Chart Display

**Goal**: Display real NOAA nautical charts with zoom/pan, tile caching for offline use.

### 1A: NOAA Tile Integration ✅ DONE

#### Implementation Notes
- NOAA WMTS tile endpoint (`GoogleMapsCompatible`) returns 400 errors — does not work.
- Working approach: **WMS via `{bbox-epsg-3857}` substitution** in MapLibre raster source.
- Two NOAA WMS endpoints available:
  - **NOAAChartDisplay** (paper chart symbology): `https://gis.charttools.noaa.gov/arcgis/rest/services/MCS/NOAAChartDisplay/MapServer/exts/MaritimeChartService/WMSServer`
  - **ENCOnline** (ECDIS/S-52 symbology): `https://gis.charttools.noaa.gov/arcgis/rest/services/MCS/ENCOnline/MapServer/exts/MaritimeChartService/WMSServer`
- Both endpoints serve watermarked tiles ("not for navigation" overlays). This is expected for the free WMS service, not a token/auth issue. Watermark-free options:
  - NOAA MBTiles from `distribution.charts.noaa.gov/ncds/` (untested)
  - Our own S-57 vector pipeline (Phase 1B)
  - MarineCharts.io commercial API ($49/month)
- ChartProvider interface + ChartManager + ChartSwitcherControl implemented
- Three providers: NOAA paper chart, NOAA ECDIS, OSM fallback

### Test Plan – Phase 1A
- **Functional**: Chart displays at multiple zoom levels for US East Coast, West Coast, Great Lakes, Hawaii
- **Cross-device**: Boox Tab Ultra (Chrome), iPad Safari, Android phone Chrome, desktop browsers
- **Automated**: Playwright E2E for chart load, zoom, pan; screenshot comparison for chart rendering correctness

---

## Phase 1B: S-57 → Vector Tiles Pipeline (HIGH RISK — start early) ✅ DONE

**Status**: Pipeline implemented. Python CLI in `tools/s57-pipeline/` converts S-57 ENC → GeoJSON → PMTiles via ogr2ogr + tippecanoe. VectorChartProvider + minimal nautical style integrated into app. PMTiles protocol registered. Spike validation pending actual ENC data download.

**Goal**: Convert NOAA S-57 ENC data into vector tiles we can render and style. This is the highest-risk work in the project — unknown unknowns live here. Starting it early means we discover blockers while raster charts keep the app functional.

### Why Early

- S-57 parsing, layer mapping, and symbology are complex with sparse documentation
- GDAL/ogr2ogr behavior with S-57 has edge cases (update files, projection issues, attribute encoding)
- Tippecanoe tile generation at nautical scales may need tuning
- We need to validate that the full pipeline (S-57 → GeoJSON → vector tiles → MapLibre) produces usable results before building more features on top of it

### Tasks
1. Build a CLI tool (TypeScript + shell out to `ogr2ogr` / GDAL) that:
   - Downloads NOAA ENC cells (scripted from NOAA catalog XML)
   - Converts S-57 `.000` files to GeoJSON (per object class layer)
   - Runs `tippecanoe` to produce MBTiles with appropriate zoom ranges per layer
   - Respects SCAMIN/SCAMAX attributes (encoded as tile feature properties)
2. **Spike first**: Before building the full pipeline, run a manual spike:
   - Pick 3-5 ENC cells at different scales (harbor, approach, coastal)
   - Run `ogr2ogr` manually, inspect the GeoJSON output
   - Feed through `tippecanoe`, load in MapLibre with a minimal style
   - Document what works, what breaks, what's missing
3. Define a simplified nautical symbology as a MapLibre style spec:
   - Land areas, depth contours/areas, soundings
   - Buoys, beacons, lights (with light characteristics)
   - Channels, restricted areas, anchorages
   - Reference: Finnish nautical chart vectors style + S-52 lookup tables
4. Store output as PMTiles (single-file, HTTP range-request friendly) for easy deployment
5. Document the pipeline so others can run it for their region

### Acceptance Criteria
- [ ] Spike completed: manual pipeline produces visible chart in MapLibre for ≥3 ENC cells
- [ ] Automated pipeline processes all US ENC cells without errors
- [ ] Output PMTiles file renders correctly in MapLibre
- [ ] All major S-57 object classes rendered with appropriate symbology
- [ ] SCAMIN/SCAMAX filtering works (objects appear/disappear at correct zoom levels)
- [ ] Pipeline runs in <30 minutes for full US coverage on a modern machine
- [ ] Pipeline documented with README
- [ ] Known limitations and edge cases documented

### Risk Mitigations
- **If ogr2ogr can't handle some S-57 features**: Fall back to GDAL Python bindings or the Go-based s57-tiler
- **If tippecanoe produces poor results at nautical scales**: Try t-rex or Martin as alternative tile generators
- **If symbology is too complex for Phase 1**: Ship with simplified symbology, iterate
- **If the full pipeline is too slow**: Process by region, cache aggressively, run as a batch job

### Test Plan – Phase 1B
- **Pipeline**: Automated test that processes a small set of ENC cells and validates output structure
- **Layer coverage**: Verify all critical S-57 object classes appear in output (DEPARE, SOUNDG, LIGHTS, BOYISD, etc.)
- **Regression**: Keep reference GeoJSON/tiles from spike, compare against pipeline output

---

## S-57 Layer Coverage

We currently extract 38 layers. Below are layers present in NOAA ENC data that we don't yet process, categorized by priority.

### Important for Navigation

| Layer | Geom | Description | Why |
|-------|------|-------------|-----|
| BCNSPP | Point | Special purpose beacons | We have BCNLAT/BCNCAR but miss these |
| DAYMAR | Point | Daymarks (colored panels on beacons) | Identifies dayboard shape/color |
| TOPMAR | Point | Top marks on buoys/beacons | IALA cone/sphere/etc |
| TSSBND | Line | TSS boundaries | We have TSSLPT but not boundary lines |
| TSEZNE | Polygon | TSS separation zones | Central dividers between TSS lanes |
| TWRTPT | Polygon | Two-way route parts | Important shipping lanes |
| RECTRC | Line | Recommended tracks | Channel approach guidance |
| NAVLNE | Line | Navigation/leading lines | Harbor entry approach bearings |
| DWRTCL | Line | Deep water route centerlines | Deep-draft routes |
| ACHBRT | Polygon | Anchor berths | Named spots within anchorage areas |
| SBDARE | Point/Poly | Seabed type (sand, mud, rock) | Critical for anchoring decisions |
| DMPGRD | Poly/Point | Dumping grounds | Avoid anchoring/fishing |
| HRBFAC | Point | Harbour facilities | Marinas, fuel, yacht clubs |
| MAGVAR | Polygon | Magnetic variation | Compass navigation overlay |
| CBLARE | Polygon | Cable areas | No-anchor zones |
| PIPARE | Polygon | Pipeline areas | Anchoring restrictions |
| PIPSOL | Line | Submarine pipelines | Like CBLSUB but for pipes |
| OFSPLF | Point | Offshore platforms | Fixed structures in water |

### Nice to Have

| Layer | Geom | Description |
|-------|------|-------------|
| RTPBCN | Point | RACON radar transponder beacons |
| RDOSTA | Point | Radio stations (VHF, DGPS) |
| CGUSTA | Point | Coast Guard stations |
| SMCFAC | Point | Small craft facilities (ramps, fuel docks) |
| WATTUR | Point/Poly | Water turbulence (tide rips, overfalls) |
| LNDRGN | Point/Poly | Named land regions (capes, islands) |
| LNDELV | Point/Line | Land elevation points/contours |
| SLOTOP | Line | Cliff/slope top lines |
| DYKCON | Line/Poly | Dykes/seawalls |
| WEDKLP | Point | Weed/kelp areas |
| SILTNK | Point/Poly | Silos/tanks (visual landmarks) |
| RUNWAY | Polygon | Airport runways |
| BUAARE | Poly/Point | Built-up areas (towns/cities) |
| MARCUL | Polygon | Marine farms/aquaculture |
| PILBOP | Point/Poly | Pilot boarding places |

### Skip (Metadata/Administrative)

DSID, M_COVR, M_NPUB, M_NSYS, M_QUAL, C_AGGR, C_ASSO, NEWOBJ, ADMARE, CONZNE, COSARE, EXEZNE, OSPARE, PRCARE, SLOGRD, TESARE, MIPARE

---

## Phase 1C: Vector Chart Display and Quilting

**Goal**: Display vector charts in the app with proper quilting and object querying.

### Tasks
1. Create `VectorChartProvider` implementing `ChartProvider` interface
2. Serve PMTiles via HTTP range requests (static file server, or embed in service worker)
3. Implement proper chart quilting:
   - Multiple scale bands loaded simultaneously
   - Larger-scale (more detailed) data renders on top
   - Smooth transitions between scale bands
   - Use SCAMIN/SCAMAX as MapLibre filter expressions per layer
4. **Detail level selector**: User-adjustable display category controlling when objects appear
   - Maps to SCAMIN threshold offsets (e.g., "show more" lowers minzoom by 1-2 levels)
   - Presets: "Standard", "Full", "Minimal" (analogous to ECDIS display categories Base/Standard/All)
   - Persisted in user settings
5. Object querying: tap on a chart feature to see its attributes (buoy characteristics, depth, light info, etc.)
5. Feature highlighting on selection
6. Add a "chart scale" indicator showing current approximate chart scale

### Acceptance Criteria
- [ ] Vector charts display with correct nautical symbology
- [ ] Quilting: zooming in shows higher-detail chart cells smoothly
- [ ] No visible gaps or seams between chart cells at any zoom level
- [ ] Tap on buoy/light/feature shows popup with S-57 attributes
- [ ] Performance: 60fps pan/zoom on modern phone, 30fps on desktop, acceptable on e-ink
- [ ] Visual comparison with NOAA raster charts shows no critical features missing

### Test Plan – Phase 1C
- **Rendering correctness**: Visual regression tests comparing vector output to NOAA raster reference
- **Object querying**: E2E test tapping on known features and verifying attribute display
- **Performance**: Benchmark tile load and render times across devices
- **Scale transitions**: Automated zoom sweep testing quilting at all scale boundaries

---

## Phase 1D: Offline Tile Caching

**Goal**: Full offline operation with cached tiles (works for both raster and vector chart providers).

### Tasks
1. Implement tile cache using IndexedDB (via `idb` library or similar)
2. Service worker intercepts tile requests: serve from cache if available, fetch and cache if not
3. Implement "download region" UI: user draws a bounding box, selects zoom range, app pre-fetches and caches tiles
4. Show cache size and management UI (clear cache, see what's cached)
5. Support loading MBTiles/PMTiles files directly from local storage / file picker
   - Parse MBTiles (SQLite) in browser via `sql.js` (SQLite compiled to WASM)
   - PMTiles via `pmtiles` JS library (HTTP range requests or local file)

### Acceptance Criteria
- [ ] Previously viewed tiles load instantly from cache (no network)
- [ ] Region download: user can select an area + zoom range, tiles download in background with progress indicator
- [ ] App functions fully offline after tiles are cached
- [ ] Cache management UI shows size, allows clearing
- [ ] MBTiles/PMTiles files can be loaded from local storage / file picker
- [ ] Works with both raster (NOAA NCDS) and vector (S-57 pipeline) tile sources

### Test Plan – Phase 1D
- **Offline**: Disconnect network after caching, verify full functionality
- **Performance**: Measure tile load time, cache hit rate; target <100ms for cached tiles
- **Storage**: Test with large tile sets (1GB+), verify IndexedDB performance

---

## Phase 2: GPS Integration and Position Display

**Goal**: Show vessel position on chart, follow GPS, display course/speed.

### 2A: Navigation Data Abstraction

#### Tasks
1. Define `NavigationData` type:
   ```typescript
   interface NavigationData {
     position: { lat: number; lon: number } | null;
     courseOverGround: number | null;    // degrees true
     speedOverGround: number | null;     // knots
     headingTrue: number | null;         // degrees
     headingMagnetic: number | null;     // degrees
     timestamp: number;                  // ms since epoch
     source: string;                     // e.g. 'signalk', 'geolocation', 'serial', 'simulator'
     accuracy: number | null;            // meters
   }
   ```
2. Define `NavigationDataProvider` interface:
   ```typescript
   interface NavigationDataProvider {
     id: string;
     name: string;
     connect(): Promise<void>;
     disconnect(): void;
     subscribe(callback: (data: NavigationData) => void): () => void;
     isConnected(): boolean;
   }
   ```
3. Implement providers:
   - `BrowserGeolocationProvider` – uses `navigator.geolocation.watchPosition()`
   - `SignalKProvider` – connects to Signal K WebSocket, maps paths to NavigationData
   - `SimulatorProvider` – replays recorded tracks or generates synthetic data (critical for testing)
   - `WebSerialNMEAProvider` – reads NMEA 0183 from USB GPS via Web Serial API (Chrome only)
4. Implement `NavigationDataManager` that manages active provider, handles failover

#### Acceptance Criteria
- [ ] SimulatorProvider produces realistic position data along a configurable track
- [ ] BrowserGeolocationProvider works on phone (outdoor test with real GPS)
- [ ] SignalKProvider connects to a Signal K server and receives position updates
- [ ] WebSerialNMEAProvider reads from a USB GPS (test with a real device)
- [ ] Provider switching works without interruption
- [ ] All providers produce data conforming to `NavigationData` interface

### 2B: Vessel Position Display

#### Tasks
1. Render vessel icon (boat shape or arrow) at current GPS position
2. Vessel icon rotates to show heading (or COG if heading unavailable)
3. Accuracy circle (optional, toggleable)
4. Configurable update rate (1Hz default, lower for e-ink)
5. Smooth position interpolation between GPS fixes (for non-e-ink displays)

#### Acceptance Criteria
- [ ] Vessel icon visible at current position
- [ ] Icon rotates correctly with heading/COG
- [ ] Position updates at configured rate
- [ ] No visible jitter on stable GPS

### 2C: Chart Following Modes

#### Tasks
1. **Follow mode**: Chart centers on vessel position, vessel stays centered
2. **Course-up mode**: Chart rotates so vessel's COG/heading points up
3. **North-up mode**: Chart oriented north (true or magnetic, user choice)
4. **Free mode**: User can pan/zoom freely; tap "re-center" button to return to follow mode
5. Automatic switch from follow → free when user pans manually
6. Magnetic declination calculation (use WMM – World Magnetic Model, via `geomagnetism` npm or similar)

#### Acceptance Criteria
- [ ] Follow mode keeps vessel centered as position updates
- [ ] Course-up rotates chart correctly
- [ ] North-up true vs. magnetic differ by local declination
- [ ] Manual pan breaks follow mode; re-center button restores it
- [ ] Mode persists across page reloads (localStorage)

### 2D: Overlay Displays (HUD)

#### Tasks
1. Large, readable overlays for:
   - COG (course over ground)
   - SOG (speed over ground)
   - Position (lat/lon)
2. Selectable/configurable: user chooses which overlays are visible
3. Positioned at screen edges, semi-transparent, high contrast
4. Scalable font size (accessibility, e-ink readability)
5. Design for future extensibility (depth, wind, waypoint bearing, etc.)

#### Acceptance Criteria
- [ ] COG, SOG, position overlays display correctly
- [ ] Overlays readable on 10" e-ink at arm's length
- [ ] User can toggle overlays on/off
- [ ] Font size adjustable
- [ ] Overlay data updates in real time with GPS

### Test Plan – Phase 2
- **GPS accuracy**: Compare displayed position with known location and reference GPS
- **Mode switching**: Automated tests for follow/course-up/north-up/free transitions
- **Simulator**: Full E2E test suite using SimulatorProvider (no real GPS needed for CI)
- **Signal K integration**: Test against Signal K demo server (`demo.signalk.org`)
- **Cross-device**: Real outdoor test on phone (walking/driving), Boox (if available)
- **E-ink**: Verify overlay readability on e-ink at 1Hz update rate
- **Performance**: Position update processing <16ms (60fps budget), <50ms for e-ink mode

---

## Phase 3: E-Ink Optimization

**Goal**: Excellent user experience on e-ink displays without degrading LCD/OLED experience.

### Tasks
1. Detect e-ink display (user preference toggle; no reliable auto-detection)
2. **E-ink rendering mode**:
   - Disable all CSS transitions and animations
   - Reduce map update rate to 1Hz (configurable)
   - Use jump-cut map recentering (no smooth pan animation)
   - High-contrast symbology: thicker lines, solid fills, no gradients
   - Monochrome chart style option (MapLibre style with no color, just black/white/grey)
3. **Touch optimization**:
   - Larger touch targets (minimum 48px)
   - Debounce touch events (50ms)
   - Confirm destructive actions with modal (not swipe)
4. **Partial refresh awareness**:
   - Minimize repaint areas (overlay updates don't trigger full map redraw)
   - Periodic full-screen refresh option (button or timer) to clear ghosting
5. CSS custom properties for all colors/sizes, switchable between themes:
   - `day` (standard), `dusk` (reduced brightness), `night` (red on black), `eink` (high contrast B&W)

### Acceptance Criteria
- [ ] E-ink mode toggle persists across sessions
- [ ] No CSS animations in e-ink mode (verified by Playwright)
- [ ] Map updates at ≤1Hz in e-ink mode
- [ ] All touch targets ≥48px in e-ink mode
- [ ] Day/dusk/night/eink themes switch correctly
- [ ] Usable on Boox Tab Ultra in Chrome with "Speed" refresh mode

### Test Plan – Phase 3
- **Boox real-device testing**: Navigate a recorded track on Boox Tab Ultra, evaluate ghosting, readability, responsiveness
- **Theme switching**: Automated screenshot tests for all 4 themes
- **Touch targets**: Automated check that all interactive elements meet size minimums
- **Performance**: Measure JS execution time per frame; target <50ms for e-ink update cycle

---

## Phase 5: Routes, Tracks, and Waypoints

**Goal**: Create, save, and manage navigation routes; record and display tracks.

### 5A: Waypoints

#### Tasks
1. Define `Waypoint` type (name, position, icon, notes, created/modified timestamps)
2. CRUD operations stored in IndexedDB
3. Display waypoints on chart as labeled icons
4. Tap to create waypoint (long-press or button + tap)
5. Import/export GPX waypoints

### 5B: Routes

#### Tasks
1. Define `Route` type (name, ordered list of waypoints, notes)
2. Route creation UI: tap waypoints in sequence on chart, or add from waypoint list
3. Display route as connected line segments with waypoint markers
4. Show leg distances, bearings, and total route distance
5. Active route: show bearing/distance to next waypoint in HUD overlay
6. Great-circle vs. rhumb-line distance calculations
7. Import/export GPX routes

### 5C: Tracks

#### Tasks
1. Record GPS track automatically when position data is available
2. Store track points in IndexedDB with timestamps
3. Display track as a colored line on chart
4. Track management: list, rename, delete, export GPX
5. Automatic track segmentation (new segment after gap or time threshold)
6. Track statistics: distance, duration, average/max speed

### Acceptance Criteria
- [ ] Waypoints: create, edit, delete, display on chart, import/export GPX
- [ ] Routes: create, edit, navigate with active route HUD, import/export GPX
- [ ] Tracks: auto-record, display, manage, export GPX
- [ ] All data persists in IndexedDB across sessions
- [ ] GPX import/export compatible with OpenCPN, Navionics, other tools
- [ ] Works offline

### Test Plan – Phase 5
- **CRUD**: Unit tests for all waypoint/route/track operations
- **GPX interop**: Import GPX files from OpenCPN, Navionics; export and re-import roundtrip
- **Active navigation**: Simulator drives a route, verify bearing/distance overlay accuracy
- **Storage**: Stress test with 10,000 waypoints, 100 routes, 1M track points
- **Cross-device**: Verify touch-based route creation on phone and tablet

---

## Phase 6: Settings, Preferences, and Polish

### Tasks
1. Settings panel:
   - Units (nautical miles/km, knots/km-h/m-s, feet/meters/fathoms for depth)
   - Chart provider selection
   - GPS source selection
   - Display theme (day/dusk/night/eink)
   - Course-up / north-up (true/magnetic) default
   - Overlay selection and size
   - E-ink mode toggle
   - Update rate
2. Persistent settings in localStorage
3. Responsive layout: works from phone (5") to tablet (10") to desktop
4. Keyboard shortcuts (desktop): +/- zoom, arrow pan, R re-center, N north-up, C course-up
5. Touch gestures: pinch-zoom, two-finger rotate (for course-up), double-tap zoom
6. Loading states, error states, empty states for all screens
7. About/license page (open source license info)

### Acceptance Criteria
- [ ] All settings persist across sessions
- [ ] Units convert correctly everywhere they appear
- [ ] Responsive layout tested at 320px, 768px, 1024px, 1440px widths
- [ ] Keyboard shortcuts work on desktop
- [ ] Touch gestures work on phone and tablet
- [ ] Lighthouse scores: Performance ≥90, Accessibility ≥95, Best Practices ≥95, PWA ≥90

### Test Plan – Phase 6
- **Settings persistence**: Automated test: change settings, reload, verify
- **Responsive**: Playwright tests at multiple viewport sizes
- **Accessibility**: axe-core automated audit, manual screen reader test
- **Lighthouse**: Automated CI Lighthouse audit

---

## Future Phases (Out of Scope for Initial Development)

These are documented for planning purposes but not part of the current roadmap:

- **AIS display**: Show other vessels from AIS data (via Signal K)
- **Anchor watch**: Set anchor position, alarm if vessel drifts beyond radius
- **Tide/current data**: Integrate NOAA tide predictions and tidal current data
- **Weather overlay**: GRIB data display for wind, waves, pressure
- **Auto-routing**: Compute routes avoiding land, shallow water, restricted areas
- **Multi-user / cloud sync**: Account management, sync waypoints/routes across devices
- **NMEA 2000 integration**: Direct instrument data (depth, wind, engine) via Signal K
- **MOB (Man Overboard)**: One-tap MOB waypoint with bearing/distance back to MOB position
- **S-101 support**: When NOAA starts publishing S-101 data (~2026), add parser/renderer

---

## Cross-Cutting Concerns

### Testing Strategy

| Level                 | Tool                         | Scope                                                                 | When             |
|-----------------------|------------------------------|-----------------------------------------------------------------------|------------------|
| **Unit**              | Vitest                       | Pure logic: coordinate math, NMEA parsing, data transforms, providers | Every PR         |
| **Component**         | Vitest + jsdom/happy-dom     | UI component rendering, state management                              | Every PR         |
| **Integration**       | Vitest                       | Provider → Manager → UI data flow                                     | Every PR         |
| **E2E**               | Playwright                   | Full app in real browser: map renders, interactions, offline          | Every PR         |
| **Visual regression** | Playwright screenshots       | Chart rendering correctness, theme switching                          | Weekly / release |
| **Performance**       | Playwright + custom metrics  | Tile load times, frame rates, memory usage                            | Weekly           |
| **Device**            | Manual + Playwright (remote) | Boox, phone, tablet real-device tests                                 | Per release      |

### Target: 90%+ code coverage for non-UI code, 70%+ overall.

### Performance Budgets

| Metric                     | Target                      | E-Ink Target   |
|----------------------------|-----------------------------|----------------|
| Initial load (cached)      | <2s                         | <3s            |
| Tile load (cached)         | <50ms                       | <50ms          |
| Position update processing | <16ms                       | <50ms          |
| Map interaction (pan/zoom) | 60fps                       | N/A (jump-cut) |
| Bundle size (gzipped)      | <500KB (excluding MapLibre) | Same           |
| Memory (steady state)      | <200MB                      | <150MB         |

### Offline Architecture

```
┌─────────────────────────────────────────┐
│              Browser (PWA)              │
│  ┌───────────┐  ┌────────────────────┐  │
│  │  App Shell │  │  MapLibre GL JS    │  │
│  │  (cached)  │  │                    │  │
│  └───────────┘  └────────┬───────────┘  │
│                          │ tile requests│
│  ┌───────────────────────▼───────────┐  │
│  │       Service Worker              │  │
│  │  ┌─────────┐  ┌───────────────┐   │  │
│  │  │ App     │  │ Tile Cache    │   │  │
│  │  │ Cache   │  │ (IndexedDB)   │   │  │
│  │  └─────────┘  └───────────────┘   │  │
│  │  ┌─────────────────────────────┐  │  │
│  │  │ MBTiles Reader (sql.js)     │  │  │
│  │  └─────────────────────────────┘  │  │
│  └───────────────────────────────────┘  │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │       IndexedDB                   │  │
│  │  Waypoints │ Routes │ Tracks      │  │
│  │  Settings  │ Tile Cache           │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
         │ WebSocket (optional)
         ▼
┌─────────────────────┐
│  Signal K Server    │
│  (Raspberry Pi)     │
│  GPS │ AIS │ Instr. │
└─────────────────────┘
```

### Project Structure (Proposed)

```
sailing-nav/
├── PLAN.md
├── CLAUDE.md                    # Project conventions for AI assistance
├── README.md
├── package.json
├── tsconfig.json
├── biome.json
├── vite.config.ts
├── vitest.config.ts
├── playwright.config.ts
├── index.html
├── public/
│   ├── manifest.json
│   └── icons/
├── src/
│   ├── main.ts                  # Entry point
│   ├── app.ts                   # App shell, layout, routing
│   ├── chart/
│   │   ├── ChartProvider.ts     # Interface
│   │   ├── NOAAWMTSProvider.ts
│   │   ├── VectorChartProvider.ts
│   │   ├── ChartManager.ts      # Active provider, layer management
│   │   └── quilting.ts
│   ├── navigation/
│   │   ├── NavigationData.ts    # Types
│   │   ├── NavigationDataProvider.ts  # Interface
│   │   ├── BrowserGeolocationProvider.ts
│   │   ├── SignalKProvider.ts
│   │   ├── WebSerialNMEAProvider.ts
│   │   ├── SimulatorProvider.ts
│   │   ├── NavigationDataManager.ts
│   │   └── nmea-parser.ts
│   ├── map/
│   │   ├── MapView.ts           # MapLibre wrapper, interaction handling
│   │   ├── VesselLayer.ts       # Boat icon rendering
│   │   ├── TrackLayer.ts
│   │   ├── RouteLayer.ts
│   │   ├── WaypointLayer.ts
│   │   └── modes.ts             # Follow, course-up, north-up, free
│   ├── hud/
│   │   ├── HUDOverlay.ts        # Container for data overlays
│   │   ├── CourseDisplay.ts
│   │   ├── SpeedDisplay.ts
│   │   ├── PositionDisplay.ts
│   │   └── ActiveRouteDisplay.ts
│   ├── data/
│   │   ├── Waypoint.ts
│   │   ├── Route.ts
│   │   ├── Track.ts
│   │   ├── db.ts                # IndexedDB schema and access
│   │   └── gpx.ts               # GPX import/export
│   ├── cache/
│   │   ├── TileCache.ts         # IndexedDB tile cache
│   │   ├── MBTilesReader.ts     # sql.js MBTiles reader
│   │   └── RegionDownloader.ts
│   ├── settings/
│   │   ├── Settings.ts          # Types and defaults
│   │   ├── SettingsManager.ts   # Persistence
│   │   └── SettingsPanel.ts     # UI
│   ├── themes/
│   │   ├── day.css
│   │   ├── dusk.css
│   │   ├── night.css
│   │   └── eink.css
│   ├── utils/
│   │   ├── coordinates.ts       # Lat/lon math, projections
│   │   ├── units.ts             # Unit conversions
│   │   ├── magnetic.ts          # Magnetic declination (WMM)
│   │   └── geodesy.ts           # Great-circle, rhumb-line calculations
│   └── sw.ts                    # Service worker
├── tools/
│   └── s57-pipeline/            # Phase 4: S-57 → vector tiles CLI
│       ├── download.ts
│       ├── convert.ts
│       └── style.json
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
└── docs/
    └── architecture.md
```

### Open Source

- **License**: MIT (permissive, encourages adoption)
- **Contributing guide**: Added in Phase 0
- **Issue templates**: Bug report, feature request
- **Code of conduct**: Contributor Covenant

---

## Implementation Order Summary

| Phase  | Focus                          | Dependencies            | Est. Complexity | Risk   |
|--------|--------------------------------|-------------------------|-----------------|--------|
| **0**  | Scaffolding, dev environment   | None                    | Low             | Low    |
| **1A** | NOAA raster charts             | Phase 0                 | Medium          | Low    |
| **1B** | S-57 → vector tiles pipeline   | Phase 0 (parallel w/1A) | High            | **High** |
| **1C** | Vector chart display + quilting| Phase 1B                | High            | **High** |
| **1D** | Offline tile caching           | Phase 1A or 1C          | Medium          | Low    |
| **2A** | GPS data abstraction           | Phase 0                 | Medium          | Low    |
| **2B** | Vessel position display        | Phase 1A + 2A           | Medium          | Low    |
| **2C** | Chart following modes          | Phase 2B                | Medium          | Low    |
| **2D** | HUD overlays                   | Phase 2A                | Low-Medium      | Low    |
| **3**  | E-ink optimization             | Phase 2                 | Medium          | Medium |
| **5A** | Waypoints                      | Phase 2                 | Medium          | Low    |
| **5B** | Routes                         | Phase 5A                | Medium-High     | Low    |
| **5C** | Tracks                         | Phase 2                 | Medium          | Low    |
| **6**  | Settings, polish               | All above               | Medium          | Low    |

**Parallelism**: Phase 1A (raster) and 1B (vector pipeline) start simultaneously after Phase 0. This way raster charts provide a working map early while the vector pipeline — the highest-risk work — gets tackled immediately. If the vector pipeline hits serious blockers, raster charts keep the app functional.

Phase 2A (GPS) can also start in parallel with Phase 1.

---

## Key References

- **NOAA ENC data**: https://charts.noaa.gov/ENCs/ENCs.shtml
- **NOAA NCDS tiles**: https://distribution.charts.noaa.gov/ncds/index.html
- **MapLibre GL JS**: https://maplibre.org/
- **Signal K**: https://signalk.org/
- **freeboard-sk** (reference chartplotter): https://github.com/SignalK/freeboard-sk
- **s57-tiler**: https://github.com/wdantuma/s57-tiler
- **Finnish nautical chart vectors** (style reference): https://github.com/vokkim/finnish-nautical-chart-vectors
- **GDAL S-57 driver**: https://gdal.org/en/stable/drivers/vector/s57.html
- **PMTiles format**: https://protomaps.com/docs/pmtiles
- **S-52 presentation library** (reference): https://github.com/sduclos/S52
- **MarineCharts.io** (commercial vector tile API, for prototyping): https://marinecharts.io/
