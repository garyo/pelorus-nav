# S-57 test-chart — findings

Overnight build (2026-06-25/26) of a synthetic chart exercising every S-57 class,
rendered through the real styles and run through the click formatter. Three
deliverables, all on branch `test/s57-feature-coverage`; `bun run check` green
(780 tests). Regenerate everything with the commands in `README.md`.

## What was built

| Part | Deliverable | Result |
|---|---|---|
| 1. Test chart | `catalog.ts` + `generate.ts` → per-class GeoJSON + `test-chart.pmtiles` | **262 variants / 111 classes**, point+line+area, labeled/unlabeled, icon-driving attrs |
| 2. Renders | `tests/e2e/render-test-chart.spec.ts` → `out/render-report.md` + 262 screenshots + contact sheet | **0 missing icons**; 237/262 rendered (iho-s52) |
| 3. Clicks | `src/chart/feature-info.coverage.test.ts` → `out/click-report.md` | **87 clickable classes, 0 code leaks, 0 missing names** |

## Headline findings (actionable)

1. **Iconography is healthy — zero `styleimagemissing` in either symbology
   scheme.** Every `icon-image` a style references resolves to a real sprite.

2. **`pelorus-standard` symbology is effectively dead in production.**
   `settings.ts` hard-forces `symbologyScheme = "iho-s52"` (the chooser was
   removed), so the app only ever loads the S-52 sprite sheet. The harness had to
   `setSprite()` manually to render pelorus-standard at all. **Decision needed:**
   revive the pelorus-standard chooser, or delete that scheme + its `ecdis-*`
   sprite pipeline as dead weight.

3. **One genuine point-render gap in the live (iho-s52) scheme: `RDOCAL`**
   (radio calling-in point) renders *nothing* at its location. Worth a style fix.

4. **Possible shared-fallback icon — verify.** In the icon-usage table, several
   unrelated minor point classes (`CURENT`, `NEWOBJ`, `RSCSTA`, `SISTAT`) all
   report the same resolved icon `RDOCAL02`. Either the icon expression funnels
   them to one fallback symbol, or it's a report sampling artifact — check
   `icon-sets.ts` for these classes.

5. **Click output is solid.** `formatFeatureInfo()` never leaks a raw S-57 code,
   always produces a human display name, and decodes attributes well (e.g.
   "Red Can", "Fl W 4s 25m 18M", "Marina, Fuel Station, Pumpout", wreck depth
   annotated in the title). Minor UX nits:
   - Buoys/beacons with no `LABEL` show their `OBJNAM` under a **"Number"** row
     (e.g. *Number: Beacon Port*) — mislabeled.
   - `RESARE` can show two **"Restriction"** rows (CATREA + RESTRN) — redundant.

## Expected non-issues (not bugs)

- **Text-only points** in iho-s52 (rendered, no icon, by S-52 design): SOUNDG
  (depth numbers), MAGVAR, SBDARE, LNDMRK/LNDELV/LNDRGN, BERTHS, SMCFAC, BUAARE,
  BUISGL, PILPNT. Most are correct; `PILPNT` (piling) is arguably worth a symbol.
- **Outline-only regulatory polygons read as "blank"** in the report (RESARE,
  ACHARE, OSPARE, DGRARE, TESARE, EXEZNE, MIPARE, CBLARE, PIPARE, TSSLPT, SEAARE,
  …): the harness queries each feature's **centroid**, but these styles draw only
  the boundary, so nothing is at the centroid. Visually fine — see the contact
  sheet. This is a harness limitation, not a render bug.
- **Point geometries of normally-areal classes** (AIRARE, RUNWAY, DRYDOC, FLODOC,
  FORSTC, SILTNK, CTNARE, PRCARE, TUNNEL, LNDARE, VEGATN as points): the styles
  only handle these as polygons, so the synthetic point variant renders nothing.
  Expected — they exist in the catalog for completeness.

## Harness notes
- `?testChart=1[&scheme=iho-s52|pelorus-standard]` (dev only) overlays the test
  chart through the real styles. Tree-shaken from production.
- `preserveDrawingBuffer` is enabled only in DEV (`canvasContextAttributes`).
- iho-s52 is screenshotted programmatically; pelorus-standard has full PNGs +
  `out/renders/contact-pelorus-standard.png`.
