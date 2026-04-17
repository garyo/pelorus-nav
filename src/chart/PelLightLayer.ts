/**
 * PEL (Precision Electronic / Directional) light cluster renderer.
 *
 * Per NOAA NCM §5.30.19.6 / §5.30.19.19, multi-sector and directional
 * lights are encoded as N co-located LIGHTS features (one per sector),
 * plus one parent structure (usually BCNSPP) whose LNAM_REFS points at
 * each child. Our pipeline's annotate_parents pass (enrich.py) stamps
 * every child with PARENT_LNAM, PARENT_OBJNAM, PARENT_LAYER. (NOAA and
 * the S-57 spec call these "master/slave" relationships; we use the
 * inclusive parent/child terminology internally.)
 *
 * This layer reads LIGHTS features from vector tiles, detects PEL children
 * (those with PARENT_LNAM), and replaces the stacked-icons-on-one-pixel
 * rendering of the raw s57-lights layer with a fanned display:
 *
 *   - Each child teardrop is rotated toward its sector midpoint bearing
 *     (flipped 180° so it points FROM the light, not FROM seaward).
 *   - Labels only appear for non-fixed sectors (LITCHR != 1) to cut
 *     clutter, matching the NOAA ENC viewer.
 *   - One parent-name feature per cluster renders the parent's OBJNAM
 *     in quotes at z14+.
 *   - PEL children are hidden from the raw s57-lights layer via a dynamic
 *     filter; non-PEL lights render there unchanged.
 */

import type { Feature, FeatureCollection, Point, Position } from "geojson";
import type maplibregl from "maplibre-gl";
import { getRegionLayerIds, getVectorSourceIds } from "../data/chart-catalog";
import { getSettings, onSettingsChange } from "../settings";
import { s52Colour } from "./s52-colours";
import { buildLayerExpressions, getIconScheme } from "./styles/icon-sets";
import {
  lightLabelTextField,
  SORT_KEY_LANDMARK,
  SORT_KEY_LIGHT_CHAR,
  VARIABLE_ANCHOR_LAYOUT,
} from "./styles/style-context";

const SOURCE_ID = "_pel-lights";
const LAYER_ICON = "_pel-light-icon";
const LAYER_PARENT_NAME = "_pel-parent-name";

/**
 * Suffixes of the style layers we dynamically filter to hide PEL children.
 * Actual layer IDs are region-prefixed by the chart catalog
 * (``s57-{region}-lights`` etc.), so we resolve them with
 * {@link getRegionLayerIds} at apply time.
 */
const SUPPRESSED_LAYER_SUFFIXES = ["lights", "lights-glow"] as const;

/** Minimum zoom to show PEL clusters — matches `s57-lights` minzoom. */
const MIN_ZOOM = 6;

/** Zoom at which the parent OBJNAM appears. */
const PARENT_NAME_MINZOOM = 14;

/**
 * Minimum number of children for a cluster to count as a PEL. Every S-57
 * lighted buoy/beacon carries a parent/child relationship (the structure
 * is parent, the light is child), so ``PARENT_LNAM`` alone isn't enough
 * to identify a precision directional light. NOAA NCM §5.30.19.19 defines
 * a sector light as two or more co-located LIGHTS features; we use that
 * as the PEL threshold so single-child structures (regular lighted
 * buoys/beacons) keep their normal rendering.
 */
const PEL_MIN_CHILDREN = 2;

/**
 * S-52 light-flare sprites are pre-rotated 135° in the sprite sheet so the
 * teardrop points down-right per Chart No.1 convention. Our per-sector
 * rotation must subtract this baked-in rotation. Nautical / simplified
 * sprites aren't pre-rotated, so no adjustment is needed.
 */
const S52_FLARE_BAKED_ROTATION = 135;

interface PelLightsProps {
  LNAM?: string;
  PARENT_LNAM?: string;
  PARENT_OBJNAM?: string;
  PARENT_LAYER?: string;
  SECTR1?: number;
  SECTR2?: number;
  LITCHR?: number;
  LABEL?: string;
  COLOUR?: unknown;
  HEIGHT?: number;
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
  parentObjnam?: string;
  /**
   * Source layer of the parent feature (e.g. "BCNSPP", "LNDMRK"). When the
   * parent is itself a LNDMRK, its OBJNAM is already rendered by the
   * ``s57-lndmrk`` layer — we skip the PEL parent-name to avoid the same
   * name appearing twice (unquoted from LNDMRK, quoted from this layer).
   */
  parentLayer?: string;
  children: Feature<Point>[];
}

/**
 * Group PEL children by **position** (5-decimal precision ≈ 1 m). We key
 * on location rather than ``PARENT_LNAM`` because S-57 LNAMs are
 * cell-scoped: the same physical aid appears in multiple overlapping
 * ENC cells (e.g. Graves Light in US5BOSCF + US4MA1HC + US2EC04M),
 * and each cell has its own BCNSPP parent with its own LNAM. Keying
 * on position merges all of them into a single cluster so we emit one
 * set of deduped sector features regardless of tile overlap.
 *
 * Only features with a non-empty ``PARENT_LNAM`` (set by the pipeline's
 * annotate_parents pass) are considered PEL children.
 *
 * Exported for unit testing.
 */
export function buildClusters(lightsFeatures: Feature[]): Map<string, Cluster> {
  const clusters = new Map<string, Cluster>();
  for (const f of lightsFeatures) {
    if (f.geometry.type !== "Point") continue;
    const props = (f.properties ?? {}) as PelLightsProps;
    if (!props.PARENT_LNAM) continue;
    const coords = f.geometry.coordinates;
    const key = `${coords[0].toFixed(5)},${coords[1].toFixed(5)}`;
    let cluster = clusters.get(key);
    if (!cluster) {
      cluster = {
        position: coords,
        parentObjnam: props.PARENT_OBJNAM,
        parentLayer: props.PARENT_LAYER,
        children: [],
      };
      clusters.set(key, cluster);
    } else {
      // Any child with the OBJNAM/LAYER will do — NOAA sometimes leaves
      // these attributes only on one of the siblings.
      if (!cluster.parentObjnam && props.PARENT_OBJNAM) {
        cluster.parentObjnam = props.PARENT_OBJNAM;
      }
      if (!cluster.parentLayer && props.PARENT_LAYER) {
        cluster.parentLayer = props.PARENT_LAYER;
      }
    }
    cluster.children.push(f as Feature<Point>);
  }
  return clusters;
}

/**
 * Build the GeoJSON overlay: one child point per sector (rotated + filtered
 * label) and one parent-name point per cluster. Only clusters with
 * ``PEL_MIN_CHILDREN`` or more children count as PEL; everything else keeps
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
    if (cluster.children.length < PEL_MIN_CHILDREN) continue;

    // Dedupe children by sector identity: multiple cells contribute the same
    // sector definition (same bearings + rhythm + colour + height/range)
    // and we want a single emitted icon+label per unique sector. All cells'
    // LNAMs still go into the suppression list so every copy hides from
    // ``s57-lights``.
    const seenSectorKey = new Set<string>();
    // Dedupe labels within the cluster too: a sector light where several
    // sectors share the same rhythm (e.g. Graves Light's three Fl(2) 12s
    // sectors at different bearings) would otherwise render the same
    // "Fl(2) 12s 98ft14M" text several times at the same point. Keep the
    // first matching text; blank the rest (icon still renders).
    const seenLabelKey = new Set<string>();

    for (const child of cluster.children) {
      const props = (child.properties ?? {}) as PelLightsProps;
      if (props.LNAM) suppressedLnams.push(props.LNAM);

      const s1 = typeof props.SECTR1 === "number" ? props.SECTR1 : null;
      const s2 = typeof props.SECTR2 === "number" ? props.SECTR2 : null;
      // Full-identity dedup: skip if we've already emitted an equivalent
      // sector from another cell.
      const sectorKey = [
        s1 ?? "",
        s2 ?? "",
        props.LITCHR ?? "",
        String(props.COLOUR ?? ""),
        props.LABEL ?? "",
        props.HEIGHT ?? "",
        props.VALNMR ?? "",
      ].join("|");
      if (seenSectorKey.has(sectorKey)) continue;
      seenSectorKey.add(sectorKey);

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
      let label = props.LITCHR === 1 ? "" : (props.LABEL ?? "");
      if (label) {
        // Key on the full rendered tail (stem + HEIGHT + VALNMR) so two
        // sectors that differ only in bearing collapse to one label,
        // but sectors with different heights/ranges keep their own.
        const key = `${label}|${props.HEIGHT ?? ""}|${props.VALNMR ?? ""}`;
        if (seenLabelKey.has(key)) label = "";
        else seenLabelKey.add(key);
      }

      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: child.geometry.coordinates },
        properties: {
          _type: "child",
          ROT: rot,
          LABEL: label,
          // Raw numeric props the shared LIGHTS iconExpr and
          // lightLabelTextField read — COLOUR and VALNMR drive icon
          // selection, HEIGHT/VALNMR drive the unit-aware label tail.
          COLOUR: props.COLOUR ?? null,
          VALNMR: props.VALNMR ?? null,
          HEIGHT: props.HEIGHT ?? null,
          CATLIT: props.CATLIT ?? null,
        },
      });
    }

    // Emit parent-name only when the parent isn't itself a LNDMRK — the
    // landmark layer already renders its OBJNAM, and a duplicate would
    // produce the "unquoted at low zoom, quoted at high zoom" flicker.
    if (cluster.parentObjnam && cluster.parentLayer !== "LNDMRK") {
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: cluster.position },
        properties: {
          _type: "parent-name",
          OBJNAM: cluster.parentObjnam,
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
    let currentDepthUnit = getSettings().depthUnit;
    onSettingsChange((s) => {
      if (
        s.displayTheme !== currentTheme ||
        s.symbologyScheme !== currentSymbology ||
        s.depthUnit !== currentDepthUnit
      ) {
        currentTheme = s.displayTheme;
        currentSymbology = s.symbologyScheme;
        currentDepthUnit = s.depthUnit;
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

    // A style rebuild (e.g. toggling a layer group) wipes any filters we
    // previously set via ``setFilter`` on the base s57-lights layers. Reset
    // the tracking set so the next rebuild always re-applies our
    // suppression filter, even if the LNAM set hasn't changed.
    this.suppressedLnams = new Set();

    this.map.on("sourcedata", (e) => {
      if (e.isSourceLoaded && e.sourceId.startsWith("s57-vector")) {
        this.debouncedRebuild();
      }
    });
    this.map.on("moveend", () => this.debouncedRebuild());

    this.rebuild();
  }

  /** Concrete region-prefixed style layer IDs we suppress PEL slaves from. */
  private suppressedLayerIds(): string[] {
    return SUPPRESSED_LAYER_SUFFIXES.flatMap((suffix) =>
      getRegionLayerIds(suffix),
    );
  }

  private captureOriginalFilters(): void {
    // Base layers have no explicit filter today; capture whatever they have
    // at style-load time so we can restore if ever needed.
    for (const id of this.suppressedLayerIds()) {
      if (this.map.getLayer(id)) {
        this.originalFilters.set(id, this.map.getFilter(id));
      }
    }
  }

  private removeLayers(): void {
    for (const id of [LAYER_PARENT_NAME, LAYER_ICON]) {
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
      "symbol-sort-key": SORT_KEY_LIGHT_CHAR,
      "icon-image": iconExpr,
      "icon-size": 0.7,
      "icon-rotate": ["get", "ROT"],
      "icon-rotation-alignment": "map",
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "text-field": lightLabelTextField(s.depthUnit),
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
      filter: ["==", ["get", "_type"], "child"],
      layout: layout as maplibregl.SymbolLayerSpecification["layout"],
      paint: {
        "text-color": s52Colour("SNDG2"),
        "text-halo-color": s52Colour("NAIDH"),
        "text-halo-width": 1.5,
      },
    });

    this.map.addLayer({
      id: LAYER_PARENT_NAME,
      type: "symbol",
      source: SOURCE_ID,
      minzoom: PARENT_NAME_MINZOOM,
      filter: ["==", ["get", "_type"], "parent-name"],
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
        // Parent names are often long wrapped blocks; give them a bit
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

    for (const id of this.suppressedLayerIds()) {
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
