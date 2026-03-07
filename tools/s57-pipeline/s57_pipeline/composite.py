"""MVT-level per-tile compositing for multi-scale ENC data.

For each tile (z,x,y) across all cells, composites features from
multiple ENC cells/bands using exact M_COVR coverage polygons.
Highest-band data fills first, then progressively lower bands fill
remaining gaps until the tile is 100% covered.

Replaces the old tile-join + priority-merge steps.
"""

from __future__ import annotations

import gzip
import math
from dataclasses import dataclass
from pathlib import Path

import mapbox_vector_tile
from shapely import make_valid
from shapely.geometry import box, mapping, shape
from shapely.geometry.base import BaseGeometry
from shapely.geometry.collection import GeometryCollection

from pmtiles.convert import all_tiles, write
from pmtiles.reader import MmapSource, Reader, zxy_to_tileid

# MVT default extent (coordinate space 0..4096)
_MVT_EXTENTS = 4096


@dataclass
class CellTileSource:
    """A PMTiles source with its cell's metadata."""

    pmtiles_path: Path
    band: int
    coverage: BaseGeometry  # M_COVR polygon for this cell
    cell_name: str = ""  # ENC cell name for grouping layers from same cell


def _latlon_to_tile(lat: float, lon: float, z: int) -> tuple[int, int]:
    """Convert (lat, lon) to tile (x, y) at zoom level z."""
    n = 2**z
    x = int((lon + 180.0) / 360.0 * n)
    y = int(
        (1.0 - math.log(math.tan(math.radians(lat)) + 1.0 / math.cos(math.radians(lat))) / math.pi)
        / 2.0
        * n
    )
    x = max(0, min(n - 1, x))
    y = max(0, min(n - 1, y))
    return x, y


def _tile_to_bbox(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    """Convert tile (z, x, y) to (west, south, east, north) bbox in degrees."""
    n = 2**z
    west = x / n * 360.0 - 180.0
    east = (x + 1) / n * 360.0 - 180.0
    north = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    south = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / n))))
    return (west, south, east, north)


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


def composite_tiles(
    sources: list[CellTileSource],
    output_path: Path,
    debug_latlon: tuple[float, float] | None = None,
) -> Path | None:
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

    Returns:
        Path to the output file, or None on failure.
    """
    if not sources:
        print("No tile sources to composite")
        return None

    output_path.parent.mkdir(parents=True, exist_ok=True)

    # Collect all tiles: (z,x,y) → list of (band, cell_name, data, coverage)
    tile_entries: dict[
        tuple[int, int, int], list[tuple[int, str, bytes, BaseGeometry]]
    ] = {}

    metadata = None
    bounds_header = None
    tile_header = None

    print("Reading tile sources...")
    for src in sources:
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
                tile_entries.setdefault((z, x, y), []).append(
                    (src.band, src.cell_name, data, src.coverage)
                )

    total_tiles = len(tile_entries)
    single_source = 0
    same_band = 0
    composited = 0
    not_fully_filled = 0

    # Build set of debug tiles (tiles containing the debug point at each zoom)
    debug_tiles: set[tuple[int, int, int]] = set()
    if debug_latlon is not None:
        lat, lon = debug_latlon
        print(f"\n  DEBUG: tracking tiles at ({lat:.6f}, {lon:.6f})")
        for z in range(15):
            dx, dy = _latlon_to_tile(lat, lon, z)
            debug_tiles.add((z, dx, dy))
            print(f"    z{z}: tile ({z},{dx},{dy})")

    print(f"Compositing {total_tiles} unique tile positions...")

    output_tiles: dict[int, bytes] = {}  # tile_id → bytes

    for (z, x, y), entries in tile_entries.items():
        tile_id = zxy_to_tileid(z, x, y)
        is_debug = (z, x, y) in debug_tiles

        # Fast path: single entry → pass through without decode
        if len(entries) == 1:
            single_source += 1
            output_tiles[tile_id] = entries[0][2]
            if is_debug:
                band, cell, _data, _cov = entries[0]
                print(f"\n  DEBUG z{z}/{x}/{y}: single-source pass-through"
                      f" (cell={cell}, band={band})")
            continue

        # Check if all entries are from the same band
        bands_present = {e[0] for e in entries}
        if len(bands_present) == 1:
            # Same band, multiple cells — concatenate features
            tile_bbox = _tile_bbox_polygon(z, x, y)
            merged_layers: dict[str, list[dict]] = {}
            if is_debug:
                cells = sorted({e[1] for e in entries})
                print(f"\n  DEBUG z{z}/{x}/{y}: same-band merge"
                      f" (band={next(iter(bands_present))}, cells={cells})")
            for _band, _cell, data, _coverage in entries:
                features = _clip_mvt_features(data, tile_bbox, tile_bbox)
                if features:
                    for ln, feats in features.items():
                        merged_layers.setdefault(ln, []).extend(feats)
            if merged_layers:
                output_tiles[tile_id] = _encode_mvt(merged_layers, tile_bbox)
                if is_debug:
                    layer_counts = {ln: len(fs) for ln, fs in merged_layers.items()}
                    print(f"    output layers: {layer_counts}")
            same_band += 1
            continue

        # Multi-band tile — full compositing
        composited += 1
        tile_bbox = _tile_bbox_polygon(z, x, y)

        if is_debug:
            cells_by_band: dict[int, list[str]] = {}
            for b, c, _d, _cv in entries:
                cells_by_band.setdefault(b, []).append(c)
            print(f"\n  DEBUG z{z}/{x}/{y}: multi-band composite")
            for b in sorted(cells_by_band, reverse=True):
                print(f"    band {b}: cells={sorted(set(cells_by_band[b]))}")

        # Group entries by cell (band + cell_name share the same coverage).
        # Each cell may have multiple layer tiles that all need the same
        # usable region — we must not update 'filled' between layers of
        # the same cell.
        cell_groups: dict[
            tuple[int, str], list[tuple[bytes, BaseGeometry]]
        ] = {}  # (band, cell_name) → [(data, coverage)]
        for band_val, cell_name, data, coverage in entries:
            cell_groups.setdefault((band_val, cell_name), []).append(
                (data, coverage)
            )

        # Sort cells by band descending (highest first)
        sorted_cells = sorted(cell_groups.keys(), key=lambda k: k[0], reverse=True)

        filled = shape({"type": "Polygon", "coordinates": []})  # empty
        output_features: dict[str, list[dict]] = {}

        for cell_key in sorted_cells:
            cell_entries = cell_groups[cell_key]
            coverage = cell_entries[0][1]  # all entries share same coverage
            band_val, cell_name = cell_key

            # cell_coverage = M_COVR ∩ tile_bbox
            cell_coverage = coverage.intersection(tile_bbox)
            if cell_coverage.is_empty:
                if is_debug:
                    print(f"    {cell_name} (band {band_val}): "
                          f"coverage ∩ tile = empty, skipped")
                continue

            # unfilled = tile_bbox - filled
            unfilled = tile_bbox.difference(filled)
            if unfilled.is_empty:
                if is_debug:
                    print(f"    {cell_name} (band {band_val}): "
                          f"tile fully filled, stopping")
                break  # 100% covered

            # usable = cell_coverage ∩ unfilled
            usable = cell_coverage.intersection(unfilled)
            if usable.is_empty:
                if is_debug:
                    print(f"    {cell_name} (band {band_val}): "
                          f"coverage ∩ unfilled = empty, skipped")
                continue

            usable = make_valid(usable)
            if usable.is_empty:
                continue

            if is_debug:
                fill_pct = usable.area / tile_bbox.area * 100
                print(f"    {cell_name} (band {band_val}): "
                      f"usable={fill_pct:.1f}% of tile, "
                      f"{len(cell_entries)} layer tile(s)")

            # Clip ALL layer tiles from this cell to the same usable region
            for data, _cov in cell_entries:
                features = _clip_mvt_features(data, usable, tile_bbox)
                if features:
                    for ln, feats in features.items():
                        output_features.setdefault(ln, []).extend(feats)

            # Update filled region once per cell
            filled = make_valid(filled.union(cell_coverage))

            # Check if fully covered
            if filled.contains(tile_bbox):
                if is_debug:
                    print(f"    tile fully filled after {cell_name}")
                break

        # Warn if multi-band tile is not fully filled
        if not filled.contains(tile_bbox):
            not_fully_filled += 1
            fill_pct = filled.area / tile_bbox.area * 100 if tile_bbox.area > 0 else 0
            if is_debug:
                print(f"    WARNING: tile NOT fully filled "
                      f"({fill_pct:.1f}% covered)")

        if output_features:
            output_tiles[tile_id] = _encode_mvt(output_features, tile_bbox)
            if is_debug:
                layer_counts = {ln: len(fs) for ln, fs in output_features.items()}
                print(f"    output layers: {layer_counts}")

    print(
        f"  {single_source} pass-through, {same_band} same-band merged, "
        f"{composited} multi-band composited"
    )
    if not_fully_filled:
        print(f"  WARNING: {not_fully_filled} multi-band tiles not fully filled")
    print(f"  {len(output_tiles)} output tiles")

    # Write output PMTiles
    print("Writing output...")
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

    print(f"Composited → {output_path} ({len(output_tiles)} tiles)")
    return output_path
