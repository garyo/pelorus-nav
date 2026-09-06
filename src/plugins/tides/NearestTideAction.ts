/**
 * The TIDE top-bar action: the tide station nearest the vessel (or the
 * chart centre without a fix), shown in the app's feature-info panel with
 * a button for each nearby station that would give a different answer.
 */

import type { FeatureInfo } from "../../chart/feature-info";
import { loadTidesIndex, type TidesIndex } from "../../tides/bundle";
import {
  chooseNearestTide,
  type NearestTideResult,
  type StationChoice,
} from "../../tides/nearest-tide";
import { formatDistanceShort } from "../../utils/format";
import type { PluginHost } from "../types";
import { buildTideStationInfo, formatStationChoice } from "./station-card";

export interface NearestTideDeps {
  loadIndex: () => Promise<TidesIndex>;
  now: () => Date;
}

/** How long the status chip stays up when there is nothing to show. */
const STATUS_MS = 4000;
/** "Show on chart" zooms in at least this far — the station icon needs it. */
const STATION_ZOOM = 12;
/** The layer group that draws the stations (tides plugin manifest). */
const TIDES_LAYER_GROUP = "tidesCurrents";

export function createNearestTideAction(
  host: PluginHost,
  deps: NearestTideDeps = {
    loadIndex: () => loadTidesIndex(),
    now: () => new Date(),
  },
): () => Promise<void> {
  let statusTimer: ReturnType<typeof setTimeout> | null = null;
  const flash = (text: string) => {
    host.ui.setStatus(text);
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(() => host.ui.setStatus(null), STATUS_MS);
  };

  return async () => {
    let index: TidesIndex;
    try {
      index = await deps.loadIndex();
    } catch {
      flash("Tide data unavailable");
      return;
    }

    // A live fix answers "here"; without one (or with a stale one, the
    // vessel may be anywhere by now) the chart centre is what the user is
    // looking at.
    const fix = host.nav.lastFix();
    const fromVessel = fix !== null && !fix.stale;
    const centre = host.map.raw.getCenter();
    const position = fromVessel ? fix : { lat: centre.lat, lon: centre.lng };
    const origin = fromVessel ? "from vessel" : "from chart centre";

    const now = deps.now();
    const result = chooseNearestTide(index, position.lat, position.lon, now);
    if (!result) {
      flash("No tide station within 25 nm");
      return;
    }
    show(cardFor(result.primary, result));

    /** The info panel is unavailable while another mode owns the map. */
    function show(card: FeatureInfo): void {
      if (!host.ui.showInfo([card])) flash("Finish editing to see tides");
    }

    function cardFor(choice: StationChoice, all: NearestTideResult) {
      const { depthUnit } = host.settings.get();
      const others = [all.primary, ...all.alternatives].filter(
        (c) => c !== choice,
      );
      const info = buildTideStationInfo(choice.station, index, now, depthUnit, {
        distance: `${formatDistanceShort(choice.distanceNM)} ${origin}`,
        actions: [
          {
            label: "Show on chart",
            run: () => {
              const map = host.map.raw;
              // The station is drawn by the Tides & Currents layer, which is
              // off by default: flying to an empty patch of water helps no one.
              host.settings.setLayerGroupEnabled(TIDES_LAYER_GROUP, true);
              // A deliberate look-away, like a search result: release follow
              // mode so the next fix doesn't snap the camera back.
              map.fire("pelorus:navigate" as never);
              map.flyTo({
                center: [choice.station.lng, choice.station.lat],
                zoom: Math.max(map.getZoom(), STATION_ZOOM),
              });
            },
          },
          ...others.map((other) => ({
            label: formatStationChoice(other, now, depthUnit),
            run: () => show(cardFor(other, all)),
          })),
        ],
      });
      // A station tideState() cannot predict was already filtered out.
      return (
        info ?? { type: "Tide Station", name: choice.station.name, details: [] }
      );
    }
  };
}
