"""MVT-level per-tile compositing for multi-scale ENC data.

For each tile (z,x,y) across all cells, composites features from
multiple ENC cells/bands using exact M_COVR coverage polygons.
Highest-band data fills first, then progressively lower bands fill
remaining gaps until the tile is 100% covered.

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
from shapely import make_valid, union_all
from shapely.geometry import box, mapping, shape
from shapely.geometry.base import BaseGeometry
from shapely.geometry.collection import GeometryCollection
from shapely.io import from_wkb, to_wkb

from pmtiles.convert import all_tiles, write
from pmtiles.reader import MmapSource, Reader, zxy_to_tileid

from .regions import _bbox_intersects
from .tilemath import latlon_to_tile as _latlon_to_tile
from .tilemath import tile_to_bbox as _tile_to_bbox

# MVT default extent (coordinate space 0..4096)
_MVT_EXTENTS = 4096


@dataclass
class CellTileSource:
    """A PMTiles source with its cell's metadata."""

    pmtiles_path: Path
    band: int
    coverage: BaseGeometry  # M_COVR polygon for this cell
    cell_name: str = ""  # ENC cell name for grouping layers from same cell


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
) -> dict[str, list[dict]] | None:
    """Decode an MVT tile and clip features to a usable region.

    Args:
        tile_data: Raw (possibly gzipped) MVT tile bytes.
        usable_region: The region within the tile where this cell's
            features should be kept (in geographic coords).
        tile_bbox: The tile's bounding box polygon (in geographic coords).

    Returns:
        Dict of layer_name → list of GeoJSON-like feature dicts
        (in geographic coords), or None if no features survive clipping.
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
    has_features = False

    for layer_name, layer_data in decoded.items():
        clipped_features: list[dict] = []
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
                clipped = geom.intersection(usable_region)
                if clipped.is_empty:
                    continue

                clipped = make_valid(clipped)
                if clipped.is_empty:
                    continue

                # Decompose GeometryCollections into individual geometries
                # (clipping can split a polygon into disjoint pieces)
                props = feature.get("properties", {})
                feat_id = feature.get("id")
                if isinstance(clipped, GeometryCollection):
                    for part in clipped.geoms:
                        if not part.is_empty:
                            clipped_features.append(
                                {
                                    "geometry": mapping(part),
                                    "properties": props,
                                    "id": feat_id,
                                }
                            )
                else:
                    clipped_features.append(
                        {
                            "geometry": mapping(clipped),
                            "properties": props,
                            "id": feat_id,
                        }
                    )
            except Exception:
                # Skip features with topology errors
                continue

        if clipped_features:
            result[layer_name] = clipped_features
            has_features = True

    return result if has_features else None


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

# Serializable entry: (band, cell_name, tile_data, coverage_wkb)
_SerEntry = tuple[int, str, bytes, bytes]


def _composite_one_same_band(
    args: tuple[int, int, int, list[_SerEntry]],
) -> tuple[int, bytes | None, set[str]]:
    """Composite a same-band tile in a worker process.

    Returns (tile_id, tile_bytes_or_None, used_cells).
    """
    z, x, y, entries = args
    tile_id = zxy_to_tileid(z, x, y)
    tile_bbox = _tile_bbox_polygon(z, x, y)
    merged_layers: dict[str, list[dict]] = {}
    used: set[str] = set()

    for _band, cell_name, data, _cov_wkb in entries:
        features = _clip_mvt_features(data, tile_bbox, tile_bbox)
        if features:
            used.add(cell_name)
            for ln, feats in features.items():
                merged_layers.setdefault(ln, []).extend(feats)

    if merged_layers:
        return tile_id, _encode_mvt(merged_layers, tile_bbox), used
    return tile_id, None, used


def _composite_one_multi_band(
    args: tuple[int, int, int, list[_SerEntry]],
) -> tuple[int, bytes | None, set[str], bool]:
    """Composite a multi-band tile in a worker process.

    Returns (tile_id, tile_bytes_or_None, used_cells, fully_filled).
    """
    z, x, y, entries = args
    tile_id = zxy_to_tileid(z, x, y)
    tile_bbox = _tile_bbox_polygon(z, x, y)
    used: set[str] = set()

    # Group entries by cell (band + cell_name share the same coverage)
    cell_groups: dict[
        tuple[int, str], list[tuple[bytes, BaseGeometry]]
    ] = {}
    for band_val, cell_name, data, cov_wkb in entries:
        coverage = from_wkb(cov_wkb)
        cell_groups.setdefault((band_val, cell_name), []).append(
            (data, coverage)
        )

    # Sort cells by band descending (highest first)
    sorted_cells = sorted(cell_groups.keys(), key=lambda k: k[0], reverse=True)

    filled = shape({"type": "Polygon", "coordinates": []})  # empty
    output_features: dict[str, list[dict]] = {}

    for cell_key in sorted_cells:
        cell_entries = cell_groups[cell_key]
        coverage = cell_entries[0][1]
        _band_val, cell_name = cell_key

        cell_coverage = coverage.intersection(tile_bbox)
        if cell_coverage.is_empty:
            continue

        unfilled = tile_bbox.difference(filled)
        if unfilled.is_empty:
            break

        usable = cell_coverage.intersection(unfilled)
        if usable.is_empty:
            continue

        usable = make_valid(usable)
        if usable.is_empty:
            continue

        # Expand clipping region slightly (~1km) so features extend past
        # the M_COVR boundary.  Tippecanoe simplification can pull polygon
        # vertices away from the boundary at low zoom, leaving thin gaps
        # between adjacent cells.  The extra overlap is harmless (same
        # depth polygons from both cells stack) and prevents white slivers.
        clip_region = make_valid(usable.buffer(0.01))
        clip_region = clip_region.intersection(tile_bbox)

        for data, _cov in cell_entries:
            features = _clip_mvt_features(data, clip_region, tile_bbox)
            if features:
                used.add(cell_name)
                for ln, feats in features.items():
                    output_features.setdefault(ln, []).extend(feats)

        # Track filled area with the *original* (unbuffered) coverage so
        # adjacent cells can still fill the gap from their side.
        filled = make_valid(filled.union(cell_coverage))
        if filled.contains(tile_bbox):
            break

    fully_filled = filled.contains(tile_bbox)
    if output_features:
        return tile_id, _encode_mvt(output_features, tile_bbox), used, fully_filled
    return tile_id, None, used, fully_filled


# ── Main composite function ──────────────────────────────────────────


def composite_tiles(
    sources: list[CellTileSource],
    output_path: Path,
    debug_latlon: tuple[float, float] | None = None,
    region_bbox: tuple[float, float, float, float] | None = None,
    jobs: int = 0,
    on_progress: Callable[[str, int, int], None] | None = None,
) -> tuple[Path, set[str]] | None:
    """Composite tiles from multiple cells using M_COVR coverage clipping.

    For each tile (z,x,y):
    1. Collect all cells that produced a tile at this position
    2. Sort by band descending (highest/most-detailed first)
    3. Fill progressively: highest band first, then lower bands fill gaps
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

    # Clip source coverages to region bbox so tiles outside the region
    # are naturally excluded by the M_COVR compositing logic.
    if region_bbox is not None:
        region_poly = box(*region_bbox)
        for src in sources:
            src.coverage = make_valid(src.coverage.intersection(region_poly))

    # Pre-serialize coverages to WKB for multiprocessing
    coverage_wkb: dict[str, bytes] = {}
    for src in sources:
        key = src.cell_name
        if key not in coverage_wkb:
            coverage_wkb[key] = to_wkb(src.coverage)

    # Phase 1: Read tile sources
    t0 = time.monotonic()
    tile_entries: dict[
        tuple[int, int, int], list[tuple[int, str, bytes, bytes]]
    ] = {}  # values: (band, cell_name, data, coverage_wkb)

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
                    if not _bbox_intersects(
                        _tile_to_bbox(z, x, y), region_bbox
                    ):
                        continue
                tile_entries.setdefault((z, x, y), []).append(
                    (src.band, src.cell_name, data, cov_wkb)
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
    single_entries: list[tuple[tuple[int, int, int], list[tuple[int, str, bytes, bytes]]]] = []
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
            band, cell, _data, _cov = entries[0]
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
                for tile_id, tile_bytes, used in pool.imap_unordered(
                    _composite_one_same_band, same_band_entries, chunksize=64,
                ):
                    if tile_bytes is not None:
                        output_tiles[tile_id] = tile_bytes
                    used_cells.update(used)
                    tiles_composited_so_far += 1
                    _report("compositing", tiles_composited_so_far, total_tiles)
            same_band_count = len(same_band_entries)

        t_same = time.monotonic() - t1

        # Process multi-band tiles in parallel
        t2 = time.monotonic()
        if multi_band_entries:
            with multiprocessing.Pool(num_workers) as pool:
                for tile_id, tile_bytes, used, fully_filled in pool.imap_unordered(
                    _composite_one_multi_band, multi_band_entries, chunksize=32,
                ):
                    if tile_bytes is not None:
                        output_tiles[tile_id] = tile_bytes
                    used_cells.update(used)
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
            merged_layers: dict[str, list[dict]] = {}
            is_debug = (z, x, y) in debug_tiles

            if is_debug:
                cells = sorted({e[1] for e in entries})
                print(f"\n  DEBUG z{z}/{x}/{y}: same-band merge"
                      f" (band={entries[0][0]}, cells={cells})")

            for _band, cell_name_entry, data, _cov_wkb in entries:
                features = _clip_mvt_features(data, tile_bbox, tile_bbox)
                if features:
                    used_cells.add(cell_name_entry)
                    for ln, feats in features.items():
                        merged_layers.setdefault(ln, []).extend(feats)
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
                for b, c, _d, _cv in entries:
                    cells_by_band.setdefault(b, []).append(c)
                print(f"\n  DEBUG z{z}/{x}/{y}: multi-band composite")
                for b in sorted(cells_by_band, reverse=True):
                    print(f"    band {b}: cells={sorted(set(cells_by_band[b]))}")

            cell_groups: dict[
                tuple[int, str], list[tuple[bytes, BaseGeometry]]
            ] = {}
            for band_val, cell_name, data, cov_wkb_entry in entries:
                coverage = from_wkb(cov_wkb_entry)
                cell_groups.setdefault((band_val, cell_name), []).append(
                    (data, coverage)
                )

            sorted_cells = sorted(cell_groups.keys(), key=lambda k: k[0], reverse=True)
            filled = shape({"type": "Polygon", "coordinates": []})
            output_features: dict[str, list[dict]] = {}

            for cell_key in sorted_cells:
                cell_entries_inner = cell_groups[cell_key]
                coverage = cell_entries_inner[0][1]
                band_val, cell_name = cell_key

                cell_coverage = coverage.intersection(tile_bbox)
                if cell_coverage.is_empty:
                    continue

                unfilled = tile_bbox.difference(filled)
                if unfilled.is_empty:
                    break

                usable = cell_coverage.intersection(unfilled)
                if usable.is_empty:
                    continue

                usable = make_valid(usable)
                if usable.is_empty:
                    continue

                # Expand clipping region slightly (~1km) to cover
                # tippecanoe simplification gaps at cell boundaries.
                clip_region = make_valid(usable.buffer(0.01))
                clip_region = clip_region.intersection(tile_bbox)

                for data, _cov in cell_entries_inner:
                    features = _clip_mvt_features(data, clip_region, tile_bbox)
                    if features:
                        used_cells.add(cell_name)
                        for ln, feats in features.items():
                            output_features.setdefault(ln, []).extend(feats)

                # Track filled with original coverage (not buffered)
                filled = make_valid(filled.union(cell_coverage))
                if filled.contains(tile_bbox):
                    break

            if not filled.contains(tile_bbox):
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
