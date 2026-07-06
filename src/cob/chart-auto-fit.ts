/**
 * COB chart auto-view: on activation, force follow mode and zoom so both the
 * vessel and the COB point are on screen; keep them framed as the boat
 * returns (Raymarine-style auto-range).
 *
 * Follow mode re-centers with a look-ahead offset but never touches zoom, so
 * a fit sticks as long as its bounds are symmetric about the *vessel*: the
 * box that spans ±the vessel→COB delta in both axes keeps the COB point on
 * screen at that zoom no matter where follow puts the vessel or how
 * course-up rotates the view.
 */

import type maplibregl from "maplibre-gl";
import {
  fitMapToBounds,
  fitMapToBoundsIfNeeded,
  type LonLatBounds,
} from "../map/fit-bounds";
import type { NavigationData } from "../navigation/NavigationData";
import type { NavigationDataManager } from "../navigation/NavigationDataManager";
import { getSettings } from "../settings";
import type { ChartModeController } from "../vessel/ChartMode";
import type { CobManager } from "./CobManager";

// duration 0: an animated fit gets canceled mid-flight by follow-mode's
// jumpTo on the next GPS tick, stranding the camera at an arbitrary zoom.
// An emergency fit should snap instantly anyway.
const FIT_OPTIONS: maplibregl.FitBoundsOptions = {
  padding: 90,
  maxZoom: 15,
  duration: 0,
};
const REFIT_MIN_INTERVAL_MS = 5_000;
/** E-ink refits force full-screen refreshes — keep them rare. */
const EINK_REFIT_MIN_INTERVAL_MS = 30_000;
/** Minimum half-extent (~±100 m of latitude) so a zero-distance fit isn't degenerate. */
const MIN_HALF_EXTENT_DEG = 0.001;

/**
 * Vessel-centered bounds that contain the COB point with margin to spare in
 * every direction. Pure, for unit tests.
 */
export function cobFitBounds(
  vesselLat: number,
  vesselLon: number,
  cobLat: number,
  cobLon: number,
): LonLatBounds {
  const dLat = Math.max(Math.abs(cobLat - vesselLat), MIN_HALF_EXTENT_DEG);
  const dLon = Math.max(Math.abs(cobLon - vesselLon), MIN_HALF_EXTENT_DEG);
  return [
    [vesselLon - dLon, vesselLat - dLat],
    [vesselLon + dLon, vesselLat + dLat],
  ];
}

/** Wire COB view management. Returns a teardown function. */
export function startCobChartAutoFit(
  map: maplibregl.Map,
  chartMode: Pick<ChartModeController, "setMode" | "getMode">,
  cobManager: CobManager,
  navManager: Pick<
    NavigationDataManager,
    "subscribe" | "unsubscribe" | "getLastData"
  >,
): () => void {
  let wasActive = false;
  let lastFitAt = 0;

  const initialFit = (): void => {
    const state = cobManager.getState();
    const fix = navManager.getLastData();
    if (!state) return;
    chartMode.setMode("follow");
    const vessel = fix ?? {
      latitude: state.waypoint.lat,
      longitude: state.waypoint.lon,
    };
    fitMapToBounds(
      map,
      cobFitBounds(
        vessel.latitude,
        vessel.longitude,
        state.waypoint.lat,
        state.waypoint.lon,
      ),
      FIT_OPTIONS,
    );
    lastFitAt = Date.now();
  };

  const onCobChange = (): void => {
    const active = cobManager.isActive();
    if (active && !wasActive) initialFit();
    wasActive = active;
  };

  const onFix = (data: NavigationData): void => {
    const state = cobManager.getState();
    if (!state) return;
    // Respect a deliberate user pan/zoom (mode flips to "free"); the
    // recenter button restores follow and auto-fit resumes.
    if (chartMode.getMode() === "free") return;
    const minInterval =
      getSettings().displayTheme === "eink"
        ? EINK_REFIT_MIN_INTERVAL_MS
        : REFIT_MIN_INTERVAL_MS;
    if (Date.now() - lastFitAt < minInterval) return;
    fitMapToBoundsIfNeeded(
      map,
      cobFitBounds(
        data.latitude,
        data.longitude,
        state.waypoint.lat,
        state.waypoint.lon,
      ),
      FIT_OPTIONS,
    );
    lastFitAt = Date.now();
  };

  cobManager.subscribe(onCobChange);
  navManager.subscribe(onFix);
  return () => {
    cobManager.unsubscribe(onCobChange);
    navManager.unsubscribe(onFix);
  };
}
