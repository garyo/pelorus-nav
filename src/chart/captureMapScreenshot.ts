/**
 * Capture the chart canvas as a JPEG data URL, for attaching to bug reports.
 *
 * Reads the framebuffer from inside a custom layer's `render`, i.e. partway
 * through the frame, while the buffer is still guaranteed to hold the pixels.
 * Reading after the frame instead — `getCanvas().toDataURL()` — would need
 * `preserveDrawingBuffer`, which costs a buffer copy on every frame the map
 * ever draws; without it the contents are undefined once the browser
 * composites, and some stacks hand back garbage. This way the whole cost
 * lands on the capture itself and normal panning pays nothing.
 *
 * DOM overlays (dialogs, HUD) sit above the canvas and never appear in the
 * capture, so it's safe to call while the bug-report dialog is open.
 */

import type * as maplibregl from "maplibre-gl";

/** Longest edge of the captured image, px (hidpi canvases can be huge). */
const MAX_DIMENSION = 1280;
const JPEG_QUALITY = 0.75;
const CAPTURE_TIMEOUT_MS = 3000;
const CAPTURE_LAYER_ID = "_screenshot-capture";

export function captureMapScreenshot(
  map: maplibregl.Map,
): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (map.getLayer(CAPTURE_LAYER_ID)) map.removeLayer(CAPTURE_LAYER_ID);
      resolve(result);
    };
    const timeout = setTimeout(() => finish(null), CAPTURE_TIMEOUT_MS);

    try {
      map.addLayer({
        id: CAPTURE_LAYER_ID,
        type: "custom",
        renderingMode: "2d",
        render: (gl) => {
          if (settled) return;
          let frame: string | null = null;
          try {
            frame = encodeFrame(gl);
          } catch {
            frame = null;
          }
          // Removing the layer has to wait until MapLibre is out of its own
          // render loop.
          setTimeout(() => finish(frame), 0);
        },
      });
      map.triggerRepaint();
    } catch {
      finish(null);
    }
  });
}

/** Read the bound framebuffer, downscale to MAX_DIMENSION, encode as JPEG. */
function encodeFrame(gl: WebGL2RenderingContext): string | null {
  const width = gl.drawingBufferWidth;
  const height = gl.drawingBufferHeight;
  if (width === 0 || height === 0) return null;

  const pixels = new Uint8ClampedArray(width * height * 4);
  gl.readPixels(
    0,
    0,
    width,
    height,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array(pixels.buffer),
  );
  flipVertically(pixels, width, height); // GL reads bottom-up

  const full = document.createElement("canvas");
  full.width = width;
  full.height = height;
  const fullCtx = full.getContext("2d");
  if (!fullCtx) return null;
  fullCtx.putImageData(new ImageData(pixels, width, height), 0, 0);

  const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));
  if (scale >= 1) return full.toDataURL("image/jpeg", JPEG_QUALITY);

  const scaled = document.createElement("canvas");
  scaled.width = Math.max(1, Math.round(width * scale));
  scaled.height = Math.max(1, Math.round(height * scale));
  const ctx = scaled.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(full, 0, 0, scaled.width, scaled.height);
  return scaled.toDataURL("image/jpeg", JPEG_QUALITY);
}

/** Swap row order in place, one row buffer at a time. */
export function flipVertically(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): void {
  const stride = width * 4;
  const row = new Uint8ClampedArray(stride);
  for (let y = 0; y < height >> 1; y++) {
    const top = y * stride;
    const bottom = (height - 1 - y) * stride;
    row.set(pixels.subarray(top, top + stride));
    pixels.copyWithin(top, bottom, bottom + stride);
    pixels.set(row, bottom);
  }
}
