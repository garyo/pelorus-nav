"""tile-join wrapper: merge per-layer PMTiles into a single file.

Supports priority merge across scale bands: for each tile (z,x,y),
only the highest-band version is kept. This prevents ghosting from
multiple scale bands rendering in the same tile. See MULTI_SCALE.md.
"""

from __future__ import annotations

import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path


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


def merge_tiles_priority(
    band_tiles: dict[int, list[Path]],
    output_path: Path,
) -> Path | None:
    """Merge per-band PMTiles with priority: highest band wins per tile.

    For each tile (z,x,y), only the highest-band version is kept.
    This prevents ghosting from multiple scale bands rendering in
    the same tile while preserving coverage (lower bands fill gaps).

    Args:
        band_tiles: Dict of band → list of PMTiles files for that band.
        output_path: Path for the final merged output.

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

        # Step 2: Priority merge — highest band wins per tile
        print(f"Step 2: Priority merge across {len(band_merged)} bands...")

        # Process from LOWEST band first; higher bands overwrite.
        tile_data: dict[int, bytes] = {}  # tile_id → compressed tile data
        total_tiles = 0

        for band in sorted(band_merged):
            band_path = band_merged[band]
            with open(band_path, "rb") as f:
                source = MmapSource(f)
                band_count = 0
                overwritten = 0
                for (z, x, y), data in all_tiles(source):
                    tile_id = zxy_to_tileid(z, x, y)
                    if tile_id in tile_data:
                        overwritten += 1
                    tile_data[tile_id] = data
                    band_count += 1
                total_tiles += band_count
                print(
                    f"  Band {band}: {band_count} tiles "
                    f"({overwritten} overwriting lower bands)"
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
