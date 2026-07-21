/**
 * Passive tap diagnostics for route editing. While an edit session is active,
 * capture-phase listeners on the map canvas record where each tap/click lands
 * relative to the editable waypoints and whether MapLibre's hit-test sees it —
 * without touching the real handlers (never preventDefault, never stops
 * propagation).
 *
 * Exists to field-diagnose testers whose edit taps select nothing (every tap
 * appends a waypoint instead). Each line carries the facts that discriminate
 * the known failure classes:
 * - `hits`/`mid`: the same slop-box queryRenderedFeatures the real touch
 *   handler uses — 0 while `near` is small means the hit-test itself fails.
 * - `rendered`: how many edit-point symbols MapLibre actually placed — 0 with
 *   waypoints present means the symbol icons never rendered (unplaced symbols
 *   are invisible to queryRenderedFeatures).
 * - `near`: pixel distance to the nearest projected waypoint — consistently
 *   large means the tap coordinates are offset (viewport/scroll/scale skew).
 * Entries persist in a small ring buffer and ship in bug reports.
 *
 * The queryRenderedFeatures probes (`hits`/`mid`/`rendered`) run only on
 * iOS, where the tap failure they discriminate lives (WKWebView). On dense
 * ENC tiles each query walks the tile's whole feature grid before layer
 * filtering, so three of them on every touchstart add real latency to the
 * start of every gesture — too expensive as an always-on tax on platforms
 * with no known bug. The geometric fields (`near`, rects) still log
 * everywhere.
 */

import { Capacitor } from "@capacitor/core";
import type maplibregl from "maplibre-gl";
import { ConnectionEventLog } from "../navigation/ConnectionEventLog";

/** Same finger slop as DraggablePoints' touch hit-test. */
const HIT_SLOP = 10;

export const editTapLog = new ConnectionEventLog({
  key: "pelorus-nav-edittap-log",
  max: 80,
});

export interface EditTapDiagLayers {
  points: string;
  midpoints: string;
}

const round = (n: number) => Math.round(n);

function envDetail(map: maplibregl.Map): string {
  const rect = map.getCanvas().getBoundingClientRect();
  const canvas = map.getCanvas();
  const vv = typeof window !== "undefined" ? window.visualViewport : null;
  return (
    `rect=${round(rect.left)},${round(rect.top)} ${round(rect.width)}x${round(rect.height)}` +
    ` canvas=${canvas.width}x${canvas.height}` +
    ` dpr=${window.devicePixelRatio ?? "?"}` +
    ` vv=${vv ? `${vv.scale.toFixed(2)} ${round(vv.offsetLeft)},${round(vv.offsetTop)}` : "(none)"}` +
    ` scroll=${round(window.scrollX)},${round(window.scrollY)}`
  );
}

/**
 * Start observing; returns a stop function. `getWaypoints` supplies the
 * route being edited so taps can be measured against the real targets.
 */
export function startEditTapDiag(
  map: maplibregl.Map,
  layers: EditTapDiagLayers,
  getWaypoints: () => { lat: number; lon: number }[],
): () => void {
  const canvas = map.getCanvas();
  try {
    editTapLog.log("edit", "diag", `start ${envDetail(map)}`);
  } catch {
    // Diagnostics must never break editing.
  }

  const logTap = (kind: string, clientX: number, clientY: number): void => {
    try {
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const box: [maplibregl.PointLike, maplibregl.PointLike] = [
        [x - HIT_SLOP, y - HIT_SLOP],
        [x + HIT_SLOP, y + HIT_SLOP],
      ];
      const query = (layer: string, geom?: typeof box) =>
        map.getLayer(layer)
          ? map.queryRenderedFeatures(geom, { layers: [layer] }).length
          : -1; // layer missing entirely
      const probe = Capacitor.getPlatform() === "ios";
      const hits = probe ? query(layers.points, box) : -2; // -2 = not probed
      const mid = probe ? query(layers.midpoints, box) : -2;
      // No geometry = whole viewport: how many edit symbols actually rendered.
      const rendered = probe ? query(layers.points) : -2;
      const wps = getWaypoints();
      let near = "";
      let best = Number.POSITIVE_INFINITY;
      for (let i = 0; i < wps.length; i++) {
        const p = map.project([wps[i].lon, wps[i].lat]);
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < best) {
          best = d;
          near = `near#${i}=${round(d)}px`;
        }
      }
      editTapLog.log(
        "edit",
        "diag",
        `${kind} (${round(x)},${round(y)}) hits=${hits} mid=${mid}` +
          ` rendered=${rendered}/${wps.length} ${near || "near=(no wps)"}` +
          ` rect=${round(rect.left)},${round(rect.top)}`,
      );
    } catch (err) {
      editTapLog.log("edit", "error", `tap-diag failed: ${String(err)}`);
    }
  };

  const onTouchStart = (e: TouchEvent): void => {
    if (e.touches.length !== 1) return;
    logTap("touch", e.touches[0].clientX, e.touches[0].clientY);
  };
  const onClick = (e: MouseEvent): void => {
    logTap("click", e.clientX, e.clientY);
  };

  canvas.addEventListener("touchstart", onTouchStart, {
    capture: true,
    passive: true,
  });
  canvas.addEventListener("click", onClick, { capture: true });

  return () => {
    canvas.removeEventListener("touchstart", onTouchStart, { capture: true });
    canvas.removeEventListener("click", onClick, { capture: true });
    try {
      editTapLog.log("edit", "diag", "stop");
    } catch {
      // ignore
    }
  };
}
