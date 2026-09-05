/**
 * The tide-station card: conditions now, then the coming days' highs and
 * lows. Shared by the station tap popup and the nearest-tide action, which
 * adds a distance row and buttons for the other stations it considered.
 */

import type { FeatureInfo } from "../../chart/feature-info";
import type { DepthUnit } from "../../settings";
import {
  isTideRef,
  type TideStation,
  type TidesIndex,
} from "../../tides/bundle";
import {
  formatEventTime,
  formatTideEvent,
  formatTideHeight,
  formatTimeUntil,
} from "../../tides/format";
import type { StationChoice } from "../../tides/nearest-tide";
import { tideState } from "../../tides/predictor";
import { formatDistanceShort } from "../../utils/format";
import { shortTimeZone } from "../../utils/timezone";

/** How far ahead the card lists events. */
export const CARD_WINDOW_HRS = 72;

export interface StationCardExtras {
  /** A leading row, e.g. "6.4 nm from vessel". */
  distance?: string;
  actions?: FeatureInfo["actions"];
}

export function buildTideStationInfo(
  station: TideStation,
  index: TidesIndex,
  now: Date,
  depthUnit: DepthUnit,
  extras: StationCardExtras = {},
): FeatureInfo | null {
  const state = tideState(station, index, now, CARD_WINDOW_HRS);
  if (!state) return null;

  const tz = shortTimeZone();
  const nowLabel = tz ? `Now (${tz})` : "Now";
  const details: FeatureInfo["details"] = [];
  if (extras.distance)
    details.push({ label: "Distance", value: extras.distance });
  if (state.heightMeters != null) {
    details.push({
      label: nowLabel,
      value: `${formatTideHeight(state.heightMeters, depthUnit)} (${state.trend})`,
    });
  } else {
    details.push({ label: nowLabel, value: state.trend });
  }
  state.events.forEach((ev, i) => {
    details.push({
      label:
        i === 0
          ? `${formatEventTime(ev.time, now)} ${formatTimeUntil(ev.time, now)}`
          : formatEventTime(ev.time, now),
      value: formatTideEvent(ev, depthUnit),
    });
  });
  // Subordinate stations carry NOAA offset-derived (approximate) predictions.
  const type = isTideRef(station) ? "Tide Station" : "Tide Station (secondary)";
  return {
    type,
    name: station.name,
    details,
    ...(extras.actions && extras.actions.length > 0
      ? { actions: extras.actions }
      : {}),
  };
}

/** Button text for an alternative station: "Hull · 6.4 nm · High 9.7ft 3:42 PM". */
export function formatStationChoice(
  choice: StationChoice,
  now: Date,
  depthUnit: DepthUnit,
): string {
  return (
    `${choice.station.name} · ${formatDistanceShort(choice.distanceNM)} · ` +
    `${formatTideEvent(choice.next, depthUnit)} ${formatEventTime(choice.next.time, now)}`
  );
}
