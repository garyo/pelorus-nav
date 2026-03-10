# E-Ink Optimization Plan

## Overview

This plan covers rendering and interaction optimizations for color e-ink displays (e.g., Boox Tab Ultra C, Kobo Libra Colour). The goal is a configurable system that can adapt to varying e-ink panel capabilities — from slow grayscale panels (~300ms refresh) to newer color panels with faster partial refresh (~150ms).

Target devices run Android or have a Chromium-based browser with WebGL support (ANGLE/SwiftShader).

---

## Current State

What's already done:
- **E-ink CSS theme**: `[data-theme="eink"]` — no shadows, no rounded corners, 2px solid borders, pure B/W UI (`style.css`)
- **E-ink colour palette**: greyscale S-52 palette in `s52-colours.ts` (72 tokens, all monochromatic)
- **Jump-cut positioning**: `ChartMode` always uses `jumpTo()`, never `flyTo()` for vessel following
- **`updateRateHz` setting**: defined in `settings.ts` (default 1 Hz) but **not yet wired** to control anything
- **Course smoothing**: 60fps exponential smoothing in `CourseSmoothing.ts` — useful on LCD, wasteful on e-ink
- **No CSS animations**: only one `transition: width 0.2s` on a progress bar; no `@keyframes` anywhere

What's missing:
- Render loop throttling (currently runs at 60fps via MapLibre `render` event)
- GPS update throttling (simulator is 1Hz, but browser geolocation can be faster)
- MapLibre animation control (pinch-zoom, double-tap zoom, `flyTo` for region switching)
- Touch debouncing for e-ink input lag
- Full-screen refresh trigger (to clear ghosting)
- `prefers-reduced-motion` media query support

---

## Design Principles

1. **Configurable, not hardcoded** — e-ink panels vary widely; expose knobs rather than assuming worst-case
2. **Single boolean gate** — one `einkMode: boolean` setting controls the overall behaviour; individual sub-settings allow fine-tuning
3. **No separate code paths where possible** — prefer parameterizing existing code (throttle intervals, animation durations) over if/else branches
4. **Degrade gracefully** — if a setting isn't available, fall back to sensible defaults
5. **Test without hardware** — all e-ink behaviour should be activatable in desktop Chrome for development

---

## Implementation Plan

### 1. E-Ink Mode Setting & Detection

**File**: `src/settings.ts`

Add a top-level `einkMode: boolean` (default `false`). When enabled, it:
- Forces `displayTheme` to `"eink"` (or allows user override to day/dusk for color e-ink)
- Sets default `updateRateHz` to 1
- Disables MapLibre animations (see §3)
- Enables touch debouncing (see §5)

Auto-detection: no reliable API exists. Offer a toggle in Settings. Optionally detect Boox user-agent strings as a hint to prompt the user.

```typescript
// settings.ts additions
einkMode: boolean;          // default false
einkRefreshMs: number;      // default 200 — minimum interval between render frames
einkDisableAnimations: boolean; // default true when einkMode on
```

When `einkMode` flips on, apply all sub-settings as defaults (user can still override individually).

### 2. Render Loop Throttling

**Files**: `src/main.ts` (render event handler), `src/navigation/CourseSmoothing.ts`

Currently, `map.on("render", ...)` fires at 60fps and calls `courseSmoother.smooth()` + `triggerRepaint()` on every frame.

**Change**: Gate the render callback with a timestamp check:

```typescript
let lastRenderTime = 0;
const minRenderInterval = settings.einkMode ? settings.einkRefreshMs : 0;

map.on("render", () => {
  const now = performance.now();
  if (now - lastRenderTime < minRenderInterval) return;
  lastRenderTime = now;

  // existing smoothing + repaint logic
});
```

When `einkRefreshMs` is 200ms, this limits to ~5fps. At 500ms, ~2fps. At 1000ms, 1fps.

**Course smoothing**: when `einkMode` is on, skip exponential smoothing entirely — use raw (or lightly averaged) GPS values. Smooth animation between GPS fixes is counterproductive on e-ink since it causes ghosting. Set smoothing tau values to 0 (or bypass the smoother).

### 3. MapLibre Animation Control

**File**: `src/main.ts`, `src/vessel/ChartMode.ts`

MapLibre has built-in animations for:
- **Double-tap zoom**: animated zoom-in
- **Pinch-zoom**: animated inertia after release
- **`flyTo()`**: smooth camera transition (used for region switching)
- **Scroll-wheel zoom**: animated zoom steps

In e-ink mode, disable or shorten these:

```typescript
if (settings.einkMode && settings.einkDisableAnimations) {
  // On map creation or settings change:
  map.dragRotate.disable();          // optional: rotation causes heavy ghosting
  // Override flyTo to use jumpTo:
  const origFlyTo = map.flyTo.bind(map);
  map.flyTo = (opts) => { map.jumpTo(opts); return map; };
  // Or set animation duration to 0 for all easeTo/flyTo calls
}
```

MapLibre `Map` constructor options to set:
- `fadeDuration: 0` — disables tile fade-in (important! default 300ms causes ghosting)
- `bearingSnap: 0` — disable bearing snap animation
- Consider `renderWorldCopies: false` to reduce rendering work

For **zoom animations**, MapLibre doesn't have a single "disable all animations" flag. Options:
1. Set `map.scrollZoom.setZoomRate()` and `map.scrollZoom.setWheelZoomRate()` to high values (instant zoom)
2. Patch `easeTo` to use duration 0 when einkMode is on
3. Use `map.on("movestart", ...)` to call `map.stop()` to cancel in-progress animations

**Recommended approach**: Monkey-patch `map.easeTo` and `map.flyTo` to force `duration: 0` when einkMode is on. This catches all animation sources without needing to find each call site.

### 4. GPS & Navigation Update Throttling

**Files**: `src/navigation/NavigationDataManager.ts`, `src/main.ts`

Wire the existing `updateRateHz` setting to throttle navigation data broadcasts:

```typescript
// In NavigationDataManager, throttle subscriber notifications
private lastBroadcast = 0;
private broadcast(data: NavigationData) {
  const now = performance.now();
  const interval = 1000 / settings.updateRateHz;
  if (now - lastBroadcast < interval) return;
  lastBroadcast = now;
  // notify subscribers...
}
```

For e-ink, default `updateRateHz` to 1 (one position update per second). User can lower to 0.5 or raise to 2 depending on panel speed.

**Vessel layer**: Currently updates on every navigation broadcast. With throttling in the manager, vessel position updates naturally slow down. No changes needed in `VesselLayer.ts`.

### 5. Touch Input Optimization

**File**: new `src/utils/eink-touch.ts` or integrated into existing event handlers

E-ink touchscreens have higher latency (~50-100ms) and less precise digitizers. Optimizations:

1. **Debounce tap events** (50ms) to avoid double-fires from slow panel refresh
2. **Increase touch target sizes** via CSS: min 48px for all interactive elements (buttons, selects, sliders)
3. **Disable drag-rotate** (two-finger rotate) — it causes heavy ghosting and is rarely needed on a boat
4. **Larger hit areas for map features**: increase `queryRenderedFeatures` bbox padding from 20px to 40px

CSS additions for `[data-theme="eink"]`:
```css
[data-theme="eink"] button,
[data-theme="eink"] select,
[data-theme="eink"] input {
  min-height: 48px;
  min-width: 48px;
}
```

### 6. Full-Screen Refresh

**File**: new `src/ui/EinkRefreshButton.ts` or addition to existing controls

E-ink panels accumulate ghosting artifacts. Provide:

1. **Manual refresh button**: forces a full-screen repaint by briefly toggling visibility or using a CSS hack (flash white → redraw)
2. **Auto-refresh timer**: optional, every N minutes (configurable, default off)

Implementation approach:
```typescript
function forceFullRefresh() {
  // Force MapLibre to do a clean redraw
  const container = document.getElementById("map")!;
  container.style.display = "none";
  requestAnimationFrame(() => {
    container.style.display = "";
    map.resize();
    map.triggerRepaint();
  });
}
```

Some Boox devices expose a system API for triggering e-ink refresh modes. If accessible from the browser (unlikely), use it. Otherwise the CSS toggle approach works.

### 7. Reduced Repaint Areas

**Files**: `src/ui/NavigationHUD.ts`, `src/ui/InstrumentHUD.ts`

HUD overlays (position, speed, course) update independently of the map. Currently they're DOM elements overlaid on the map canvas — this is already good for e-ink since DOM updates don't trigger a full WebGL redraw.

Ensure:
- HUD text changes use `textContent` assignment (not `innerHTML` which causes layout reflow)
- HUD containers have `will-change: contents` or are positioned with `transform` to get their own compositor layer — already the case since they use `position: fixed/absolute`
- In einkMode, only update HUD text when values actually change (avoid re-rendering identical text)

### 8. Chart Style Adjustments for Color E-Ink

**File**: `src/chart/s52-colours.ts`

The current e-ink palette is pure greyscale. For **color e-ink** (Kaleido, Gallery 3):
- Keep the existing greyscale palette as `"eink-mono"`
- Add a `"eink-color"` palette: muted, high-saturation versions of the day palette
  - Color e-ink panels have limited gamut (~4096 colors) and low saturation
  - Boost saturation and contrast vs. day palette
  - Reduce gradients (e-ink dithers badly on smooth gradients)
  - Keep buoy/light colours distinct (critical for navigation safety)

For now, the existing day palette works acceptably on color e-ink. The greyscale palette is there for monochrome panels. This can be refined once testing on real hardware.

### 9. MapLibre `fadeDuration` and Tile Loading

**File**: `src/chart/ChartManager.ts`

When creating the MapLibre map in e-ink mode, set:
```typescript
const map = new maplibregl.Map({
  // ...existing options
  fadeDuration: settings.einkMode ? 0 : 300,
});
```

`fadeDuration: 0` eliminates the tile fade-in animation, which is one of the most visible sources of ghosting on e-ink. Tiles snap in instantly.

Also consider `map.setMaxTileCacheSize()` — larger cache reduces tile reloading and thus repaints.

---

## Settings Summary

| Setting | Type | Default (LCD) | Default (E-Ink) | Description |
|---------|------|---------------|-----------------|-------------|
| `einkMode` | boolean | false | true | Master e-ink toggle |
| `einkRefreshMs` | number | 0 | 200 | Min ms between render frames |
| `einkDisableAnimations` | boolean | false | true | Force jumpTo, no fade, no inertia |
| `updateRateHz` | number | 10 | 1 | GPS/nav data broadcast rate |
| `displayTheme` | string | "day" | "eink" | Colour scheme (greyscale or muted color) |

Advanced (future):
| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `einkAutoRefreshMin` | number | 0 | Auto full-refresh interval (0=off) |
| `einkColorMode` | "mono"\|"color" | "color" | Greyscale vs color e-ink palette |
| `einkDragRotate` | boolean | false | Allow two-finger rotation |

---

## Implementation Order

1. **Wire `updateRateHz`** — throttle nav data in NavigationDataManager (small, testable)
2. **Render loop throttle** — gate the `render` event callback with `einkRefreshMs`
3. **`fadeDuration: 0`** — set on map creation when einkMode is on
4. **Animation patching** — monkey-patch `easeTo`/`flyTo` to force `duration: 0`
5. **Course smoothing bypass** — skip exponential smoothing in einkMode
6. **Touch target CSS** — increase sizes for `[data-theme="eink"]`
7. **Full-screen refresh button** — add to topbar when einkMode is on
8. **Test on real hardware** — validate all of the above, tune `einkRefreshMs` default

Steps 1-6 are all testable on desktop Chrome with the e-ink mode toggle. Step 7 is a small UI addition. Step 8 requires a device.

---

## Testing Without Hardware

All e-ink optimizations can be verified on desktop:
- Toggle `einkMode` in settings
- Verify render loop fires at throttled rate (add `console.count` or FPS counter)
- Verify no animations play (zoom, pan, tile fade)
- Verify touch targets meet 48px minimum (Playwright viewport test)
- Verify HUD updates at `updateRateHz` rate
- Chrome DevTools "Rendering" → "Frame Rendering Stats" to confirm reduced frame rate
- Playwright E2E: enable einkMode, verify no `transition`/`animation` CSS properties active

Real device testing is needed for:
- Ghosting evaluation (tuning `einkRefreshMs`)
- Touch latency / debounce tuning
- Full-screen refresh effectiveness
- Battery life impact
- WebGL performance (SwiftShader fallback if no GPU)
