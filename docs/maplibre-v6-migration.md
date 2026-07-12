# MapLibre GL JS v6 migration notes

Living document tracking the 5.x → 6.x upgrade. **Last researched: 2026-07-12.**
We are on `maplibre-gl` 5.24.0 (the latest 5.x stable — nothing newer on that
line) with `@maplibre/maplibre-gl-style-spec` pinned to 24.8.1 (24.8.2 stripped
public types).

## Why upgrade

- v6 drops WebGL 1 entirely and consolidates on WebGL 2 — the main motivation
  for us: better performance on lower-end Android (Capacitor target), and it
  clears MapLibre's path toward a luma.gl-based renderer.
- The pre-releases also carry terrain rendering perf work, worker memory-leak
  fixes, a debounced `setImages` broadcast (faster when adding many images —
  we add sprite sheets per theme), and data-driven `line-dasharray`.

## Upstream status (as of 2026-07-12)

- v6 is in **pre-release**: `6.0.0-12` … `6.0.0-20` shipped through early July
  2026. The June 2026 newsletter says the team is "nearing the finish line for
  the version 6 breaking changes", waiting on two final PRs (#7800, #7839).
  No stable release date announced.
- **No official v5→v6 migration guide exists yet** (checked
  maplibre.org/maplibre-gl-js/docs/guides/ — only Leaflet/Mapbox/OpenLayers
  guides). One is promised alongside the release; re-check before starting.
- The breaking-changes tracker is
  [maplibre/maplibre-gl-js#6427](https://github.com/maplibre/maplibre-gl-js/issues/6427).

## Breaking changes vs. our exposure

### Blockers to clear first

- **WebGL 2 required** (6.0.0-2). Our early boot check accepts either context
  (`index.html` tries `webgl2 || webgl`). Before upgrading, verify WebGL 2 on
  the actual fleet: BOOX and BIGME e-ink WebViews (older Chromium), the
  cheap-Android-tablet cohort, and desktop Safari. If any target device is
  WebGL-1-only, the upgrade is off until it isn't. After upgrading, tighten
  the boot check and its user-facing message to WebGL 2.

### Real work expected

- **style-spec v25 with stricter legacy-expression validation** (6.0.0-16).
  We still use legacy filter syntax in several layers:
  `["==", "$type", "LineString"]` in `selection-halo.ts`, `BearingLine.ts`,
  `RouteLayer.ts`, and legacy `["has", …]` forms in `SafetyContour.ts`.
  Convert to modern expressions (`["==", ["geometry-type"], …]`) ahead of the
  bump — harmless on v5, removes a whole class of upgrade risk. Also unpin
  and bump `@maplibre/maplibre-gl-style-spec` 24.8.1 → 25.x at the same time
  and re-verify the public type exports (`ExpressionSpecification` et al.,
  imported in ~5 files) — the reason for the 24.8.1 pin.
- **Icon scaling with offset — render behavior change** (6.0.0-13). Our S-52
  symbol layers use per-symbol `icon-offset` expressions
  (`styles/icon-sets.ts`, `styles/layers/points.ts`, `PelLightLayer.ts`),
  often together with zoom-driven `icon-size`. Offset symbols (light flares
  especially) may land in different positions. Verify with the render-test
  chart (`render-test-chart.spec.ts`) and eyeball buoy/light placements.
- **Unit-test mocks using `map._fire(...)`** (`SafetyContour.test.ts`,
  `ChartMode.test.ts`, `host.test.ts`). Events became real classes
  instantiated on fire (6.0.0-17); `_fire` is private API and its argument
  shape may change. Expect to rework these harnesses.

### Should be transparent — verify at upgrade

- **ESM-only distribution** (6.0.0-5): we bundle with Vite and `import`
  everywhere; no UMD/CSP bundle use. Fine.
- **`addProtocol`**: no signature change announced through 6.0.0-20. All five
  of our protocols (`pmtiles`, overzoom, `local-glyphs`, plugin tile-cache,
  `osmtiles`) already use the promise/AbortController contract from v4.
  `pmtiles` ^4.4.0 should remain compatible — confirm its release notes when
  a stable v6 lands.
- **`MapDataEvent` removed**; `data`/`sourcedata`/`styledata` payloads are now
  `MapSourceDataEvent | MapStyleDataEvent`. Runtime shape is the same; TS
  types at our listeners (`ChartInUseReadout.ts`, `LightSectorLayer.ts`,
  `PelLightLayer.ts`, `SafetyContour.ts`, `testChartHarness.ts`) may need
  narrowing tweaks.
- **`styleimagemissing` becomes observe-only**; resolving a missing image now
  goes through the new `Map.setMissingStyleImageResolver`. Both of our
  listeners only observe (sprite-failure warning counter in
  `ChartManager.setupSpriteWarning`, missing-icon recorder in
  `testChartHarness.ts`) — no action expected, just confirm the event still
  fires for observers.
- **`Map` composes `Camera`; internal `map.transform` removed** (6.0.0-20).
  We never touch `map.transform` (checked); `pinch-zoom-guard.ts` uses public
  events only. Re-check any new code before the bump.
- **`GeoJSONSource.setData` lost its second parameter** (6.0.0-3): we never
  pass one.
- **GeoJSON nested objects in query results** (6.0.0-1): queried feature
  properties keep real nested objects instead of JSON strings. Our vector
  tiles are pre-flattened by the S-57 pipeline and our GeoJSON sources carry
  flat properties, so low risk — but `FeatureInfoPanel` renders whatever
  `queryRenderedFeatures` returns; spot-check it.
- **TS target ES2022, `Hash` refactored to `URLSearchParams`, shader
  `#pragma maplibre`**: no exposure (modern TS config, no URL-hash use, no
  custom shaders).

### Still only *planned* upstream — watch the tracker

- `Map#getStyle` / `GeoJSONSource#serialize` possibly becoming async — would
  touch 7 files for `getStyle()` (`ChartManager`, `RouteLayer`, `TrackLayer`,
  `BearingLine`, `FeatureQueryHandler`, `overlayDimming`, `testChartHarness`)
  and interacts with the style-diff hot path in [perf-findings](perf-findings.md).
- Default overscale zoom changing to 4 — could interact with our custom
  overzoom protocol handler (`OVERZOOM_SCHEME` in `main.ts`); re-test deep
  overzoom on sparse chart areas.

## Upgrade plan (when stable lands)

1. Re-check the official migration guide (should exist by then) and the final
   6.0.0 changelog against this doc.
2. **Device gate:** confirm WebGL 2 on BOOX / BIGME / low-end Android WebViews.
3. Pre-convert the legacy filters (works on v5, shrinks the diff).
4. Bump `maplibre-gl` + `@maplibre/maplibre-gl-style-spec` (unpin) + confirm
   `pmtiles` compat in one branch.
5. `bun run check`, full e2e including `render-test-chart.spec.ts`, then
   on-device Android testing — the WebGL 2 payoff and the risk both live
   there, not on desktop.

## Sources

- [Releases · maplibre/maplibre-gl-js](https://github.com/maplibre/maplibre-gl-js/releases)
- [CHANGELOG.md](https://github.com/maplibre/maplibre-gl-js/blob/main/CHANGELOG.md)
- [v6 breaking changes tracker #6427](https://github.com/maplibre/maplibre-gl-js/issues/6427)
- [MapLibre Newsletter June 2026](https://maplibre.org/news/2026-07-04-maplibre-newsletter-jun-2026/)
- [MapLibre GL JS guides index](https://maplibre.org/maplibre-gl-js/docs/guides/) (no v5→v6 guide yet)
