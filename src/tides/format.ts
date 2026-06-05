/**
 * Display formatters for tide/current predictions. These own the unit
 * conversions so the map layer and popup stay thin.
 */

import { type DepthUnit, formatDepth, type SpeedUnit } from "../settings";
import { convertSpeed, speedUnitLabel } from "../utils/units";
import type { CurrentEvent } from "./currents";
import type { TideEvent } from "./predictor";

/** "2:32 PM" if `time` falls on `now`'s local date, else "Tue 2:32 AM". */
export function formatEventTime(time: Date, now: Date): string {
  const clock = time.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  if (time.toDateString() === now.toDateString()) return clock;
  const day = time.toLocaleDateString(undefined, { weekday: "short" });
  return `${day} ${clock}`;
}

/** "High 9.7ft" */
export function formatTideEvent(e: TideEvent, unit: DepthUnit): string {
  const label = e.type === "high" ? "High" : "Low";
  return `${label} ${formatDepth(e.heightMeters, unit)}`;
}

/** "1.8 Kt" */
export function formatSpeed(knots: number, unit: SpeedUnit): string {
  return `${convertSpeed(knots, unit).toFixed(1)} ${speedUnitLabel(unit)}`;
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
