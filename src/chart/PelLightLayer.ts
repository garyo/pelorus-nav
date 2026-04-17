/**
 * PEL (Precision Electronic / Directional) light cluster renderer.
 *
 * Per NOAA NCM §5.30.19.6 / §5.30.19.19, multi-sector and directional
 * lights are encoded as N co-located LIGHTS features (one per sector),
 * plus one master structure (usually BCNSPP) whose LNAM_REFS points at
 * each slave. Our pipeline's annotate_masters pass (enrich.py) stamps
 * every slave with MASTER_LNAM, MASTER_OBJNAM, MASTER_LAYER.
 *
 * This layer reads LIGHTS features from vector tiles, detects PEL slaves
 * (those with MASTER_LNAM), and replaces the stacked-icons-on-one-pixel
 * rendering of the raw s57-lights layer with a fanned display:
 *
 *   - Each slave teardrop is rotated toward its sector midpoint bearing
 *     (flipped 180° so it points FROM the light, not FROM seaward).
 *   - Labels only appear for non-fixed sectors (LITCHR != 1) to cut
 *     clutter, matching the NOAA ENC viewer.
 *   - One master-name feature per cluster renders the master's OBJNAM
 *     in quotes at z14+.
 *   - PEL slaves are hidden from the raw s57-lights layer via a dynamic
 *     filter; non-PEL lights render there unchanged.
 */

import type { Feature, FeatureCollection, Point, Position } from "geojson";
import type maplibregl from "maplibre-gl";
import { getVectorSourceIds } from "../data/chart-catalog";
import { getSettings, onSettingsChange } from "../settings";
import { s52Colour } from "./s52-colours";
import { buildLayerExpressions, getIconScheme } from "./styles/icon-sets";
import {
  SORT_KEY_LANDMARK,
  SORT_KEY_NAVAID,
  VARIABLE_ANCHOR_LAYOUT,
} from "./styles/style-context";

const SOURCE_ID = "_pel-lights";
const LAYER_ICON = "_pel-light-icon";
const LAYER_MASTER_NAME = "_pel-master-name";

/** Style layers we dynamically filter to hide PEL slaves. */
const SUPPRESSED_LAYERS = ["s57-lights", "s57-lights-glow"] as const;

/** Minimum zoom to show PEL clusters — matches `s57-lights` minzoom. */
const MIN_ZOOM = 6;

/** Zoom at which the master OBJNAM appears. */
const MASTER_NAME_MINZOOM = 14;

/**
 * Minimum number of slaves for a cluster to count as a PEL. Every S-57
 * lighted buoy/beacon carries a master/slave relationship (the structure
 * is master, the light is slave), so ``MASTER_LNAM`` alone isn't enough
 * to identify a precision directional light. NOAA NCM §5.30.19.19 defines
 * a sector light as two or more co-located LIGHTS features; we use that
 * as the PEL threshold so single-slave structures (regular lighted
 * buoys/beacons) keep their normal rendering.
 */
const PEL_MIN_SLAVES = 2;

/**
 * S-52 light-flare sprites are pre-rotated 135° in the sprite sheet so the
 * teardrop points down-right per Chart No.1 convention. Our per-sector
 * rotation must subtract this baked-in rotation. Nautical / simplified
 * sprites aren't pre-rotated, so no adjustment is needed.
 */
const S52_FLARE_BAKED_ROTATION = 135;

interface PelLightsProps {
  LNAM?: string;
  MASTER_LNAM?: string;
  MASTER_OBJNAM?: string;
  MASTER_LAYER?: string;
  SECTR1?: number;
  SECTR2?: number;
  LITCHR?: number;
  LABEL?: string;
  COLOUR?: unknown;
  VALNMR?: number;
  CATLIT?: unknown;
}

/** Compute the midpoint bearing of [s1, s2], walking the short arc. */
function midBearing(s1: number, s2: number): number {
  let sweep = (s2 - s1) % 360;
  if (sweep < 0) sweep += 360;
  return (s1 + sweep / 2) % 360;
}

interface Cluster {
  position: Position;
  masterObjnam?: string;
  /**
   * Source layer of the master feature (e.g. "BCNSPP", "LNDMRK"). When the
   * master is itself a LNDMRK, its OBJNAM is already rendered by the
   * ``s57-lndmrk`` layer — we skip the PEL master-name to avoid the same
   * name appearing twice (unquoted from LNDMRK, quoted from this layer).
   */
  masterLayer?: string;
  slaves: Feature<Point>[];
}

/**
 * Group PEL slaves by `MASTER_LNAM`. Returns one Cluster per master.
 *
 * Exported for unit testing.
 */
export function buildClusters(lightsFeatures: Feature[]): Map<string, Cluster> {
  const clusters = new Map<string, Cluster>();
  for (const f of lightsFeatures) {
    if (f.geometry.type !== "Point") continue;
    const props = (f.properties ?? {}) as PelLightsProps;
    const key = props.MASTER_LNAM;
    if (!key) continue;
    let cluster = clusters.get(key);
    if (!cluster) {
      cluster = {
        position: f.geometry.coordinates,
        masterObjnam: props.MASTER_OBJNAM,
        masterLayer: props.MASTER_LAYER,
        slaves: [],
      };
      clusters.set(key, cluster);
    } else {
      // Any slave with the OBJNAM/LAYER will do — NOAA sometimes leaves
      // these attributes only on one of the siblings.
      if (!cluster.masterObjnam && props.MASTER_OBJNAM) {
        cluster.masterObjnam = props.MASTER_OBJNAM;
      }
      if (!cluster.masterLayer && props.MASTER_LAYER) {
        cluster.masterLayer = props.MASTER_LAYER;
      }
    }
    cluster.slaves.push(f as Feature<Point>);
  }
  return clusters;
}

/**
 * Build the GeoJSON overlay: one slave point per sector (rotated + filtered
 * label) and one master-name point per cluster. Only clusters with
 * ``PEL_MIN_SLAVES`` or more slaves count as PEL; everything else keeps
 * its normal ``s57-lights`` rendering.
 *
 * ``spritePrefix`` distinguishes S-52 (pre-rotated flares) from nautical
 * sprites so we emit the right per-feature rotation.
 *
 * Exported for unit tests.
 */
export function buildGeoJson(
  lightsFeatures: Feature[],
  spritePrefix = "",
): {
  geojson: FeatureCollection;
  suppressedLnams: string[];
} {
  const clusters = buildClusters(lightsFeatures);
  const features: Feature<Point>[] = [];
  const suppressedLnams: string[] = [];
  const bakedRotation = spritePrefix.startsWith("s52")
    ? S52_FLARE_BAKED_ROTATION
    : 0;

  for (const cluster of clusters.values()) {
    if (cluster.slaves.length < PEL_MIN_SLAVES) continue;

    for (const slave of cluster.slaves) {
      const props = (slave.properties ?? {}) as PelLightsProps;
      if (props.LNAM) suppressedLnams.push(props.LNAM);

      const s1 = typeof props.SECTR1 === "number" ? props.SECTR1 : null;
      const s2 = typeof props.SECTR2 === "number" ? props.SECTR2 : null;
      // S-57 sectors are FROM seaward; flip 180° so the teardrop points
      // outward from the light (matches LightSectorLayer's flip). Then
      // subtract the sprite's baked-in rotation so icon-rotate expresses
      // displacement from that natural orientation, not absolute bearing.
      const targetBearing =
        s1 !== null && s2 !== null ? (midBearing(s1, s2) + 180) % 360 : 0;
      const rot = (((targetBearing - bakedRotation) % 360) + 360) % 360;

      // NOAA-style label filtering: suppress fixed sectors (LITCHR=1).
      // The overlay owns the label so we don't depend on LABEL being
      // pre-blanked in the tile.
      const label = props.LITCHR === 1 ? "" : (props.LABEL ?? "");

      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: slave.geometry.coordinates },
        properties: {
          _type: "slave",
          ROT: rot,
          LABEL: label,
          // Props the shared LIGHTS iconExpr reads from the feature:
          COLOUR: props.COLOUR ?? null,
          VALNMR: props.VALNMR ?? null,
          CATLIT: props.CATLIT ?? null,
        },
      });
    }

    // Emit master-name only when the master isn't itself a LNDMRK — the
    // landmark layer already renders its OBJNAM, and a duplicate would
    // produce the "unquoted at low zoom, quoted at high zoom" flicker.
    if (cluster.masterObjnam && cluster.masterLayer !== "LNDMRK") {
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: cluster.position },
        properties: {
          _type: "master-name",
          OBJNAM: cluster.masterObjnam,
        },
      });
    }
  }

  return {
    geojson: { type: "FeatureCollection", features },
    suppressedLnams,
  };
}

export class PelLightLayer {
  private readonly map: maplibregl.Map;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private suppressedLnams: Set<string> = new Set();
  /** Original filter on each suppressed layer so we can restore it. */
  private originalFilters: Map<string, unknown> = new Map();

  constructor(map: maplibregl.Map) {
    this.map = map;

    map.on("style.load", () => this.setup());
    if (map.isStyleLoaded()) this.setup();

    let currentTheme = getSettings().displayTheme;
    let currentSymbology = getSettings().symbologyScheme;
    onSettingsChange((s) => {
      if (
        s.displayTheme !== currentTheme ||
        s.symbologyScheme !== currentSymbology
      ) {
        currentTheme = s.displayTheme;
        currentSymbology = s.symbologyScheme;
        if (this.map.isStyleLoaded()) {
          this.addSourceAndLayers();
          this.rebuild();
        }
      }
    });
  }

  private setup(): void {
    this.captureOriginalFilters();
    this.addSourceAndLayers();

    this.map.on("sourcedata", (e) => {
      if (e.isSourceLoaded && e.sourceId.startsWith("s57-vector")) {
        this.debouncedRebuild();
      }
    });
    this.map.on("moveend", () => this.debouncedRebuild());

    this.rebuild();
  }

  private captureOriginalFilters(): void {
    // The s57-lights layer has no explicit filter today; capture whatever
    // it is at style-load time so we can restore if ever needed.
    for (const id of SUPPRESSED_LAYERS) {
      if (this.map.getLayer(id)) {
        this.originalFilters.set(id, this.map.getFilter(id));
      }
    }
  }

  private removeLayers(): void {
    for (const id of [LAYER_MASTER_NAME, LAYER_ICON]) {
      if (this.map.getLayer(id)) this.map.removeLayer(id);
    }
    if (this.map.getSource(SOURCE_ID)) this.map.removeSource(SOURCE_ID);
  }

  private addSourceAndLayers(): void {
    this.removeLayers();

    this.map.addSource(SOURCE_ID, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
      tolerance: 0,
    });

    // Reuse the exact same iconExpr + offsetExpr that `s57-lights` uses so
    // the sprites stay consistent across themes and symbology schemes. The
    // offset is essential: the LIGHTS11/12/13 teardrop sprites have their
    // tip at SVG origin (near top-left of the sprite bbox), not at the
    // bbox centre — without offsetExpr the tips render far off the feature.
    const s = getSettings();
    const scheme = getIconScheme(s.symbologyScheme, s.displayTheme);
    const { iconExpr, offsetExpr } = buildLayerExpressions(
      "LIGHTS",
      scheme.icons,
      scheme.fallback,
    );

    const layout: Record<string, unknown> = {
      "symbol-sort-key": SORT_KEY_NAVAID,
      "icon-image": iconExpr,
      "icon-size": 0.7,
      "icon-rotate": ["get", "ROT"],
      "icon-rotation-alignment": "map",
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "text-field": ["get", "LABEL"],
      "text-size": 10,
      "text-offset": [0, -1.5],
      "text-allow-overlap": false,
      "text-optional": true,
    };
    if (offsetExpr) layout["icon-offset"] = offsetExpr;

    this.map.addLayer({
      id: LAYER_ICON,
      type: "symbol",
      source: SOURCE_ID,
      minzoom: MIN_ZOOM,
      filter: ["==", ["get", "_type"], "slave"],
      layout: layout as maplibregl.SymbolLayerSpecification["layout"],
      paint: {
        "text-color": s52Colour("SNDG2"),
        "text-halo-color": s52Colour("NAIDH"),
        "text-halo-width": 1.5,
      },
    });

    this.map.addLayer({
      id: LAYER_MASTER_NAME,
      type: "symbol",
      source: SOURCE_ID,
      minzoom: MASTER_NAME_MINZOOM,
      filter: ["==", ["get", "_type"], "master-name"],
      layout: {
        "text-field": [
          "concat",
          '"',
          ["get", "OBJNAM"],
          '"',
        ] as unknown as maplibregl.ExpressionSpecification,
        ...VARIABLE_ANCHOR_LAYOUT,
        "symbol-sort-key": SORT_KEY_LANDMARK,
        "text-size": 11,
        // Master names are often long wrapped blocks; give them a bit
        // more breathing room than the shared default so they don't
        // crowd the sector labels.
        "text-radial-offset": 2,
        "text-padding": 5,
        "text-allow-overlap": false,
        "text-optional": true,
        "text-max-width": 12,
      },
      paint: {
        "text-color": s52Colour("CHBLK"),
        "text-halo-color": s52Colour("NAIDH"),
        "text-halo-width": 1.5,
      },
    });
  }

  private debouncedRebuild(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.rebuild(), 100);
  }

  private rebuild(): void {
    if (!this.map.getSource(SOURCE_ID)) this.addSourceAndLayers();

    const allLights: Feature[] = [];
    for (const srcId of getVectorSourceIds()) {
      try {
        const feats = this.map.querySourceFeatures(srcId, {
          sourceLayer: "LIGHTS",
        });
        allLights.push(...(feats as unknown as Feature[]));
      } catch {
        // source not loaded yet
      }
    }

    const s = getSettings();
    const scheme = getIconScheme(s.symbologyScheme, s.displayTheme);
    const { geojson, suppressedLnams } = buildGeoJson(allLights, scheme.sprite);
    (this.map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource)?.setData(
      geojson,
    );
    this.applySuppressionFilter(suppressedLnams);
  }

  private applySuppressionFilter(lnams: string[]): void {
    // Only push a new filter if the suppression set actually changed; setFilter
    // triggers a re-layout of the affected layer.
    const next = new Set(lnams);
    if (setsEqual(next, this.suppressedLnams)) return;
    this.suppressedLnams = next;

    const lnamList = Array.from(next);
    const filterExpr =
      lnamList.length === 0
        ? null
        : ([
            "!",
            ["in", ["get", "LNAM"], ["literal", lnamList]],
          ] as unknown as maplibregl.FilterSpecification);

    for (const id of SUPPRESSED_LAYERS) {
      if (!this.map.getLayer(id)) continue;
      this.map.setFilter(id, filterExpr);
    }
  }
}

function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}
