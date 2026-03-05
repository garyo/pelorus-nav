"""ogr2ogr wrapper: S-57 → GeoJSON conversion."""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

from .labels import add_labels_to_geojson
from .layers import LAYER_NAMES
from .scamin import add_minzoom_to_geojson
from .symbols import add_symbols_to_geojson


def list_enc_layers(enc_path: Path) -> list[str]:
    """List all layers in an S-57 ENC file using ogrinfo.

    Args:
        enc_path: Path to the .000 ENC file.

    Returns:
        List of layer names found in the file.
    """
    result = subprocess.run(
        ["ogrinfo", "-ro", "-so", str(enc_path)],
        capture_output=True,
        text=True,
        check=True,
    )
    layers: list[str] = []
    for line in result.stdout.splitlines():
        # ogrinfo output format: "1: LAYERNAME (geometry type)"
        parts = line.strip().split(":")
        if len(parts) >= 2:
            layer_name = parts[1].strip().split()[0] if parts[1].strip() else ""
            if layer_name:
                layers.append(layer_name)
    return layers


def read_compilation_scale(enc_path: Path) -> int | None:
    """Read the compilation scale (DSPM_CSCL) from an S-57 ENC file.

    Args:
        enc_path: Path to the .000 ENC file.

    Returns:
        The compilation scale as an integer, or None if not found.
    """
    result = subprocess.run(
        ["ogrinfo", "-ro", "-al", str(enc_path), "DSID"],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return None

    for line in result.stdout.splitlines():
        if "DSPM_CSCL" in line and "=" in line:
            # Format: "  DSPM_CSCL (Integer) = 675000"
            value = line.split("=")[-1].strip()
            try:
                return int(value)
            except ValueError:
                return None
    return None


def convert_layer(
    enc_path: Path,
    layer_name: str,
    output_dir: Path,
) -> Path | None:
    """Convert a single S-57 layer to GeoJSON using ogr2ogr.

    Args:
        enc_path: Path to the .000 ENC file.
        layer_name: S-57 layer name (e.g., "DEPARE", "SOUNDG").
        output_dir: Directory to write GeoJSON output.

    Returns:
        Path to the output GeoJSON file, or None if the layer doesn't exist.
    """
    output_path = output_dir / f"{layer_name.lower()}.geojson"

    env = os.environ.copy()
    env["OGR_S57_OPTIONS"] = "SPLIT_MULTIPOINT=ON,ADD_SOUNDG_DEPTH=ON"

    cmd = [
        "ogr2ogr",
        "-f",
        "GeoJSON",
        str(output_path),
        str(enc_path),
        layer_name,
        "-lco",
        "RFC7946=YES",
        "-skipfailures",
    ]

    result = subprocess.run(cmd, capture_output=True, text=True, env=env)

    if result.returncode != 0 or not output_path.exists():
        return None

    # Check if file has features (ogr2ogr creates empty files for missing layers)
    if output_path.stat().st_size < 100:
        output_path.unlink(missing_ok=True)
        return None

    return output_path


def convert_enc(
    enc_path: Path,
    output_dir: Path,
    apply_scamin: bool = True,
) -> list[Path]:
    """Convert all known layers from an S-57 ENC file to GeoJSON.

    Args:
        enc_path: Path to the .000 ENC file.
        output_dir: Directory to write GeoJSON files.
        apply_scamin: Whether to add tippecanoe minzoom from SCAMIN attributes.

    Returns:
        List of paths to successfully created GeoJSON files.
    """
    output_dir.mkdir(parents=True, exist_ok=True)

    # Read compilation scale for SCAMIN fallback
    cell_cscl = read_compilation_scale(enc_path) if apply_scamin else None
    if cell_cscl is not None:
        print(f"  Compilation scale (CSCL): 1:{cell_cscl:,}")

    # Find which of our target layers exist in this ENC
    available = set(list_enc_layers(enc_path))
    target_layers = [name for name in LAYER_NAMES if name in available]

    outputs: list[Path] = []
    for layer_name in target_layers:
        path = convert_layer(enc_path, layer_name, output_dir)
        if path is not None:
            if apply_scamin:
                add_minzoom_to_geojson(path, cell_cscl=cell_cscl)
            add_labels_to_geojson(path)
            add_symbols_to_geojson(path)
            outputs.append(path)
            print(f"  Converted {layer_name} → {path.name}")

    return outputs
