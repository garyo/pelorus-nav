/**
 * What this WebGL stack can actually do, and the canvas cap that follows.
 *
 * MapLibre sizes offscreen render targets from the canvas: the
 * `fill-layer-opacity` composite allocates a texture the size of the viewport
 * (`bindLayerOpacity` → `texImage2D(..., width, height, ...)`). Its default
 * canvas cap is 4096, commented "Because GL MAX_TEXTURE_SIZE is usually at
 * least 4096px", and its docs add "You shouldn't set this above WebGl
 * MAX_TEXTURE_SIZE."
 *
 * Hardened and software stacks report less than that. One tester's Firefox
 * reports 2048 against a 1400x800 @2x canvas — 2800 device pixels wide — so
 * that texture allocation failed, its framebuffer was incomplete, and
 * compositing the result dimmed the entire chart to roughly 42% brightness a
 * second after the charts loaded, in every theme. Nothing in the DOM showed
 * it, because nothing in the DOM was wrong.
 *
 * So ask the driver and cap the canvas at what it admits to, rather than
 * trusting a default that is only usually true.
 */

/** MapLibre's own default cap; we only ever lower it. */
const MAPLIBRE_DEFAULT_MAX_CANVAS = 4096;

let cached: number | null | undefined;

/**
 * GL_MAX_TEXTURE_SIZE for this device, or null if no context can be had.
 * Probed once on a throwaway canvas.
 */
export function maxTextureSize(): number | null {
  if (cached !== undefined) return cached;
  cached = null;
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl2") ??
      canvas.getContext("webgl")) as WebGLRenderingContext | null;
    const size = gl?.getParameter(gl.MAX_TEXTURE_SIZE);
    if (typeof size === "number" && size > 0) cached = size;
  } catch {
    // No context, no limit to report — the default cap stands.
  }
  return cached;
}

/**
 * Canvas cap to hand MapLibre: its default, lowered to the texture limit
 * where the driver reports a smaller one.
 */
export function maxCanvasSize(): [number, number] {
  const limit = Math.min(
    maxTextureSize() ?? MAPLIBRE_DEFAULT_MAX_CANVAS,
    MAPLIBRE_DEFAULT_MAX_CANVAS,
  );
  return [limit, limit];
}

/**
 * Whether the canvas would have exceeded the texture limit without the cap —
 * the condition that breaks the layer-opacity composite. Reported in
 * diagnostics so an affected machine identifies itself.
 */
export function canvasWouldExceedTextureLimit(): boolean {
  const limit = maxTextureSize();
  if (limit === null) return false;
  const dpr = window.devicePixelRatio || 1;
  const longestEdge = Math.max(
    window.screen?.width ?? 0,
    window.screen?.height ?? 0,
  );
  return longestEdge * dpr > limit;
}
