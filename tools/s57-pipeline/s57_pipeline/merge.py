"""tile-join wrapper: merge per-layer PMTiles into a single file.

Supports priority merge across scale bands: for each tile (z,x,y),
only the highest-band version is kept IF its M_COVR coverage fully
contains the tile's geographic area. This prevents both ghosting
(multiple scale bands in the same tile) and gaps (overwriting a
lower-band tile when the higher band only partially covers it).
See MULTI_SCALE.md.
"""

from __future__ import annotations

import math
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from shapely.geometry import box
from shapely.geometry.base import BaseGeometry


def merge_tiles(
    pmtiles_files: list[Path],
    output_path: Path,
) -> Path | None:
    """Merge multiple PMTiles files into a single output using tile-join.

    Args:
        pmtiles_files: List of paths to per-layer PMTiles files.
        output_path: Path for the merged output PMTiles file.

    Returns:
        Path to the merged file, or None on failure.
    """
    if not pmtiles_files:
        print("No PMTiles files to merge")
        return None

    output_path.parent.mkdir(parents=True, exist_ok=True)

    cmd = [
        "tile-join",
        "-o",
        str(output_path),
        "--force",
        *[str(p) for p in pmtiles_files],
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        print(f"tile-join error: {result.stderr}")
        return None

    print(f"Merged {len(pmtiles_files)} layers → {output_path}")
    return output_path


def _tile_join(
    pmtiles_files: list[Path],
    output_path: Path,
) -> bool:
    """Run tile-join, return True on success."""
    cmd = [
        "tile-join",
        "-o",
        str(output_path),
        "--force",
        "--no-tile-size-limit",
        *[str(p) for p in pmtiles_files],
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"tile-join error: {result.stderr}")
        return False
    return True


def _join_band(
    band: int,
    files: list[Path],
    output_path: Path,
) -> tuple[int, Path | None]:
    """Join tiles for a single band. Returns (band, path) or (band, None)."""
    print(f"  Band {band}: joining {len(files)} tile sets...")
    if _tile_join(files, output_path):
        return band, output_path
    print(f"  Warning: band {band} tile-join failed")
    return band, None


def _tile_to_bbox(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    """Convert tile (z, x, y) to (west, south, east, north) bbox in degrees."""
    n = 2 ** z
    west = x / n * 360.0 - 180.0
    east = (x + 1) / n * 360.0 - 180.0
    north = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    south = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / n))))
    return (west, south, east, north)


def _coverage_contains_tile(
    coverage: BaseGeometry,
    z: int,
    x: int,
    y: int,
) -> bool:
    """Check if coverage polygon fully contains a tile's bounding box."""
    tile_poly = box(*_tile_to_bbox(z, x, y))
    return coverage.contains(tile_poly)


def merge_tiles_priority(
    band_tiles: dict[int, list[Path]],
    output_path: Path,
    coverage_index: dict[int, BaseGeometry] | None = None,
) -> Path | None:
    """Merge per-band PMTiles with priority: highest band wins per tile.

    For each tile (z,x,y), the highest-band version replaces the lower-band
    version only if that band's M_COVR coverage fully contains the tile's
    geographic area. This prevents both ghosting and L-shaped gaps.

    Without coverage_index, falls back to unconditional overwrite.

    Args:
        band_tiles: Dict of band → list of PMTiles files for that band.
        output_path: Path for the final merged output.
        coverage_index: Optional dict of {band: coverage_polygon} from
            M_COVR extraction. Used to check full coverage before overwriting.

    Returns:
        Path to the merged file, or None on failure.
    """
    from pmtiles.convert import all_tiles, write
    from pmtiles.reader import MmapSource, Reader, zxy_to_tileid

    if not band_tiles:
        print("No tiles to merge")
        return None

    output_path.parent.mkdir(parents=True, exist_ok=True)

    # Step 1: tile-join within each band (parallel)
    print("Step 1: Merging within each band (parallel)...")
    band_merged: dict[int, Path] = {}
    with tempfile.TemporaryDirectory(prefix="band_merge_") as tmpdir:
        tmpdir_path = Path(tmpdir)

        with ThreadPoolExecutor(max_workers=min(6, len(band_tiles))) as executor:
            futures = {
                executor.submit(
                    _join_band,
                    band,
                    files,
                    tmpdir_path / f"band_{band}.pmtiles",
                ): band
                for band, files in band_tiles.items()
                if files
            }
            for future in as_completed(futures):
                band, path = future.result()
                if path is not None:
                    band_merged[band] = path

        if not band_merged:
            print("No bands merged successfully")
            return None

        # Step 2: Priority merge — highest band wins if M_COVR fully covers tile
        mode = "M_COVR coverage check" if coverage_index else "unconditional overwrite"
        print(f"Step 2: Priority merge across {len(band_merged)} bands ({mode})...")

        tile_data: dict[int, bytes] = {}  # tile_id → compressed tile data
        total_tiles = 0

        for band in sorted(band_merged):
            band_path = band_merged[band]
            band_coverage = coverage_index.get(band) if coverage_index else None
            with open(band_path, "rb") as f:
                source = MmapSource(f)
                band_count = 0
                overwritten = 0
                boundary_kept = 0
                for (z, x, y), data in all_tiles(source):
                    tile_id = zxy_to_tileid(z, x, y)
                    if tile_id in tile_data:
                        # This higher band wants to overwrite a lower-band tile.
                        # Only overwrite if M_COVR fully covers this tile's area.
                        if band_coverage is not None and not _coverage_contains_tile(
                            band_coverage, z, x, y
                        ):
                            boundary_kept += 1
                            band_count += 1
                            continue
                        overwritten += 1
                    tile_data[tile_id] = data
                    band_count += 1
                total_tiles += band_count
                print(
                    f"  Band {band}: {band_count} tiles "
                    f"({overwritten} overwriting lower bands, "
                    f"{boundary_kept} boundary tiles kept from lower band)"
                )

        print(f"  Total unique tiles: {len(tile_data)} (from {total_tiles} input)")

        # Step 3: Write output
        print("Step 3: Writing output...")
        # Use lowest band for bounds (widest geographic coverage)
        # and highest band for metadata (most layer info).
        lowest_band = min(band_merged)
        highest_band = max(band_merged)
        with open(band_merged[lowest_band], "rb") as f:
            source = MmapSource(f)
            bounds_header = Reader(source).header()
        with open(band_merged[highest_band], "rb") as f:
            source = MmapSource(f)
            reader = Reader(source)
            metadata = reader.metadata()
            header = reader.header()

        with write(str(output_path)) as writer:
            for tile_id in sorted(tile_data):
                writer.write_tile(tile_id, tile_data[tile_id])

            out_header = {
                "tile_type": header["tile_type"],
                "tile_compression": header["tile_compression"],
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
                ) // 2,
                "center_lat_e7": (
                    bounds_header.get("min_lat_e7", 0)
                    + bounds_header.get("max_lat_e7", 0)
                ) // 2,
            }
            writer.finalize(out_header, metadata)

    print(f"Priority merge → {output_path} ({len(tile_data)} tiles)")
    return output_path
