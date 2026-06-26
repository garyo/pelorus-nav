# S-57 test chart

A synthetic chart that exercises (nearly) every S-57 object class the pipeline
processes, in as many variants as practical — geometry primitive
(point/line/area), labeled/unlabeled, and key attribute variations that drive
iconography (buoy shape, light characteristic, wreck category, …).

Built for three jobs:

1. **Test chart** — `catalog.ts` is the single source of truth; `generate.ts`
   expands it into per-class GeoJSON + a real `test-chart.pmtiles` (one MVT
   source-layer per class, exactly like the production pipeline) so the *real*
   styles render it unmodified.
2. **Render check** — `tests/e2e/render-test-chart.spec.ts` loads the chart,
   captures the missing-icon set + per-class rendered counts, and screenshots a
   contact sheet. Verifies iconography and text.
3. **Click check** — `src/chart/feature-info.coverage.test.ts` drives the pure
   `formatFeatureInfo()` over every variant and reports what each clickable
   feature shows (and gaps: fallbacks, missing names/types).

## Usage

```bash
bun tools/s57-test-chart/generate.ts        # → out/geojson/, out/manifest.json, out/test-chart.pmtiles (+ public/)
bun run test src/chart/feature-info.coverage # click-output coverage + report
bun run e2e tests/e2e/render-test-chart      # renders + missing-icon report (needs dev server)
```

Outputs land in `out/` (gitignored, regenerable). The grid layout in
`manifest.json` gives each variant a unique lng/lat so renders and clicks are
unambiguous.
