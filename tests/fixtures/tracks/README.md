# GPX track fixtures

Real-world tracks captured from the app, kept here for regression testing
of GPS-pipeline changes (smoothers, filters, outlier rejection) and as
inputs for the experimental scripts under `tools/rts-smoother/`.

| File | Date | Conditions | Notes |
|------|------|------------|-------|
| `Track 2026-05-06 10_59.gpx` | 2026-05-06 | E-ink device, screen on most of the time, walking | Clean reference. Median smoother shift ~1.2 m, no outliers. Use to verify changes don't introduce false-positive flagging. |
| `Track 2026-05-06 12_01.gpx` | 2026-05-06 | E-ink device, ~11 min screen-off in pocket, mixed walking/driving | Higher overall noise (median shift ~5 m, p95 ~19 m). Several samples sit in the statistical tail (~25-30 m shift) but are not real outliers. Verifies that conservative outlier thresholds don't flag normal-tail samples on a noisier track. |
| `Track 2026-05-06 16_38.gpx` | 2026-05-06 | Samsung phone, long walk with screen-off intervals | Single bad fix at idx 87 (110 m off the trajectory) following a 32 s passive→active transition. Smoother pulls it back to ~33 m residual. Canonical "outlier rejection should catch this" test case. |
| `pelorus-tracks-bad.gpx` | 2026-05-05 | Samsung phone, recorded before the unified-pipeline fix | Mostly raw FLP samples (7-decimal precision) interleaved with a few filtered fixes — pre-fix regression sample. Useful to verify that loading and re-processing legacy noisy data behaves sensibly. |

## Adding a track

1. Drop the GPX into this directory.
2. Add a row to the table above describing what's in it and what scenario
   it covers.
3. If it exposes a new pipeline issue, add a unit test that loads it via
   the GPX parser and asserts the expected behaviour.

Tracks here are checked in (not gitignored) — small enough that the cost
is negligible and the value of having a real-data corpus is high.
