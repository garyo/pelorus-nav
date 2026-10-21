/**
 * Chart scale bar in the distance family of the speed unit, like route and
 * track distances (formatDistanceInSpeedUnits): km/m for km/h, mi/ft for mph,
 * and NM for knots. In NM it drops to feet or meters (per the depth-unit
 * setting) once its span falls below 0.1 NM — where an NM label would read
 * "0.05 nm" — matching formatDistanceNM's on-chart labels.
 */

import * as maplibregl from "maplibre-gl";
import {
  type DepthUnit,
  getSettings,
  onSettingsChange,
  type SpeedUnit,
} from "../settings";
import { NM_TO_METERS } from "../utils/units";

/** MapLibre's default (and our) scale-bar maximum width. */
const MAX_WIDTH_PX = 100;
const SHORT_SPAN_NM = 0.1;

/** Scale-bar unit for a bar spanning `spanMeters` at full width. */
export function scaleUnitFor(
  spanMeters: number,
  speedUnit: SpeedUnit,
  depthUnit: DepthUnit,
): maplibregl.Unit {
  if (speedUnit === "kph") return "metric";
  if (speedUnit === "mph") return "imperial";
  if (spanMeters >= SHORT_SPAN_NM * NM_TO_METERS) return "nautical";
  return depthUnit === "meters" ? "metric" : "imperial";
}

/** Ground distance across `widthPx` at the map's centre. */
function centerSpanMeters(map: maplibregl.Map, widthPx: number): number {
  const { clientWidth, clientHeight } = map.getContainer();
  const y = clientHeight / 2;
  const left = map.unproject([(clientWidth - widthPx) / 2, y]);
  const right = map.unproject([(clientWidth + widthPx) / 2, y]);
  return left.distanceTo(right);
}

export class ChartScaleControl extends maplibregl.ScaleControl {
  private map?: maplibregl.Map;
  private unsubscribeSettings?: () => void;

  constructor() {
    super({ unit: "nautical", maxWidth: MAX_WIDTH_PX });
  }

  override onAdd(map: maplibregl.Map): HTMLElement {
    const container = super.onAdd(map);
    this.map = map;
    map.on("move", this.pickUnit);
    this.unsubscribeSettings = onSettingsChange(this.pickUnit);
    this.pickUnit();
    return container;
  }

  override onRemove(): void {
    this.map?.off("move", this.pickUnit);
    this.unsubscribeSettings?.();
    this.map = undefined;
    super.onRemove();
  }

  private pickUnit = (): void => {
    if (!this.map) return;
    const { speedUnit, depthUnit } = getSettings();
    const unit = scaleUnitFor(
      centerSpanMeters(this.map, MAX_WIDTH_PX),
      speedUnit,
      depthUnit,
    );
    if (unit !== this.options.unit) this.setUnit(unit);
  };
}
