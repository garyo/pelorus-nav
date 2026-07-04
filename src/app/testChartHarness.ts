/**
 * Dev-only render harness: with `?testChart=1`, overlay the synthetic S-57
 * test chart (public/test-chart.pmtiles, one MVT source-layer per S-57 class)
 * and render it through the REAL nautical styles, so a headless spec can
 * verify every feature class produces decent iconography + text.
 *
 * The test layers are added ON TOP of the live style, tagged with a `test-`
 * id prefix and their own `s57-test` source, so a spec can isolate them via
 * queryRenderedFeatures(...).filter(f => f.source === "s57-test"). ChartManager
 * rebuilds the style (setStyle) on every region-in-view change and on the
 * startup streaming-version refresh — which strips anything not in the
 * provider's style — so we re-apply on `styledata` (idempotently). The app
 * always uses iho-s52 symbology, so the live sprite already matches the test
 * layers. No effect on production: main.ts loads this module dynamically,
 * gated behind import.meta.env.DEV + the URL param.
 */

import type { Map as MapLibreMap } from "maplibre-gl";
import { getNauticalLayers } from "../chart/styles";
import { getSettings } from "../settings";

export function installTestChartHarness(map: MapLibreMap): void {
  const testParams = new URLSearchParams(window.location.search);
  if (testParams.get("testChart") !== "1") return;

  const TEST_SOURCE_ID = "s57-test";
  const testWindow = window as unknown as { __missingIcons?: string[] };
  testWindow.__missingIcons ??= [];
  const missingIcons = testWindow.__missingIcons;
  map.on("styleimagemissing", (e) => {
    missingIcons.push(e.id);
  });

  const ensureTestChart = (): void => {
    let style: ReturnType<typeof map.getStyle>;
    try {
      style = map.getStyle();
    } catch {
      return; // style not ready yet
    }
    if (!style?.layers) return;

    if (!map.getSource(TEST_SOURCE_ID)) {
      map.addSource(TEST_SOURCE_ID, {
        type: "vector",
        tiles: [
          `pmtiles://${window.location.origin}/test-chart.pmtiles/{z}/{x}/{y}`,
        ],
        minzoom: 0,
        maxzoom: 16,
      });
    }
    const s = getSettings();
    // detailOffset 2 → showStandard + showOther so EVERY class's layers build.
    const layers = getNauticalLayers(
      TEST_SOURCE_ID,
      s.depthUnit,
      2,
      s.layerGroups,
      undefined,
      s.displayTheme,
      "iho-s52",
      s.shallowDepth,
      s.safetyDepth,
      s.deepDepth,
      s.textScale,
      s.iconScale,
    );
    for (const layer of layers) {
      // Skip the shared background (its id collides with the live style's).
      if (layer.type === "background") continue;
      const testLayer = { ...layer, id: `test-${layer.id}` };
      if (!map.getLayer(testLayer.id)) map.addLayer(testLayer);
    }
    (window as unknown as { __testChartReady: boolean }).__testChartReady =
      true;
  };

  // `styledata` fires after the initial load AND after every setStyle rebuild
  // (incl. diff:true updates that drop our layers). Idempotent guards above
  // make the re-entrant pass a no-op, so it converges.
  map.on("styledata", ensureTestChart);
  ensureTestChart();
}
