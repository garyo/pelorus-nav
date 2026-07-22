/**
 * Capture the chart canvas as a JPEG data URL, for attaching to bug reports.
 *
 * The WebGL drawing buffer is only readable inside a render callback (the
 * buffer isn't preserved in prod — see ChartManager's canvasContextAttributes),
 * so this triggers a repaint and reads the canvas on the next "render" event.
 * DOM overlays (dialogs, HUD) sit above the canvas and never appear in the
 * capture, so it's safe to call while the bug-report dialog is open.
 */

import type maplibregl from "maplibre-gl";

/** Longest edge of the captured image, px (hidpi canvases can be huge). */
const MAX_DIMENSION = 1280;
const JPEG_QUALITY = 0.75;
const CAPTURE_TIMEOUT_MS = 3000;

export function captureMapScreenshot(
  map: maplibregl.Map,
): Promise<string | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), CAPTURE_TIMEOUT_MS);
    map.once("render", () => {
      clearTimeout(timeout);
      try {
        const canvas = map.getCanvas();
        const scale = Math.min(
          1,
          MAX_DIMENSION / Math.max(canvas.width, canvas.height),
        );
        if (scale >= 1) {
          resolve(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
          return;
        }
        const scaled = document.createElement("canvas");
        scaled.width = Math.round(canvas.width * scale);
        scaled.height = Math.round(canvas.height * scale);
        const ctx = scaled.getContext("2d");
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(canvas, 0, 0, scaled.width, scaled.height);
        resolve(scaled.toDataURL("image/jpeg", JPEG_QUALITY));
      } catch {
        resolve(null);
      }
    });
    map.triggerRepaint();
  });
}
