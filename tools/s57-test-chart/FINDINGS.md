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

3. **`RDOCAL` (radio calling-in point) — FIXED.** The layer hard-coded
   `RDOCAL02` with no rotation. Re-implemented per the S-52/S-101
   `RadioCallingInPoint` rule: a known traffic direction (ORIENT + TRAFIC 1–4)
   draws the directional symbol rotated to the flow — `RDOCAL03` for two-way
   (TRAFIC 4), `RDOCAL02` otherwise; without a direction it falls back to the
   "direction unknown" `RCLDEF01`. Added the `RDOCAL03` + `RCLDEF01` S-52
   sprites (they were missing from the sheet). All three render verified
   visually (see catalog's one-way/two-way/default RDOCAL profiles).

4. **No shared-fallback icon — was a report artifact.** `CURENT`, `RSCSTA`,
   `SISTAT` each have their own distinct, correct S-52 symbol present in the
   sheet (`CURENT01`, `RSCSTA02`, `SISTAT03`) and a dedicated layer that
   references it statically; `NEWOBJ` has no point symbol by design. The
   render-report "resolved icon" column was unreliable (it reported the same
   `RDOCAL02` for all of them in one pass and different icons in another) —
   nothing actually funnels to a shared fallback.

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
- `?testChart=1` (dev only) overlays the test chart through the real iho-s52
  styles. Tree-shaken from production.
- `preserveDrawingBuffer` is enabled only in DEV (`canvasContextAttributes`).
- Renders go to `out/renders/iho-s52/` + `out/renders/contact-iho-s52.png`.
  The per-variant canvas screenshots are a secondary artifact and can be
  unreliable (the capture sometimes races symbol placement, yielding identical
  frames across variants) — trust the `styleimagemissing` count and a targeted
  re-screenshot over the contact sheet for fine detail.
