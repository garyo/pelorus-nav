/**
 * Client-side light sector and range circle renderer.
 *
 * Reads LIGHTS features from vector tile sources, generates arc/circle
 * geometries at render time, and adds them as a GeoJSON overlay.
 * This avoids baking rendering decisions into tiles — the S-57 attributes
 * (SECTR1, SECTR2, COLOUR, VALNMR, LITVIS) drive everything.
 */

import type { Feature, FeatureCollection, LineString, Position } from "geojson";
import type maplibregl from "maplibre-gl";
import { CHART_REGIONS } from "../data/chart-catalog";
import { getSettings, onSettingsChange } from "../settings";
import { s52Colour } from "./s52-colours";

const SOURCE_ID = "_light-sectors";
const LAYER_RANGE_FILL = "_light-range";
const LAYER_RANGE_BORDER = "_light-range-border";
const LAYER_BEARING = "_light-bearing";
const LAYER_ARC_BORDER = "_light-arc-border";
const LAYER_ARC = "_light-arc";

/**
 * Arc radius in degrees at zoom 14. Halves for each zoom level down
 * so screen-space size stays roughly constant.
 * At z14 ~0.008° ≈ 550m at Boston latitude → ~80px on screen.
 */
const ARC_RADIUS_Z14 = 0.004;

/** Minimum zoom to show light sectors. */
const MIN_ZOOM = 9;

/** Compute arc radius in degrees for the given zoom level. */
function arcRadiusForZoom(zoom: number): number {
  // Scale so screen size stays constant: each zoom level doubles resolution,
  // so halve the degree radius per zoom level relative to z14.
  return ARC_RADIUS_Z14 * 2 ** (14 - zoom);
}

// ── Geometry helpers ──────────────────────────────────────────────────

function arcPoint(
  lon: number,
  lat: number,
  bearingDeg: number,
  radiusDeg: number,
): Position {
  const cosLat = Math.cos((lat * Math.PI) / 180) || 1e-6;
  const rad = (bearingDeg * Math.PI) / 180;
  return [
    lon + (radiusDeg * Math.sin(rad)) / cosLat,
    lat + radiusDeg * Math.cos(rad),
  ];
}

function generateArc(
  lon: number,
  lat: number,
  startBearing: number,
  endBearing: number,
  radiusDeg: number,
): Position[] {
  let sweep = (endBearing - startBearing) % 360;
  if (sweep <= 0) sweep += 360;

  const nPts = Math.max(Math.round(sweep * 2), 2);
  const step = sweep / nPts;
  const pts: Position[] = [];
  for (let i = 0; i <= nPts; i++) {
    pts.push(arcPoint(lon, lat, startBearing + i * step, radiusDeg));
  }
  return pts;
}

function generateCircle(
  lon: number,
  lat: number,
  radiusDeg: number,
): Position[] {
  const pts = generateArc(lon, lat, 0, 360, radiusDeg);
  // Ensure closure
  if (pts.length > 0) pts.push(pts[0]);
  return pts;
}

// ── S-57 COLOUR mapping ──────────────────────────────────────────────

const COLOUR_MAP: Record<string, string> = {
  "1": "white",
  "3": "red",
  "4": "green",
  "6": "yellow",
  "11": "orange",
};

/**
 * Pick the display colour for a range circle from S-57 COLOUR attribute.
 *
 * S-52 convention: for alternating lights (e.g. white+red), the range
 * circle uses the first non-white colour. If all colours are white,
 * the circle is yellow (NOAA convention for white lights).
 *
 * COLOUR arrives from GDAL as comma-separated string ("1,3") or
 * JSON array string ("[1, 3]").
 */
function rangeCircleColour(colourAttr: unknown): string {
  if (colourAttr == null) return "white";
  // Normalize: strip brackets and quotes, split on comma
  const codes = String(colourAttr)
    .replace(/[[\]"']/g, "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // Prefer first non-white colour
  for (const code of codes) {
    const name = COLOUR_MAP[code];
    if (name && name !== "white") return name;
  }
  // All white or unknown → "white" (rendered as yellow by the style)
  return COLOUR_MAP[codes[0]] ?? "white";
}

// ── Feature generation ───────────────────────────────────────────────

interface LightsProps {
  SECTR1?: number;
  SECTR2?: number;
  COLOUR?: unknown;
  VALNMR?: number;
  LITVIS?: number;
}

/** Ratio of inner sector arc radius to main range circle radius. */
const SECTOR_INNER_RATIO = 0.8;

interface SectorInfo {
  s1: number;
  s2: number;
  colour: string;
}

interface PositionGroup {
  lon: number;
  lat: number;
  sectors: SectorInfo[];
  hasRangeCircle: boolean;
  rangeColour: string;
  /** Highest VALNMR across all features at this position. */
  maxValnmr: number;
}

function buildFeatures(
  lightsFeatures: Feature[],
  radiusDeg: number,
): FeatureCollection {
  const features: Feature<LineString>[] = [];

  // Group all LIGHTS features by position
  const groups = new Map<string, PositionGroup>();

  for (const f of lightsFeatures) {
    if (f.geometry.type !== "Point") continue;
    const [lon, lat] = f.geometry.coordinates;
    const props = f.properties as LightsProps;
    const key = `${lon.toFixed(5)},${lat.toFixed(5)}`;

    let group = groups.get(key);
    if (!group) {
      group = {
        lon,
        lat,
        sectors: [],
        hasRangeCircle: false,
        rangeColour: "white",
        maxValnmr: 0,
      };
      groups.set(key, group);
    }

    const sectr1 = props.SECTR1;
    const sectr2 = props.SECTR2;
    const valnmr = props.VALNMR;
    const colour = rangeCircleColour(props.COLOUR);

    // Track highest VALNMR across all features at this position
    if (valnmr != null) {
      const nmr = Number(valnmr);
      if (nmr > group.maxValnmr) group.maxValnmr = nmr;
    }

    if (sectr1 != null && sectr2 != null) {
      const s1 = Number(sectr1);
      const s2 = Number(sectr2);
      if (!Number.isNaN(s1) && !Number.isNaN(s2)) {
        // S-57 bearings are FROM seaward; flip 180° to get FROM the light
        group.sectors.push({
          s1: (s1 + 180) % 360,
          s2: (s2 + 180) % 360,
          colour,
        });
      }
    } else if (valnmr != null && Number(valnmr) >= 10) {
      group.hasRangeCircle = true;
      if (group.rangeColour === "white" && colour !== "white") {
        group.rangeColour = colour;
      }
    }
  }

  // Generate geometry for each position
  for (const g of groups.values()) {
    const { lon, lat, sectors, hasRangeCircle, rangeColour, maxValnmr } = g;

    // Subtle VALNMR scaling: blend halfway between fixed and sqrt(VALNMR/20)
    const rawScale = maxValnmr > 0 ? Math.sqrt(maxValnmr / 20) : 1;
    const valnmrScale = 0.5 + 0.5 * rawScale;
    const r = radiusDeg * valnmrScale;

    // Range circle at full radius
    if (hasRangeCircle) {
      const circle = generateCircle(lon, lat, r);
      features.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: circle },
        properties: { _type: "range", _colour: rangeColour },
      });
    }

    // Sector bearing lines (dashed black) extend 10% beyond the arc
    const bearingRadius = r * 1.1;
    for (const { s1, s2 } of sectors) {
      const p1 = arcPoint(lon, lat, s1, bearingRadius);
      const p2 = arcPoint(lon, lat, s2, bearingRadius);
      features.push({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [p1, [lon, lat], p2],
        },
        properties: { _type: "bearing" },
      });
    }

    // Sector arcs — inner if range circle exists, full radius otherwise
    if (sectors.length > 0) {
      const arcRadius = hasRangeCircle ? r * SECTOR_INNER_RATIO : r;
      for (const { s1, s2, colour } of sectors) {
        const arcPts = generateArc(lon, lat, s1, s2, arcRadius);
        features.push({
          type: "Feature",
          geometry: { type: "LineString", coordinates: arcPts },
          properties: { _type: "arc", _colour: colour },
        });
      }
    }
  }

  return { type: "FeatureCollection", features };
}

// ── Source IDs for all vector tile regions ────────────────────────────

function getVectorSourceIds(): string[] {
  return CHART_REGIONS.map((r, i) =>
    i === 0 ? "s57-vector" : `s57-vector-${r.id}`,
  );
}

// ── Layer class ──────────────────────────────────────────────────────

export class LightSectorLayer {
  private readonly map: maplibregl.Map;
  private enabled = false;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(map: maplibregl.Map) {
    this.map = map;
    this.enabled = getSettings().layerGroups.lightSectors ?? false;

    map.on("style.load", () => this.setup());
    if (map.isStyleLoaded()) this.setup();

    onSettingsChange((s) => {
      const nowEnabled = s.layerGroups.lightSectors ?? false;
      if (nowEnabled !== this.enabled) {
        this.enabled = nowEnabled;
        if (this.enabled) {
          this.rebuild();
        } else {
          this.clear();
        }
      }
    });
  }

  private setup(): void {
    this.addSourceAndLayers();

    // Rebuild when tiles finish loading for any vector source
    this.map.on("sourcedata", (e) => {
      if (
        e.isSourceLoaded &&
        e.sourceId.startsWith("s57-vector") &&
        this.enabled
      ) {
        this.debouncedRebuild();
      }
    });

    // Also rebuild on moveend (viewport change exposes new tiles)
    this.map.on("moveend", () => {
      if (this.enabled) this.debouncedRebuild();
    });

    if (this.enabled) this.rebuild();
  }

  private addSourceAndLayers(): void {
    if (this.map.getSource(SOURCE_ID)) return;

    this.map.addSource(SOURCE_ID, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
      tolerance: 0,
    });

    const rangeColorExpr = [
      "match",
      ["get", "_colour"],
      "red",
      s52Colour("LITRD"),
      "green",
      s52Colour("LITGN"),
      "orange",
      s52Colour("LITRD"),
      // white and yellow lights → bright clean yellow
      "#FFE800",
    ] as unknown as maplibregl.ExpressionSpecification;

    // Range circles: black casing (wider, drawn first = underneath)
    this.map.addLayer({
      id: LAYER_RANGE_BORDER,
      type: "line",
      source: SOURCE_ID,
      minzoom: MIN_ZOOM,
      filter: ["==", ["get", "_type"], "range"],
      paint: {
        "line-color": s52Colour("CHBLK"),
        "line-width": 5,
        "line-opacity": 0.9,
      },
    });

    // Range circles: coloured fill (narrower, drawn on top)
    this.map.addLayer({
      id: LAYER_RANGE_FILL,
      type: "line",
      source: SOURCE_ID,
      minzoom: MIN_ZOOM,
      filter: ["==", ["get", "_type"], "range"],
      paint: {
        "line-color": rangeColorExpr as never,
        "line-width": 3,
        "line-opacity": 0.9,
      },
    });

    // Sector bearing lines: dashed black
    this.map.addLayer({
      id: LAYER_BEARING,
      type: "line",
      source: SOURCE_ID,
      minzoom: MIN_ZOOM,
      filter: ["==", ["get", "_type"], "bearing"],
      paint: {
        "line-color": s52Colour("CHBLK"),
        "line-width": 1,
        "line-dasharray": [6, 3],
        "line-opacity": 0.8,
      },
    });

    // Sector arcs: black casing
    this.map.addLayer({
      id: LAYER_ARC_BORDER,
      type: "line",
      source: SOURCE_ID,
      minzoom: MIN_ZOOM,
      filter: ["==", ["get", "_type"], "arc"],
      paint: {
        "line-color": s52Colour("CHBLK"),
        "line-width": 5,
        "line-opacity": 0.9,
      },
    });

    // Sector arcs: coloured fill (inner when range circle present)
    this.map.addLayer({
      id: LAYER_ARC,
      type: "line",
      source: SOURCE_ID,
      minzoom: MIN_ZOOM,
      filter: ["==", ["get", "_type"], "arc"],
      paint: {
        "line-color": rangeColorExpr as never,
        "line-width": 3,
        "line-opacity": 0.9,
      },
    });
  }

  private debouncedRebuild(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.rebuild(), 100);
  }

  private rebuild(): void {
    if (!this.map.getSource(SOURCE_ID)) {
      this.addSourceAndLayers();
    }
    if (this.map.getZoom() < MIN_ZOOM) {
      this.clear();
      return;
    }

    // Query LIGHTS features from all vector tile sources
    const allLights: Feature[] = [];
    for (const srcId of getVectorSourceIds()) {
      try {
        const feats = this.map.querySourceFeatures(srcId, {
          sourceLayer: "LIGHTS",
        });
        allLights.push(...(feats as unknown as Feature[]));
      } catch {
        // Source may not be loaded yet
      }
    }

    const radius = arcRadiusForZoom(this.map.getZoom());
    const geojson = buildFeatures(allLights, radius);
    (this.map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource)?.setData(
      geojson,
    );
  }

  private clear(): void {
    const src = this.map.getSource(SOURCE_ID) as
      | maplibregl.GeoJSONSource
      | undefined;
    src?.setData({ type: "FeatureCollection", features: [] });
  }
}
