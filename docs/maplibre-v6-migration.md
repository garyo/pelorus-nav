# MapLibre GL JS v6 Migration Research

_Pelorus Nav v0.2.2 · MapLibre 5.24.0 → 6.x · Research date: 2026-05-03_

---

## Summary

**Recommendation:** Wait for v6.0.0 stable before migrating. As of this writing the latest release is **6.0.0-6** (pre-release, published 2026-05-01). The stable `5.24.0` we ship is the last v5 release.

**Risk level: Medium.** None of the v6 breaking changes are show-stoppers for Pelorus Nav. The bulk of the work is TypeScript-level: tightened `{get,set}PaintProperty` / `{get,set}LayoutProperty` types will require a typecheck pass, and `GeoJSONSource.setData` loses its second parameter (we don't pass it, so zero changes needed there). The big win is WebGL 2 exclusivity — Android WebView has supported WebGL 2 since Android 8.0, which covers our entire target fleet. The ESM-only distribution is a non-issue for a Vite project.

The `@maplibre/maplibre-gl-style-spec` pinning concern (we're on exactly 24.8.1 because 24.8.2 stripped public type exports) should resolve naturally: once we point at `maplibre-gl@6`, the style-spec it re-exports will be the v6-bundled version and the separate `@maplibre/maplibre-gl-style-spec` dependency can likely be dropped entirely (all our style-spec imports that come from there are also available as re-exports from `maplibre-gl` itself).

---

## Pre-release Status

v6.0.0 has **not shipped as stable.** Pre-release cadence (all April–May 2026):

| Tag | Date | Key change |
|---|---|---|
| 6.0.0-0 | 2026-04-27 | Hash control → URLSearchParams |
| 6.0.0-1 | 2026-04-27 | setData type narrowing; `__$json__` encoding for nested GeoJSON |
| 6.0.0-2 | 2026-04-28 | **WebGL 1 removed; WebGL 2 required** |
| 6.0.0-3 | 2026-04-29 | `GeoJSONSource.setData` second param removed; TS target → ES2022 |
| 6.0.0-4 | 2026-04-29 | `zoomLevelsToOverscale` default 4 (was `undefined`) |
| 6.0.0-5 | 2026-04-29 | **ESM-only; UMD / CSP bundles dropped** |
| 6.0.0-6 | 2026-05-01 | Rolldown bundler; `terrainSkirtLength` option |

---

## Breaking Changes

### 1. WebGL 2 required (6.0.0-2)
WebGL 1 support is fully removed. Map instantiation will throw (or display an error) on WebGL-1-only browsers.

**Our exposure:** None in practice.
- Android WebView has supported WebGL 2 since Android 8.0 (API 26). Capacitor's `minSdkVersion` already requires ≥ 26.
- Desktop browsers (Chrome 56+, Firefox 51+, Safari 15+) are all fine.
- The `Map._showWebGL2Error` override hook is available if a custom error UI is needed.

**Effort:** Trivial. Add a note to `PLAN.md` and close.

---

### 2. ESM-only distribution (6.0.0-5)
The UMD bundle (`maplibre-gl.js`) and CSP-specific bundle (`maplibre-gl-csp.js`) are gone. Only `maplibre-gl.mjs` is published.

**Our exposure:** None.
- We use Vite, which has always resolved via ESM package exports.
- We have no `<script>` tags loading MapLibre; everything goes through Vite's bundler.
- The `worker-src blob:` CSP exemption we may be relying on can be removed — ESM mode loads workers from real URLs.
- **CSS path** `maplibre-gl/dist/maplibre-gl.css` (imported at `src/main.ts:3`) should still resolve; verify after bump.

**Effort:** Trivial. Verify CSS import path resolves; remove `worker-src blob:` from any CSP headers if present.

---

### 3. `GeoJSONSource.setData` second parameter removed (6.0.0-3)
`setData(data, waitForCompletion?)` loses the optional second param and no longer returns `this`.

**Our exposure:** Zero. A grep for `setData(` across all 35+ call sites shows every call passes only a GeoJSON argument — no second argument, no chaining on the return value.

**Effort:** None.

---

### 4. `{get,set}PaintProperty` / `{get,set}LayoutProperty` type narrowing (6.0.0-1)
These methods now use actual property types instead of `string | any`. TypeScript will reject mismatched values.

**Our exposure:** Moderate. We call these in 14 places:
- `src/main.ts:753–771` — 8 calls (`line-opacity`, `circle-opacity`, `text-opacity`, `icon-opacity`) with `number` values. Should be fine.
- `src/vessel/CourseLine.ts:135` — `setLayoutProperty(…, "visibility", vis)` where `vis` is derived from a boolean; check that `vis` is typed `"visible" | "none"`, not `boolean`.
- `src/vessel/VesselLayer.ts:219,222` — same visibility pattern.
- `src/map/RouteLayer.ts:316`, `src/map/TrackLayer.ts:255` — paint property with an `ExpressionSpecification` value. Should be accepted.
- `src/chart/SafetyContour.ts:178,190` — `setPaintProperty(…, "fill-color" | "text-color", colorExpr)` where `colorExpr` is an `ExpressionSpecification`.

The main risk is the `"visibility"` calls where the value must be typed as `"visible" | "none"` not `string` or `boolean`. A full `bun run typecheck` after the bump will surface any rejects.

**Effort:** Small. One typecheck pass; likely 3–5 one-line fixes for visibility typing.

---

### 5. TypeScript compilation target → ES2022 (6.0.0-3)
The library itself is now compiled to ES2022, so consumers get ES2022 syntax from MapLibre. If your own toolchain transpiles below ES2022 you must also transpile `node_modules/maplibre-gl`.

**Our exposure:** None. `vite.config.ts` already sets `build.target: "es2022"`, so our output target matches.

**Effort:** None.

---

### 6. Hash-based location control uses URLSearchParams (6.0.0-0)
The `Hash` plugin parses the URL hash differently; edge-case formats like `#10%2F3.00%2F-1.00` are now accepted; bare `#foo` normalizes to `#foo=`.

**Our exposure:** We do not use MapLibre's built-in hash control (`{hash: true}` option). CenterCrosshair and main.ts manage navigation state independently.

**Effort:** None.

---

### 7. `zoomLevelsToOverscale` default changed to 4 (6.0.0-4)
Previously `undefined` (disabled); now defaults to `4`. This affects label placement at high zoom levels and may subtly change `queryRenderedFeatures` results in overscaled tiles.

**Our exposure:** Low. We call `queryRenderedFeatures` in 13 places (DraggablePoints, RouteEditor, PlottingLayer, FeatureQueryHandler) — these are all interactive hit-tests on explicitly-named layers, so overscaling artifact label bleed should not matter. Worth a quick visual regression test at high zoom.

**Effort:** Trivial. Visually test chart labels at zoom 18+ after upgrade.

---

### 8. GeoJSON nested object `__$json__` encoding (6.0.0-1)
Properties that were previously objects (passed through buggy) are now encoded with a `__$json__` prefix.

**Our exposure:** None visible. Our pipeline flattens all S-57 list attributes to comma-separated strings; we never pass raw nested objects as GeoJSON properties at runtime. No call site does anything like `{ properties: { foo: { nested: true } } }`.

**Effort:** None.

---

### 9. Style-spec package: `@maplibre/maplibre-gl-style-spec` pinned at 24.8.1
We pin this separately because 24.8.2 stripped public type exports.

**Our exposure:** This is the primary motivation for the upgrade. In v6, MapLibre re-exports all style-spec types from `maplibre-gl` itself. The 12 files that import directly from `@maplibre/maplibre-gl-style-spec` can be migrated to import from `maplibre-gl` instead, and the pinned peer dependency can be dropped.

Files with direct style-spec imports:
- `src/map/point-icons.ts:10`
- `src/map/plotting/plot-icons.ts:12`
- `src/chart/PelLightLayer.ts:29`
- `src/chart/LightSectorLayer.ts:10`
- `src/chart/styles/style-context.ts:4`
- `src/chart/styles/icon-sets.ts:1`
- `src/chart/styles/layers/areas.ts:11`
- `src/chart/styles/layers/lines.ts:8`
- `src/chart/styles/layers/navigation.ts:8`
- `src/chart/styles/layers/points.ts:10`
- `src/chart/styles/layers/text.ts:11`
- `src/chart/osm-underlay.ts:9`

**Effort:** Small. Mechanical find-and-replace of import source; verify with typecheck.

---

## Touch Points (file:line, grouped by category)

### A. GeoJSONSource.setData — 35+ calls, **zero changes needed**
No second argument passed anywhere. Affected files (informational only):
`src/vessel/CourseLine.ts:212,221`, `src/vessel/VesselLayer.ts:188,207`,
`src/map/TrackLayer.ts:191,253,293`, `src/map/RouteLayer.ts:117,216,254,314,371`,
`src/map/MeasurementLayer.ts:211,214,231`, `src/map/BearingLine.ts:118,149`,
`src/map/WaypointLayer.ts:137`, `src/map/RouteEditor.ts:486,510,517,528,533,547,559,591,605`,
`src/map/plotting/PlottingLayer.ts:915–920`,
`src/chart/PelLightLayer.ts:471`, `src/chart/LightSectorLayer.ts:519,528`,
`src/chart/FeatureQueryHandler.ts:619`

**Estimated effort:** None.

---

### B. `setLayoutProperty` visibility typing — 3 call sites, **small fix**
| File | Line | Change needed |
|---|---|---|
| `src/vessel/CourseLine.ts` | 135 | Verify `vis` parameter is typed `"visible" \| "none"` |
| `src/vessel/VesselLayer.ts` | 219 | Same |
| `src/vessel/VesselLayer.ts` | 222 | Same |

**Estimated effort per file:** Trivial (1-line type annotation or cast).

---

### C. `@maplibre/maplibre-gl-style-spec` imports → re-export from `maplibre-gl` — 12 files
All are `import type { ExpressionSpecification, … }` — change source string only.

| File | Effort |
|---|---|
| `src/chart/styles/style-context.ts` | Trivial |
| `src/chart/styles/icon-sets.ts` | Trivial |
| `src/chart/styles/layers/areas.ts` | Trivial |
| `src/chart/styles/layers/lines.ts` | Trivial |
| `src/chart/styles/layers/navigation.ts` | Trivial |
| `src/chart/styles/layers/points.ts` | Trivial |
| `src/chart/styles/layers/text.ts` | Trivial |
| `src/chart/osm-underlay.ts` | Trivial |
| `src/chart/PelLightLayer.ts` | Trivial |
| `src/chart/LightSectorLayer.ts` | Trivial |
| `src/map/point-icons.ts` | Trivial |
| `src/map/plotting/plot-icons.ts` | Trivial |

**Estimated effort:** Small total (one-liner per file; automatable with `sed`).

---

### D. CSS import path — 1 call site
`src/main.ts:3` — `import "maplibre-gl/dist/maplibre-gl.css"` — verify path is still valid with v6 package layout.

**Estimated effort:** Trivial.

---

### E. `addProtocol` (pmtiles protocol registration) — `src/main.ts:97`
```ts
addProtocol("pmtiles", protocol.tilev4);
```
`addProtocol` API is unchanged between v5 and v6. pmtiles 4.x changelog has no v6-specific notes; the `Protocol` / `tilev4` interface uses only `addProtocol` which is stable. **No change needed.** However, pmtiles compatibility with v6's WebGL-2-only renderer is at the tile-data level (protocol transport), not the WebGL level, so no issue exists.

**Estimated effort:** None; but verify after bump by loading a PMTiles chart in dev.

---

### F. `setPaintProperty` calls with expression values — `src/chart/SafetyContour.ts:178,190`
These pass `ExpressionSpecification` values to color properties. With v6's tightened types, `ExpressionSpecification` should still be accepted by color paint properties. Flag for typecheck.

**Estimated effort:** Trivial.

---

### G. `queryRenderedFeatures` — 13 call sites
API is unchanged. The `zoomLevelsToOverscale` default change (breaking change #7) could theoretically affect results at very high zoom, but all our usages filter by explicit layer IDs, not feature content.

**Estimated effort:** None (test only).

---

## Open Questions

1. **CSS path** — does `maplibre-gl/dist/maplibre-gl.css` survive the ESM-only restructure, or does it move to `maplibre-gl/maplibre-gl.css`? Check the v6 `package.json` exports map when upgrading.

2. **`@maplibre/maplibre-gl-style-spec` re-export completeness** — does v6's `maplibre-gl` re-export *all* types we use (`ExpressionSpecification`, `LayerSpecification`, `SourceSpecification`, `SymbolLayerSpecification`, `FillLayerSpecification`, `BackgroundLayerSpecification`, `FilterSpecification`, `StyleSpecification`)? Confirm by checking the v6 type declarations before dropping the direct dependency.

3. **pmtiles 4.x / MapLibre v6 integration** — the pmtiles CHANGELOG has no v6-specific notes. After bumping, load a PMTiles chart in dev and check the browser console for protocol errors. If `protocol.tilev4` signature changes, `src/main.ts:97` will need updating.

4. **`setPaintProperty` / `setLayoutProperty` value types** — run `bun run typecheck` immediately after the version bump to surface any rejects from the new type narrowing. The CI check (breaking change #4) is the most likely source of compile errors.

5. **Feature state performance change** — v6.0.0-6 replaces string-indexed objects with arrays for feature state storage (3.4× speedup claimed). We don't use `setFeatureState` currently, but if we add it in a future feature (e.g., hover highlighting), this is a pure win.

6. **Stable release timing** — as of research date (2026-05-03), only pre-releases exist. Monitor the MapLibre releases page for 6.0.0 stable before scheduling the upgrade sprint.

---

## Suggested Upgrade Order

1. **Wait for v6.0.0 stable** — avoid pinning a pre-release in a shipping product.
2. **Bump `maplibre-gl`** in `package.json` (and remove the `@maplibre/maplibre-gl-style-spec` pin once confirmed that v6 re-exports all needed types).
3. **Run `bun run typecheck`** — fix any `setLayoutProperty`/`setPaintProperty` type rejects (expected ≤5 trivial changes).
4. **Migrate style-spec imports** — mechanically replace `from "@maplibre/maplibre-gl-style-spec"` with `from "maplibre-gl"` in the 12 affected files.
5. **Verify CSS import path** — check `src/main.ts:3` resolves correctly.
6. **Start dev server** — load a PMTiles chart, confirm protocol works, no console errors.
7. **Visual regression at high zoom** — check chart labels at zoom 18+ (breaking change #7).
8. **Run `bun run check`** — full typecheck + lint + unit tests.
9. **Run `bun run e2e`** — Playwright smoke tests.
10. **Test Android** — run `bun run cap:run` on a device; confirm WebGL 2 works (it will on any modern device, but worth a sanity check).
