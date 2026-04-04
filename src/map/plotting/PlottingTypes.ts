/**
 * Data model for the navigation plotting layer.
 * All bearings stored as TRUE north internally.
 * Magnetic conversion happens at display boundary via getDeclination()/formatBearing().
 */

import type { PlotSymbolShape } from "./plot-icons";

/** A line through a point at a bearing (LOP from compass bearing). */
export interface PlotBearingLine {
  id: string;
  type: "bearing-line";
  lat: number;
  lon: number;
  bearingTrue: number; // 0-360, true north
  label: string; // user's input preserved, e.g. "121°M"
  createdAt: number;
}

/** A line between two points (range line, DR advance, etc.). */
export interface PlotSegmentLine {
  id: string;
  type: "segment-line";
  lat1: number;
  lon1: number;
  lat2: number;
  lon2: number;
  label: string;
  createdAt: number;
}

/** A navigation symbol (DR, fix, EP, running fix). */
export interface PlotSymbol {
  id: string;
  type: "symbol";
  lat: number;
  lon: number;
  shape: PlotSymbolShape;
  label: string;
  createdAt: number;
}

/** A text annotation placed on the chart. */
export interface PlotText {
  id: string;
  type: "text";
  lat: number;
  lon: number;
  text: string;
  createdAt: number;
}

/** An arc (partial circle) at a fixed radius from a center point,
 *  with a radial line from center to a point on the arc. */
export interface PlotDistanceArc {
  id: string;
  type: "distance-arc";
  lat: number;
  lon: number;
  radiusNM: number;
  /** Start angle in degrees TRUE (0 = north, clockwise). */
  startAngle: number;
  /** End angle in degrees TRUE (0 = north, clockwise). */
  endAngle: number;
  /** Bearing of the radial line (TRUE), set at mouseup. */
  lineAngle: number;
  createdAt: number;
}

export type PlotElement =
  | PlotBearingLine
  | PlotSegmentLine
  | PlotSymbol
  | PlotText
  | PlotDistanceArc;

export interface PlottingSheet {
  id: string;
  name: string;
  createdAt: number;
  elements: PlotElement[];
}
