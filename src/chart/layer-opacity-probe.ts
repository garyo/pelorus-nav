/**
 * Runtime check that MapLibre's `fill-layer-opacity` composites correctly.
 *
 * The street underlay leans on that property to tint land once per layer
 * rather than once per feature (see applyUnderlay). It renders the layer to an
 * offscreen buffer and composites the result, and on at least one Linux
 * Firefox / driver combination that composite escapes its layer and dims the
 * whole frame — the chart draws normally for about a second, then everything,
 * water and white text included, drops to roughly 42% brightness. No CSS
 * filter is involved and the DOM around the canvas is untouched, so nothing
 * short of rendering a frame can tell the two apart.
 *
 * So render one, offscreen, at startup: a half-covered square whose uncovered
 * half must come back exactly as drawn. A fill layer may only paint inside its
 * own features; if the uncovered half changed, the composite is leaking and
 * the underlay falls back to per-feature `fill-opacity`.
 *
 * Failure to probe at all counts as support: the fallback stacks alpha where
 * ENC cells overlap, and that visible seam shouldn't be inflicted on everyone
 * over an inconclusive measurement.
 */

import * as maplibregl from "maplibre-gl";

const PROBE_SIZE = 64;
const PROBE_TIMEOUT_MS = 4000;
/** JPEG-free readback, but antialiasing still blends edges. */
const CHANNEL_TOLERANCE = 6;

const BACKGROUND: [number, number, number] = [255, 0, 0];
const FILL: [number, number, number] = [0, 0, 255];
const FILL_LAYER_OPACITY = 0.5;

export interface LayerOpacityProbeResult {
  /** False only on a frame that proves the composite leaks. */
  supported: boolean;
  /** One line for the diagnostics report. */
  detail: string;
}

let cached: LayerOpacityProbeResult | null = null;

/** The last probe's result, or null before it has run. */
export function getLayerOpacityProbe(): LayerOpacityProbeResult | null {
  return cached;
}

/** True unless a probe has actually shown the composite to be broken. */
export function isLayerOpacitySupported(): boolean {
  return cached?.supported ?? true;
}

/**
 * Render the probe frame once and cache the verdict. Safe to call repeatedly;
 * only the first call renders.
 */
export async function probeLayerOpacity(): Promise<LayerOpacityProbeResult> {
  if (cached) return cached;
  cached = await runProbe();
  return cached;
}

async function runProbe(): Promise<LayerOpacityProbeResult> {
  const container = document.createElement("div");
  container.style.cssText =
    `position:absolute;left:-${PROBE_SIZE * 2}px;top:0;` +
    `width:${PROBE_SIZE}px;height:${PROBE_SIZE}px;pointer-events:none`;
  document.body.appendChild(container);

  let map: maplibregl.Map | undefined;
  try {
    map = new maplibregl.Map({
      container,
      attributionControl: false,
      interactive: false,
      center: [0, 0],
      zoom: 0,
      style: {
        version: 8,
        sources: {
          probe: {
            type: "geojson",
            data: {
              type: "Feature",
              properties: {},
              geometry: {
                // The western half of the world: the eastern half is left
                // bare, and is what the check actually reads.
                type: "Polygon",
                coordinates: [
                  [
                    [-180, -85],
                    [0, -85],
                    [0, 85],
                    [-180, 85],
                    [-180, -85],
                  ],
                ],
              },
            },
          },
        },
        layers: [
          {
            id: "bg",
            type: "background",
            paint: { "background-color": rgb(BACKGROUND) },
          },
          {
            id: "tinted",
            type: "fill",
            source: "probe",
            paint: {
              "fill-color": rgb(FILL),
              "fill-opacity": 1,
              "fill-layer-opacity": FILL_LAYER_OPACITY,
            },
          },
        ],
      },
    });
    const pixels = await readFrame(map);
    if (!pixels) return { supported: true, detail: "probe: no frame rendered" };
    return verdict(pixels);
  } catch (e) {
    return { supported: true, detail: `probe failed: ${String(e)}` };
  } finally {
    map?.remove();
    container.remove();
  }
}

/** Sample the bare half and the tinted half of the rendered probe frame. */
interface ProbePixels {
  bare: [number, number, number];
  tinted: [number, number, number];
}

function readFrame(map: maplibregl.Map): Promise<ProbePixels | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: ProbePixels | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), PROBE_TIMEOUT_MS);

    // addLayer throws "Style is not done loading" if it lands before the
    // style is up, and how soon that happens varies by machine — on a slower
    // one the probe threw, reported itself inconclusive, and the fallback it
    // exists to trigger never ran.
    const addProbeLayer = () => {
      if (settled) return;
      map.addLayer({
        id: "_probe-read",
        type: "custom",
        renderingMode: "2d",
        // Reading here, mid-frame, needs no preserveDrawingBuffer — the buffer
        // is only undefined once the browser has composited.
        render: (gl: WebGL2RenderingContext) => {
          if (settled) return;
          const w = gl.drawingBufferWidth;
          const h = gl.drawingBufferHeight;
          if (w < 4 || h < 4) return finish(null);
          const read = (fx: number): [number, number, number] => {
            const buf = new Uint8Array(4);
            gl.readPixels(
              Math.round(w * fx),
              Math.round(h / 2),
              1,
              1,
              gl.RGBA,
              gl.UNSIGNED_BYTE,
              buf,
            );
            return [buf[0], buf[1], buf[2]];
          };
          finish({ bare: read(0.75), tinted: read(0.25) });
        },
      });
      map.triggerRepaint();
    };

    if (map.isStyleLoaded()) addProbeLayer();
    else map.once("load", addProbeLayer);
  });
}

function verdict(pixels: ProbePixels): LayerOpacityProbeResult {
  const expectedTint = blend(FILL, BACKGROUND, FILL_LAYER_OPACITY);
  const bareOk = near(pixels.bare, BACKGROUND);
  const tintOk = near(pixels.tinted, expectedTint);
  if (bareOk && tintOk) {
    return { supported: true, detail: `ok (bare ${hex(pixels.bare)})` };
  }
  // Which half is wrong says what went wrong: a dimmed bare half is the
  // composite escaping its layer, the case this probe exists for.
  const cause = bareOk
    ? `tint ${hex(pixels.tinted)} expected ${hex(expectedTint)}`
    : `composite leaked past its layer: bare half ${hex(pixels.bare)} expected ${hex(BACKGROUND)}`;
  return { supported: false, detail: `unsupported — ${cause}` };
}

function blend(
  top: [number, number, number],
  bottom: [number, number, number],
  alpha: number,
): [number, number, number] {
  return [0, 1, 2].map((i) =>
    Math.round(top[i] * alpha + bottom[i] * (1 - alpha)),
  ) as [number, number, number];
}

function near(a: [number, number, number], b: [number, number, number]) {
  return [0, 1, 2].every((i) => Math.abs(a[i] - b[i]) <= CHANNEL_TOLERANCE);
}

function rgb([r, g, b]: [number, number, number]) {
  return `rgb(${r}, ${g}, ${b})`;
}

function hex([r, g, b]: [number, number, number]) {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
