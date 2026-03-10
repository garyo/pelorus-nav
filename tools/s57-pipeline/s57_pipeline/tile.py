"""tippecanoe wrapper: GeoJSON → PMTiles conversion."""

from __future__ import annotations

import subprocess
from collections.abc import Callable
from pathlib import Path

from .layers import LayerConfig, get_layer_config


def tile_layer(
    geojson_path: Path,
    output_path: Path,
    layer_name: str,
    config: LayerConfig | None = None,
    min_zoom: int = 0,
    max_zoom: int = 14,
) -> Path | None:
    """Convert a single GeoJSON file to PMTiles using tippecanoe.

    Args:
        geojson_path: Path to the input GeoJSON file.
        output_path: Path for the output PMTiles file.
        layer_name: S-57 layer name for tippecanoe's -l flag.
        config: Optional layer config with tippecanoe args. Auto-detected if None.
        min_zoom: Minimum zoom level for tile generation (tippecanoe -Z).
        max_zoom: Maximum zoom level for tile generation (tippecanoe -z).

    Returns:
        Path to output PMTiles, or None on failure.
    """
    if config is None:
        config = get_layer_config(layer_name)

    cmd = [
        "tippecanoe",
        "-o",
        str(output_path),
        "-l",
        layer_name,
        f"-Z{min_zoom}",
        f"-z{max_zoom}",
        "--force",
    ]

    if config is not None:
        cmd.extend(config.tippecanoe_args)

    cmd.append(str(geojson_path))

    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        print(f"  tippecanoe error for {layer_name}: {result.stderr}")
        return None

    return output_path


def tile_geojson_files(
    geojson_dir: Path,
    tiles_dir: Path,
    min_zoom: int = 0,
    max_zoom: int = 14,
    on_layer_done: Callable[[str], None] | None = None,
) -> list[Path]:
    """Convert all GeoJSON files in a directory to individual PMTiles.

    Args:
        geojson_dir: Directory containing .geojson files.
        tiles_dir: Directory for output .pmtiles files.
        min_zoom: Minimum zoom level for tile generation.
        max_zoom: Maximum zoom level for tile generation.
        on_layer_done: Optional callback invoked with the layer name after
            each layer is successfully tiled.

    Returns:
        List of paths to created PMTiles files.
    """
    tiles_dir.mkdir(parents=True, exist_ok=True)

    outputs: list[Path] = []
    for geojson_path in sorted(geojson_dir.glob("*.geojson")):
        layer_name = geojson_path.stem.upper()
        pmtiles_path = tiles_dir / f"{geojson_path.stem}.pmtiles"

        result = tile_layer(
            geojson_path, pmtiles_path, layer_name,
            min_zoom=min_zoom, max_zoom=max_zoom,
        )
        if result is not None:
            outputs.append(result)
            if on_layer_done is not None:
                on_layer_done(layer_name)

    return outputs
