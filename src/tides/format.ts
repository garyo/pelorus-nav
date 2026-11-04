/**
 * Display formatters for tide/current predictions. These own the unit
 * conversions so the map layer and popup stay thin.
 */

import {
  convertDepth,
  type DepthUnit,
  depthUnitLabel,
  heightUnit,
  type SpeedUnit,
} from "../settings";
import { formatSpeed } from "../utils/units";
import type { CurrentEvent } from "./currents";
import type { TideEvent } from "./predictor";

export { formatEventTime, formatTimeUntil } from "../utils/format";
export { formatSpeed };

/** Tide height with one decimal in the height unit for the user's depth
 *  unit ("9.7ft"): feet when depths are in feet or fathoms, as charted
 *  heights are. */
export function formatTideHeight(meters: number, depthUnit: DepthUnit): string {
  const unit = heightUnit(depthUnit);
  return `${convertDepth(meters, unit).toFixed(1)}${depthUnitLabel(unit)}`;
}

/** "High 9.7ft" */
export function formatTideEvent(e: TideEvent, unit: DepthUnit): string {
  const label = e.type === "high" ? "High" : "Low";
  return `${label} ${formatTideHeight(e.heightMeters, unit)}`;
}

const CURRENT_EVENT_LABELS: Record<CurrentEvent["type"], string> = {
  maxFlood: "Max Flood",
  maxEbb: "Max Ebb",
  slackBeforeEbb: "Slack",
  slackBeforeFlood: "Slack",
};

/** "Max Flood 1.8 Kt" / "Slack" */
export function formatCurrentEvent(e: CurrentEvent, unit: SpeedUnit): string {
  const label = CURRENT_EVENT_LABELS[e.type];
  return e.speedKn === 0 ? label : `${label} ${formatSpeed(e.speedKn, unit)}`;
}
