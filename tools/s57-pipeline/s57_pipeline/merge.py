"""tile-join wrapper: merge per-layer PMTiles into a single file."""

from __future__ import annotations

import subprocess
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
