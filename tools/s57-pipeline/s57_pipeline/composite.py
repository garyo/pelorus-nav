"""MVT-level per-tile compositing for multi-scale ENC data.

For each tile (z,x,y) across all cells, composites features from
multiple ENC cells/bands using exact M_COVR coverage polygons.
Highest-band data fills first, then progressively lower bands fill
remaining gaps until the tile is 100% covered (navaid layers at z11 fill
from the approach band first — see _fill_passes).

Replaces the old tile-join + priority-merge steps.
"""

from __future__ import annotations

import gzip
import json
import multiprocessing
import os
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import mapbox_vector_tile
from shapely import line_merge, make_valid, prepare, union_all
from shapely.geometry import LineString, MultiLineString, Polygon, box, mapping, shape
from shapely.geometry.base import BaseGeometry
from shapely.geometry.collection import GeometryCollection
from shapely.io import from_wkb, to_wkb

from pmtiles.convert import all_tiles, write
from pmtiles.reader import MmapSource, Reader, zxy_to_tileid

from .scamin import COMPOSITE_PREFERRED_BAND, COMPOSITE_PREFERRED_LAYERS
from .tilemath import latlon_to_tile as _latlon_to_tile
from .tilemath import tile_to_bbox as _tile_to_bbox

# MVT default extent (coordinate space 0..4096)
_MVT_EXTENTS = 4096

# Safety-critical hazard layers (MVT layer names are the uppercase S-57
# names — tippecanoe -l gets stem.upper(); mirrors _HAZARD_LAYERS in
# enrich.py). These are clipped to the EXACT unfilled coverage during
# multi-band compositing — never to the buffered anti-sliver region — so an
# overview cell's hazard features can't leak ~1 km into a detailed cell's
# coverage. Leaked overview copies lack the detailed attributes (e.g.
# CATOBS) that safety symbology keys on.
_HAZARD_LAYER_NAMES = {"OBSTRN", "WRECKS", "UWTROC"}

# Area classes whose outlines the app draws (shared with it through
# tools/area-edges.json). A clipped polygon's ring runs along every cut it
# went through — the tile edge, the cell's coverage limit (S-57's masked
# edges, which OGR drops), a higher band's coverage edge — and an outline
# drawn from the ring paints those cuts as boundaries. Composited tiles
# therefore carry each such polygon's real edges as lines in a separate
# "<CLASS>_EDGES" layer and flag the polygon, so the app draws the lines
# instead of the ring. Single-source tiles keep tippecanoe's buffered
# geometry, whose cuts lie outside the tile, and pass through unchanged.
_AREA_EDGES = json.loads(
    (Path(__file__).resolve().parents[2] / "area-edges.json").read_text()
)
EDGE_CLASSES: frozenset[str] = frozenset(_AREA_EDGES["classes"])
EDGE_LAYER_SUFFIX: str = _AREA_EDGES["suffix"]
SPLIT_EDGES_FLAG: str = _AREA_EDGES["flag"]

# A cut edge comes out of MVT quantization up to about a unit off the line it
# was cut along; boundary within this many units of a cut counts as the cut.
_CUT_TOLERANCE_UNITS = 2

# Version of what composited tiles contain; bump it when a compositor change
# alters the output, so every region re-composites (see compute_composite_hash).
COMPOSITE_FORMAT = 2

# Lines where the compilation scale of the cell on show changes (the S-52
# scale boundary), carrying the scales on both sides.
SCALE_BOUNDARY_LAYER = "SCLBDY"


@dataclass
class CellTileSource:
    """A PMTiles source with its cell's metadata."""

    pmtiles_path: Path
    band: int
    coverage: BaseGeometry  # M_COVR polygon for this cell
    cell_name: str = ""  # ENC cell name for grouping layers from same cell
    cscl: int | None = None  # compilation scale denominator (DSPM CSCL)


# One multi-band fill pass: cell order key (used with reverse=True) over
# (band, cell_name), and which MVT layers the pass fills (None = all).
_FillPass = tuple[
    Callable[[tuple[int, str]], tuple[bool, int]],
    Callable[[str], bool] | None,
]


def _by_band(key: tuple[int, str]) -> tuple[bool, int]:
    return (False, key[0])


def _fill_passes(z: int) -> list[_FillPass]:
    """Fill passes for a multi-band tile at zoom z: normally one, highest
    band first. Where COMPOSITE_PREFERRED_BAND names a band for z, the
    COMPOSITE_PREFERRED_LAYERS fill from that band first in a second pass
    (or the whole tile does, when the layer set is None)."""
    preferred = COMPOSITE_PREFERRED_BAND.get(z)
    if preferred is None:
        return [(_by_band, None)]

    def prefer(key: tuple[int, str]) -> tuple[bool, int]:
        return (key[0] == preferred, key[0])

    layers = COMPOSITE_PREFERRED_LAYERS
    if layers is None:
        return [(prefer, None)]
    return [
        (_by_band, lambda name: name not in layers),
        (prefer, lambda name: name in layers),
    ]


@dataclass
class _CellGroup:
    """One cell's share of a tile: its per-layer tiles and its coverage."""

    coverage: BaseGeometry
    cscl: int | None
    tiles: list[bytes]


def _group_cells(entries: list[_SerEntry]) -> dict[tuple[int, str], _CellGroup]:
    """Group a tile's entries by cell (band + cell_name share one coverage)."""
    groups: dict[tuple[int, str], _CellGroup] = {}
    for band_val, cell_name, data, cov_wkb, cscl in entries:
        group = groups.get((band_val, cell_name))
        if group is None:
            group = groups[(band_val, cell_name)] = _CellGroup(
                from_wkb(cov_wkb), cscl, []
            )
        group.tiles.append(data)
    return groups


def _fill_multi_band(
    z: int,
    tile_bbox: BaseGeometry,
    cell_groups: dict[tuple[int, str], _CellGroup],
) -> tuple[dict[str, list[dict]], set[str], bool, _DropCounts]:
    """Composite one multi-band tile: each pass walks the cells in its
    order, clipping every cell's features to its M_COVR ∩ the area earlier
    cells left unfilled, until the tile is covered.

    Returns (features by layer, used cells, fully_filled, dropped counts);
    fully_filled reflects the first pass, which covers the base layers and
    decides where the scale boundaries run.
    """
    output_features: dict[str, list[dict]] = {}
    used: set[str] = set()
    drops: _DropCounts = {}
    fully_filled = False
    owned_regions: list[tuple[int | None, BaseGeometry]] = []

    for pass_index, (order_key, keep_layer) in enumerate(_fill_passes(z)):
        filled = shape({"type": "Polygon", "coordinates": []})  # empty
        for cell_key in sorted(cell_groups, key=order_key, reverse=True):
            group = cell_groups[cell_key]
            coverage = group.coverage
            _band_val, cell_name = cell_key

            cell_coverage = coverage.intersection(tile_bbox)
            if cell_coverage.is_empty:
                continue

            unfilled = tile_bbox.difference(filled)
            if unfilled.is_empty:
                break

            usable = make_valid(cell_coverage.intersection(unfilled))
            if usable.is_empty:
                continue

            # Expand clipping region slightly (~1km) so features extend past
            # the M_COVR boundary.  Tippecanoe simplification can pull polygon
            # vertices away from the boundary at low zoom, leaving thin gaps
            # between adjacent cells.  The extra overlap is harmless (same
            # depth polygons from both cells stack) and prevents white slivers.
            #
            # The buffer is clipped to tile_bbox only — NOT to region_bbox.
            # Region boundary overlap is prevented by tile-center ownership
            # (each tile is assigned to exactly one region), so the buffer
            # can safely extend past the region boundary within this tile.
            #
            # Hazard layers are exempt from the buffer (clipped to the exact
            # unfilled coverage): a lower band's OBSTRN/WRECKS/UWTROC leaking
            # into detailed-cell coverage shows the overview copy — often
            # missing CATOBS — inside an area the detailed cell owns.
            clip_region = make_valid(usable.buffer(0.01)).intersection(tile_bbox)
            owned = _owned_region(usable, tile_bbox)

            for data in group.tiles:
                features, dropped = _clip_mvt_features(
                    data, clip_region, tile_bbox,
                    hazard_region=usable, keep_layer=keep_layer,
                    owned_region=owned,
                )
                _merge_drops(drops, cell_name, dropped)
                if features:
                    used.add(cell_name)
                    for ln, feats in features.items():
                        output_features.setdefault(ln, []).extend(feats)
            if pass_index == 0 and not owned.area.is_empty:
                owned_regions.append((group.cscl, owned.area))

            # Track filled area with the *original* (unbuffered) coverage so
            # adjacent cells can still fill the gap from their side.
            filled = make_valid(filled.union(cell_coverage))
            if filled.contains(tile_bbox):
                break

        if pass_index == 0:
            fully_filled = filled.contains(tile_bbox)

    boundaries = _scale_boundaries(tile_bbox, owned_regions)
    if boundaries:
        output_features[SCALE_BOUNDARY_LAYER] = boundaries
    return output_features, used, fully_filled, drops


def _polygonal(geom: BaseGeometry) -> BaseGeometry:
    """The area of a region. Intersecting regions that only touch, then
    make_valid, yields their shared border as lines or points (alone, or in
    a collection beside real area); those own no area."""
    if geom.geom_type in ("Polygon", "MultiPolygon"):
        return geom
    if isinstance(geom, GeometryCollection):
        areas = [g for g in geom.geoms if g.geom_type in ("Polygon", "MultiPolygon")]
        if areas:
            return union_all(areas)
    return Polygon()


def _cut_tolerance(tile_bbox: BaseGeometry) -> float:
    """_CUT_TOLERANCE_UNITS in degrees: MVT units are tile width / extent,
    and a tile is never taller than it is wide, so this is the larger axis."""
    west, _south, east, _north = tile_bbox.bounds
    return (east - west) / _MVT_EXTENTS * _CUT_TOLERANCE_UNITS


def _line_parts(geom: BaseGeometry) -> list[LineString]:
    """The non-empty LineStrings in a geometry, at any nesting depth."""
    if geom.is_empty:
        return []
    if isinstance(geom, LineString):
        return [geom]
    if isinstance(geom, (MultiLineString, GeometryCollection)):
        return [line for part in geom.geoms for line in _line_parts(part)]
    return []


def _merged_lines(geom: BaseGeometry, min_length: float = 0.0) -> list[LineString]:
    """A geometry's line parts joined end to end, dropping any shorter than
    min_length (slivers where two lines cross rather than run together)."""
    lines = _line_parts(geom)
    if len(lines) > 1:
        lines = _line_parts(line_merge(MultiLineString(lines)))
    return [line for line in lines if line.length > min_length]


@dataclass(frozen=True)
class _OwnedRegion:
    """The part of a tile one cell's data is shown in, and its cuts: the
    region's boundary grown by the cut tolerance. Both are prepared, as every
    area of every layer of the cell is tested against them."""

    area: BaseGeometry
    cuts: BaseGeometry


def _owned_region(area: BaseGeometry, tile_bbox: BaseGeometry) -> _OwnedRegion:
    area = _polygonal(area)
    cuts = area.boundary.buffer(_cut_tolerance(tile_bbox))
    prepare(area)
    prepare(cuts)
    return _OwnedRegion(area, cuts)


def _real_edges(area: BaseGeometry, owned: _OwnedRegion) -> list[LineString]:
    """The parts of an area's boundary that are real edges: inside the region
    its cell owns in this tile and away from every cut."""
    boundary = area.boundary
    if not owned.cuts.intersects(boundary):
        # Clear of every cut, each ring lies wholly inside or outside.
        return [
            ring for ring in _line_parts(boundary) if owned.area.intersects(ring)
        ]
    return _merged_lines(boundary.intersection(owned.area).difference(owned.cuts))


def _scale_boundaries(
    tile_bbox: BaseGeometry,
    owned_regions: list[tuple[int | None, BaseGeometry]],
) -> list[dict]:
    """Scale-boundary lines between the cells sharing a tile: wherever two
    cells' owned regions meet and their compilation scales differ. Each line
    carries the more detailed side's scale (CSCL_DETAILED) and the other's
    (CSCL_COARSE). Tile edges are not boundaries; the neighbouring tile draws
    its own side."""
    tol = _cut_tolerance(tile_bbox)
    tile_edge = tile_bbox.boundary.buffer(tol)
    features: list[dict] = []
    for i, (cscl_a, region_a) in enumerate(owned_regions):
        for cscl_b, region_b in owned_regions[i + 1:]:
            if cscl_a is None or cscl_b is None or cscl_a == cscl_b:
                continue
            shared = region_a.boundary.intersection(region_b.boundary.buffer(tol))
            props = {
                "CSCL_DETAILED": min(cscl_a, cscl_b),
                "CSCL_COARSE": max(cscl_a, cscl_b),
            }
            for line in _merged_lines(shared.difference(tile_edge), 4 * tol):
                features.append({"geometry": mapping(line), "properties": props})
    return features


def _tile_bbox_polygon(z: int, x: int, y: int) -> BaseGeometry:
    """Get a Shapely polygon for a tile's bounding box."""
    return box(*_tile_to_bbox(z, x, y))


def _pixel_to_geo_coords(
    geom_dict: dict,
    bounds: tuple[float, float, float, float],
) -> dict:
    """Transform a GeoJSON-like geometry from MVT pixel coords to geographic.

    MVT pixel coords are 0..4096. We map them linearly to the tile's
    geographic bounds (west, south, east, north).
    """
    west, south, east, north = bounds
    x_scale = (east - west) / _MVT_EXTENTS
    y_scale = (north - south) / _MVT_EXTENTS

    def transform_coord(c: list | tuple) -> list:
        return [west + c[0] * x_scale, south + c[1] * y_scale]

    def transform_ring(ring: list) -> list:
        return [transform_coord(c) for c in ring]

    geom_type = geom_dict["type"]
    coords = geom_dict["coordinates"]

    if geom_type == "Point":
        new_coords = transform_coord(coords)
    elif geom_type == "MultiPoint":
        new_coords = [transform_coord(c) for c in coords]
    elif geom_type == "LineString":
        new_coords = transform_ring(coords)
    elif geom_type == "MultiLineString":
        new_coords = [transform_ring(r) for r in coords]
    elif geom_type == "Polygon":
        new_coords = [transform_ring(r) for r in coords]
    elif geom_type == "MultiPolygon":
        new_coords = [[transform_ring(r) for r in poly] for poly in coords]
    else:
        return geom_dict

    return {"type": geom_type, "coordinates": new_coords}


def _clip_mvt_features(
    tile_data: bytes,
    usable_region: BaseGeometry,
    tile_bbox: BaseGeometry,
    hazard_region: BaseGeometry | None = None,
    keep_layer: Callable[[str], bool] | None = None,
    owned_region: _OwnedRegion | None = None,
) -> tuple[dict[str, list[dict]] | None, dict[str, int]]:
    """Decode an MVT tile and clip features to a usable region.

    Args:
        tile_data: Raw (possibly gzipped) MVT tile bytes.
        usable_region: The region within the tile where this cell's
            features should be kept (in geographic coords).
        tile_bbox: The tile's bounding box polygon (in geographic coords).
        hazard_region: When set, layers in _HAZARD_LAYER_NAMES are clipped
            to this (exact, unbuffered) region instead of usable_region.
        keep_layer: When set, layers it rejects are skipped entirely.
        owned_region: When set, the part of the tile this cell's data is
            shown in. Polygons of EDGE_CLASSES layers then get their real
            edges split out into "<layer>_EDGES" and carry SPLIT_EDGES_FLAG.

    Returns:
        (layers, dropped): layers is a dict of layer_name → list of
        GeoJSON-like feature dicts (geographic coords), or None if no
        features survive clipping; dropped counts features discarded by
        topology errors per layer — for a nautical chart a silently
        vanished feature can be a hazard, so callers must surface these.
    """
    # Decompress if gzipped
    raw = tile_data
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)

    # Decode MVT → pixel coords (0..4096), then transform to geographic.
    # Default y_coord_down=False flips y to match geographic convention.
    bounds = tile_bbox.bounds  # (west, south, east, north)
    decoded = mapbox_vector_tile.decode(raw)

    result: dict[str, list[dict]] = {}
    dropped: dict[str, int] = {}
    has_features = False

    for layer_name, layer_data in decoded.items():
        if keep_layer is not None and not keep_layer(layer_name):
            continue
        clip_to = usable_region
        if hazard_region is not None and layer_name in _HAZARD_LAYER_NAMES:
            clip_to = hazard_region
            if clip_to.is_empty:
                continue
        split_edges = owned_region is not None and layer_name in EDGE_CLASSES
        clipped_features: list[dict] = []
        edge_features: list[dict] = []
        for feature in layer_data.get("features", []):
            geom_dict = feature.get("geometry")
            if geom_dict is None:
                continue

            try:
                # Transform pixel coords to geographic
                geo_geom = _pixel_to_geo_coords(geom_dict, bounds)
                geom = shape(geo_geom)
                if geom.is_empty:
                    continue

                # Clip to usable region
                clipped = geom.intersection(clip_to)
                if clipped.is_empty:
                    continue

                clipped = make_valid(clipped)
                if clipped.is_empty:
                    continue

                props = feature.get("properties", {})
                feat_id = feature.get("id")
                parts = (
                    list(clipped.geoms)
                    if isinstance(clipped, GeometryCollection)
                    else [clipped]
                )
                is_area = geom.geom_type in ("Polygon", "MultiPolygon")
                if is_area:
                    # Clipping an area along a cut can leave slivers of
                    # line or point lying on the cut; they are not part
                    # of the area and would draw as a line along it.
                    parts = [
                        p for p in parts
                        if p.geom_type in ("Polygon", "MultiPolygon")
                    ]
                if is_area and split_edges:
                    assert owned_region is not None
                    edge_features.extend(
                        {"geometry": mapping(line), "properties": props, "id": feat_id}
                        for line in _real_edges(geom, owned_region)
                    )
                    props = {**props, SPLIT_EDGES_FLAG: 1}
                clipped_features.extend(
                    {"geometry": mapping(part), "properties": props, "id": feat_id}
                    for part in parts
                    if not part.is_empty
                )
            except Exception:
                # Topology error — count it; silence here means a feature
                # (possibly a hazard) vanishes from the published tiles.
                dropped[layer_name] = dropped.get(layer_name, 0) + 1
                continue

        if clipped_features:
            result[layer_name] = clipped_features
            has_features = True
        if edge_features:
            result[layer_name + EDGE_LAYER_SUFFIX] = edge_features
            has_features = True

    return (result if has_features else None), dropped


def _encode_mvt(
    layers: dict[str, list[dict]],
    tile_bbox: BaseGeometry,
) -> bytes:
    """Encode feature layers back to MVT (gzipped) bytes.

    Args:
        layers: Dict of layer_name → list of GeoJSON-like feature dicts
            (in geographic coords).
        tile_bbox: The tile's bounding box for coordinate quantization.

    Returns:
        Gzipped MVT tile bytes.
    """
    west, south, east, north = tile_bbox.bounds
    layer_list = []

    for layer_name, features in layers.items():
        layer_list.append({
            "name": layer_name,
            "features": [
                {
                    "geometry": f["geometry"],
                    "properties": f["properties"],
                }
                for f in features
            ],
        })

    raw = mapbox_vector_tile.encode(
        layer_list,
        default_options={"quantize_bounds": (west, south, east, north)},
    )
    return gzip.compress(raw)


# ── Worker functions for multiprocessing ──────────────────────────────

# Serializable entry: (band, cell_name, tile_data, coverage_wkb, cscl)
_SerEntry = tuple[int, str, bytes, bytes, int | None]


# Dropped-feature accounting: (cell_name, layer_name) → count.
_DropCounts = dict[tuple[str, str], int]


def _merge_drops(total: _DropCounts, cell_name: str, dropped: dict[str, int]) -> None:
    for layer_name, n in dropped.items():
        key = (cell_name, layer_name)
        total[key] = total.get(key, 0) + n


def _composite_one_same_band(
    args: tuple[int, int, int, list[_SerEntry]],
) -> tuple[int, bytes | None, set[str], _DropCounts]:
    """Composite a same-band tile in a worker process.

    Returns (tile_id, tile_bytes_or_None, used_cells, dropped_counts).
    """
    z, x, y, entries = args
    tile_id = zxy_to_tileid(z, x, y)
    tile_bbox = _tile_bbox_polygon(z, x, y)
    merged_layers, used, drops = _merge_same_band(tile_bbox, _group_cells(entries))
    if merged_layers:
        return tile_id, _encode_mvt(merged_layers, tile_bbox), used, drops
    return tile_id, None, used, drops


def _merge_same_band(
    tile_bbox: BaseGeometry,
    cell_groups: dict[tuple[int, str], _CellGroup],
) -> tuple[dict[str, list[dict]], set[str], _DropCounts]:
    """Merge one same-band tile: every cell's features are kept whole (one
    band has no detail order to fill by), each cell owning its coverage for
    edge splitting. Scale boundaries follow the multi-band fill order over
    the cells, so overlapping same-band cells meet along one line.

    Returns (features by layer, used cells, dropped counts).
    """
    merged_layers: dict[str, list[dict]] = {}
    used: set[str] = set()
    drops: _DropCounts = {}
    owned_regions: list[tuple[int | None, BaseGeometry]] = []
    filled = shape({"type": "Polygon", "coordinates": []})  # empty

    for cell_key in sorted(cell_groups, reverse=True):
        group = cell_groups[cell_key]
        _band, cell_name = cell_key
        owned = _owned_region(
            make_valid(group.coverage.intersection(tile_bbox)), tile_bbox
        )
        cell_coverage = owned.area
        for data in group.tiles:
            features, dropped = _clip_mvt_features(
                data, tile_bbox, tile_bbox, owned_region=owned
            )
            _merge_drops(drops, cell_name, dropped)
            if features:
                used.add(cell_name)
                for ln, feats in features.items():
                    merged_layers.setdefault(ln, []).extend(feats)
        unfilled = _polygonal(make_valid(cell_coverage.difference(filled)))
        if not unfilled.is_empty:
            owned_regions.append((group.cscl, unfilled))
        filled = make_valid(filled.union(cell_coverage))

    boundaries = _scale_boundaries(tile_bbox, owned_regions)
    if boundaries:
        merged_layers[SCALE_BOUNDARY_LAYER] = boundaries
    return merged_layers, used, drops


def _composite_one_multi_band(
    args: tuple[int, int, int, list[_SerEntry]],
) -> tuple[int, bytes | None, set[str], bool, _DropCounts]:
    """Composite a multi-band tile in a worker process.

    Returns (tile_id, tile_bytes_or_None, used_cells, fully_filled, dropped).
    """
    z, x, y, entries = args
    tile_id = zxy_to_tileid(z, x, y)
    tile_bbox = _tile_bbox_polygon(z, x, y)
    output_features, used, fully_filled, drops = _fill_multi_band(
        z, tile_bbox, _group_cells(entries)
    )
    if output_features:
        return (
            tile_id,
            _encode_mvt(output_features, tile_bbox),
            used,
            fully_filled,
            drops,
        )
    return tile_id, None, used, fully_filled, drops


# ── Main composite function ──────────────────────────────────────────


def composite_tiles(
    sources: list[CellTileSource],
    output_path: Path,
    debug_latlon: tuple[float, float] | None = None,
    region_bbox: tuple[float, float, float, float] | None = None,
    jobs: int = 0,
    on_progress: Callable[[str, int, int], None] | None = None,
    on_warning: Callable[[str], None] | None = None,
) -> tuple[Path, set[str]] | None:
    """Composite tiles from multiple cells using M_COVR coverage clipping.

    For each tile (z,x,y):
    1. Collect all cells that produced a tile at this position
    2. Sort by band descending (highest/most-detailed first); at zooms in
       COMPOSITE_PREFERRED_BAND the COMPOSITE_PREFERRED_LAYERS instead
       fill from the preferred band first (see _fill_passes)
    3. Fill progressively: each band fills only what earlier ones left
    4. Clip each cell's features to its M_COVR ∩ unfilled area
    5. Stop when tile is 100% covered

    Single-source tiles (no overlap) are passed through without decode.

    Args:
        sources: List of CellTileSource objects with PMTiles paths,
            band numbers, and M_COVR coverage polygons.
        output_path: Path for the final merged output PMTiles.
        debug_latlon: If set, (lat, lon) to emit detailed compositing
            debug info for all tiles containing this point.
        region_bbox: If set, (west, south, east, north) to clip the
            coverage mask output to this bounding box.
        jobs: Number of parallel workers for compositing (0=auto).

    Returns:
        Tuple of (output path, set of cell names that contributed to output),
        or None on failure.
    """
    def _report(phase_name: str, done: int, total: int) -> None:
        if on_progress is not None:
            on_progress(phase_name, done, total)

    if not sources:
        print("No tile sources to composite")
        return None

    t_total = time.monotonic()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # NOTE: M_COVR coverages are NOT clipped to region_bbox.
    # Tile-center ownership (below) ensures each tile is produced by
    # exactly one region.  The compositing uses full M_COVR so it can
    # fill the entire tile — critical at low zoom where tiles span
    # well past the region boundary.

    # Pre-serialize coverages to WKB for multiprocessing
    coverage_wkb: dict[str, bytes] = {}
    for src in sources:
        key = src.cell_name
        if key not in coverage_wkb:
            coverage_wkb[key] = to_wkb(src.coverage)

    # Phase 1: Read tile sources
    t0 = time.monotonic()
    tile_entries: dict[
        tuple[int, int, int], list[_SerEntry]
    ] = {}

    metadata = None
    bounds_header = None
    tile_header = None

    _report("reading", 0, len(sources))
    for i, src in enumerate(sources):
        cov_wkb = coverage_wkb[src.cell_name]
        if src.pmtiles_path.stat().st_size == 0:
            continue  # skip empty PMTiles (no features for this layer)
        with open(src.pmtiles_path, "rb") as f:
            source = MmapSource(f)
            reader = Reader(source)

            if metadata is None:
                metadata = reader.metadata()
                tile_header = reader.header()
            if bounds_header is None:
                bounds_header = reader.header()
            else:
                h = reader.header()
                bounds_header = {
                    **bounds_header,
                    "min_lon_e7": min(
                        bounds_header.get("min_lon_e7", 180_000_000),
                        h.get("min_lon_e7", 180_000_000),
                    ),
                    "min_lat_e7": min(
                        bounds_header.get("min_lat_e7", 90_000_000),
                        h.get("min_lat_e7", 90_000_000),
                    ),
                    "max_lon_e7": max(
                        bounds_header.get("max_lon_e7", -180_000_000),
                        h.get("max_lon_e7", -180_000_000),
                    ),
                    "max_lat_e7": max(
                        bounds_header.get("max_lat_e7", -90_000_000),
                        h.get("max_lat_e7", -90_000_000),
                    ),
                }

            for (z, x, y), data in all_tiles(source):
                if region_bbox is not None:
                    tw, ts, te, tn = _tile_to_bbox(z, x, y)
                    rw, rs, re, rn = region_bbox
                    if z >= 8:
                        # Tile-center ownership at z8+: tiles are small
                        # enough (~1.4° x 0.4°) that center falls inside
                        # exactly one region.  Prevents double rendering
                        # of detailed features at region boundaries.
                        cx, cy = (tw + te) / 2, (ts + tn) / 2
                        if not (rw <= cx < re and rs <= cy < rn):
                            continue
                    else:
                        # At z0-z7, tiles span 2.8-360° — far larger than
                        # most regions.  Tile-center ownership fails here
                        # because centers land outside ALL region bboxes
                        # (e.g., z0 center is 0°,0°; z3 is -67.5°,20.5°).
                        # Use bbox-intersects so every overlapping region
                        # contributes.  At these zooms only overview cells
                        # (INTU 1-2) produce tiles, so duplicates across
                        # regions are identical and harmless.
                        if te < rw or tw > re or tn < rs or ts > rn:
                            continue
                tile_entries.setdefault((z, x, y), []).append(
                    (src.band, src.cell_name, data, cov_wkb, src.cscl)
                )
        _report("reading", i + 1, len(sources))

    total_tiles = len(tile_entries)
    t_read = time.monotonic() - t0
    _report("reading_done", total_tiles, len(sources))

    # Phase 2: Composite
    t0 = time.monotonic()
    single_source = 0
    same_band_count = 0
    composited_count = 0
    not_fully_filled = 0
    used_cells: set[str] = set()
    dropped_features: _DropCounts = {}

    # Build set of debug tiles
    debug_tiles: set[tuple[int, int, int]] = set()
    if debug_latlon is not None:
        lat, lon = debug_latlon
        print(f"\n  DEBUG: tracking tiles at ({lat:.6f}, {lon:.6f})")
        for z in range(15):
            dx, dy = _latlon_to_tile(lat, lon, z)
            debug_tiles.add((z, dx, dy))
            print(f"    z{z}: tile ({z},{dx},{dy})")

    _report("compositing", 0, total_tiles)

    output_tiles: dict[int, bytes] = {}

    # Partition tiles into three groups
    single_entries: list[tuple[tuple[int, int, int], list[_SerEntry]]] = []
    same_band_entries: list[tuple[int, int, int, list[_SerEntry]]] = []
    multi_band_entries: list[tuple[int, int, int, list[_SerEntry]]] = []

    for (z, x, y), entries in tile_entries.items():
        if len(entries) == 1:
            single_entries.append(((z, x, y), entries))
        else:
            bands_present = {e[0] for e in entries}
            if len(bands_present) == 1:
                same_band_entries.append((z, x, y, entries))
            else:
                multi_band_entries.append((z, x, y, entries))

    # Fast path: single-source tiles — no decode needed
    for (z, x, y), entries in single_entries:
        tile_id = zxy_to_tileid(z, x, y)
        output_tiles[tile_id] = entries[0][2]
        used_cells.add(entries[0][1])
        if (z, x, y) in debug_tiles:
            band, cell = entries[0][:2]
            print(f"\n  DEBUG z{z}/{x}/{y}: single-source pass-through"
                  f" (cell={cell}, band={band})")
    single_source = len(single_entries)
    tiles_composited_so_far = single_source
    _report("compositing", tiles_composited_so_far, total_tiles)
    t_single = time.monotonic() - t0

    # Determine worker count
    num_workers = jobs if jobs > 0 else max(1, (os.cpu_count() or 4) - 1)
    need_parallel = len(same_band_entries) + len(multi_band_entries)

    if need_parallel > 0 and num_workers > 1:
        t1 = time.monotonic()
        # Process same-band tiles in parallel
        if same_band_entries:
            with multiprocessing.Pool(num_workers) as pool:
                for tile_id, tile_bytes, used, drops in pool.imap_unordered(
                    _composite_one_same_band, same_band_entries, chunksize=64,
                ):
                    if tile_bytes is not None:
                        output_tiles[tile_id] = tile_bytes
                    used_cells.update(used)
                    for key, n in drops.items():
                        dropped_features[key] = dropped_features.get(key, 0) + n
                    tiles_composited_so_far += 1
                    _report("compositing", tiles_composited_so_far, total_tiles)
            same_band_count = len(same_band_entries)

        t_same = time.monotonic() - t1

        # Process multi-band tiles in parallel
        t2 = time.monotonic()
        if multi_band_entries:
            with multiprocessing.Pool(num_workers) as pool:
                for (
                    tile_id,
                    tile_bytes,
                    used,
                    fully_filled,
                    drops,
                ) in pool.imap_unordered(
                    _composite_one_multi_band, multi_band_entries, chunksize=32,
                ):
                    if tile_bytes is not None:
                        output_tiles[tile_id] = tile_bytes
                    used_cells.update(used)
                    for key, n in drops.items():
                        dropped_features[key] = dropped_features.get(key, 0) + n
                    if not fully_filled:
                        not_fully_filled += 1
                    tiles_composited_so_far += 1
                    _report("compositing", tiles_composited_so_far, total_tiles)
            composited_count = len(multi_band_entries)

        t_multi = time.monotonic() - t2
    else:
        # Single-threaded fallback (small tile count or 1 worker)
        for z, x, y, entries in same_band_entries:
            tile_id = zxy_to_tileid(z, x, y)
            tile_bbox = _tile_bbox_polygon(z, x, y)
            is_debug = (z, x, y) in debug_tiles

            if is_debug:
                cells = sorted({e[1] for e in entries})
                print(f"\n  DEBUG z{z}/{x}/{y}: same-band merge"
                      f" (band={entries[0][0]}, cells={cells})")

            merged_layers, used, drops = _merge_same_band(
                tile_bbox, _group_cells(entries)
            )
            used_cells.update(used)
            for key, n in drops.items():
                dropped_features[key] = dropped_features.get(key, 0) + n
            if merged_layers:
                output_tiles[tile_id] = _encode_mvt(merged_layers, tile_bbox)
            same_band_count += 1
            tiles_composited_so_far += 1
            _report("compositing", tiles_composited_so_far, total_tiles)

        for z, x, y, entries in multi_band_entries:
            tile_id = zxy_to_tileid(z, x, y)
            tile_bbox = _tile_bbox_polygon(z, x, y)
            is_debug = (z, x, y) in debug_tiles

            if is_debug:
                cells_by_band: dict[int, list[str]] = {}
                for b, c, *_rest in entries:
                    cells_by_band.setdefault(b, []).append(c)
                print(f"\n  DEBUG z{z}/{x}/{y}: multi-band composite")
                for b in sorted(cells_by_band, reverse=True):
                    print(f"    band {b}: cells={sorted(set(cells_by_band[b]))}")

            output_features, used, fully_filled, drops = _fill_multi_band(
                z, tile_bbox, _group_cells(entries)
            )
            used_cells.update(used)
            for key, n in drops.items():
                dropped_features[key] = dropped_features.get(key, 0) + n
            if not fully_filled:
                not_fully_filled += 1

            if output_features:
                output_tiles[tile_id] = _encode_mvt(output_features, tile_bbox)
            composited_count += 1
            tiles_composited_so_far += 1
            _report("compositing", tiles_composited_so_far, total_tiles)

    t_composite = time.monotonic() - t0
    _report("compositing_done", len(output_tiles), total_tiles)
    if not_fully_filled:
        _report("warning_not_filled", not_fully_filled, composited_count)
    if dropped_features:
        # A dropped feature is a feature missing from the published chart —
        # never let it pass without build-log evidence.
        total_dropped = sum(dropped_features.values())
        _report("warning_dropped_features", total_dropped, len(dropped_features))
        if on_warning is not None:
            worst = sorted(
                dropped_features.items(), key=lambda kv: kv[1], reverse=True
            )
            for (cell, layer), n in worst[:10]:
                on_warning(f"clip dropped {n} {layer} feature(s) from {cell}")
            if len(worst) > 10:
                on_warning(
                    f"...and {len(worst) - 10} more cell/layer pairs with drops"
                )

    # Phase 3: Write output PMTiles
    t0 = time.monotonic()
    _report("writing", 0, len(output_tiles))
    assert tile_header is not None
    assert bounds_header is not None

    with write(str(output_path)) as writer:
        for tile_id in sorted(output_tiles):
            writer.write_tile(tile_id, output_tiles[tile_id])

        out_header = {
            "tile_type": tile_header["tile_type"],
            "tile_compression": tile_header["tile_compression"],
            "min_zoom": 0,
            "max_zoom": 14,
            "min_lon_e7": bounds_header.get("min_lon_e7", -180_000_000),
            "min_lat_e7": bounds_header.get("min_lat_e7", -85_000_000),
            "max_lon_e7": bounds_header.get("max_lon_e7", 180_000_000),
            "max_lat_e7": bounds_header.get("max_lat_e7", 85_000_000),
            "center_zoom": 7,
            "center_lon_e7": (
                bounds_header.get("min_lon_e7", 0)
                + bounds_header.get("max_lon_e7", 0)
            )
            // 2,
            "center_lat_e7": (
                bounds_header.get("min_lat_e7", 0)
                + bounds_header.get("max_lat_e7", 0)
            )
            // 2,
        }
        writer.finalize(out_header, metadata or {})

    t_write = time.monotonic() - t0
    _report("writing_done", len(output_tiles), len(output_tiles))

    # Report cell usage
    all_cell_names = {src.cell_name for src in sources}
    unused_cells = sorted(all_cell_names - used_cells)

    t_total_elapsed = time.monotonic() - t_total
    _report("complete", len(output_tiles), len(output_tiles))

    # Phase 4: Export coverage mask as GeoJSON
    t0 = time.monotonic()
    coverage_polys = [src.coverage for src in sources]
    if coverage_polys:
        coverage_union = make_valid(union_all(coverage_polys))
        if region_bbox is not None:
            region_poly = box(*region_bbox)
            coverage_union = make_valid(coverage_union.intersection(region_poly))
        world = box(-180, -85.06, 180, 85.06)
        no_coverage = make_valid(world.difference(coverage_union))
        coverage_geojson = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {},
                    "geometry": mapping(no_coverage),
                }
            ],
        }
        coverage_path = output_path.with_suffix(".coverage.geojson")
        coverage_path.write_text(json.dumps(coverage_geojson))

    return output_path, used_cells
