"""ogr2ogr wrapper: S-57 → GeoJSON conversion."""

from __future__ import annotations

import os
import subprocess
from collections.abc import Callable
from pathlib import Path

from .enrich import enrich_geojson
from .layers import LAYER_NAMES


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


def _read_dsid_field(enc_path: Path, field_name: str) -> int | None:
    """Read an integer field from the DSID layer of an S-57 ENC file.

    Args:
        enc_path: Path to the .000 ENC file.
        field_name: DSID field name (e.g., "DSPM_CSCL", "DSID_INTU").

    Returns:
        The field value as an integer, or None if not found.
    """
    result = subprocess.run(
        ["ogrinfo", "-ro", "-al", str(enc_path), "DSID"],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return None

    for line in result.stdout.splitlines():
        if field_name in line and "=" in line:
            value = line.split("=")[-1].strip()
            try:
                return int(value)
            except ValueError:
                return None
    return None


def read_compilation_scale(enc_path: Path) -> int | None:
    """Read the compilation scale (DSPM_CSCL) from an S-57 ENC file."""
    return _read_dsid_field(enc_path, "DSPM_CSCL")


def read_intended_use(enc_path: Path) -> int | None:
    """Read the intended use (DSID_INTU) from an S-57 ENC file.

    Returns:
        The intended use as an integer (1-6), or None if not found.
    """
    return _read_dsid_field(enc_path, "DSID_INTU")


def read_dsid_metadata(enc_path: Path) -> tuple[int | None, int | None]:
    """Read both INTU and CSCL from an S-57 ENC file in a single ogrinfo call.

    Returns:
        (intu, cscl) tuple. Either may be None if not found.
    """
    result = subprocess.run(
        ["ogrinfo", "-ro", "-al", str(enc_path), "DSID"],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return None, None

    intu: int | None = None
    cscl: int | None = None
    for line in result.stdout.splitlines():
        if "=" not in line:
            continue
        if "DSID_INTU" in line:
            value = line.split("=")[-1].strip()
            try:
                intu = int(value)
            except ValueError:
                pass
        elif "DSPM_CSCL" in line:
            value = line.split("=")[-1].strip()
            try:
                cscl = int(value)
            except ValueError:
                pass
    return intu, cscl


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
    intu_zoom_ranges: dict[int, tuple[int, int, int]] | None = None,
    on_layer_done: Callable[[str], None] | None = None,
) -> list[Path]:
    """Convert all known layers from an S-57 ENC file to GeoJSON.

    Args:
        enc_path: Path to the .000 ENC file.
        output_dir: Directory to write GeoJSON files.
        apply_scamin: Whether to add tippecanoe minzoom from SCAMIN attributes.
        intu_zoom_ranges: Optional INTU-based zoom range mapping.
        on_layer_done: Optional callback invoked with the layer name after
            each layer is successfully converted.

    Returns:
        List of paths to successfully created GeoJSON files.
    """
    output_dir.mkdir(parents=True, exist_ok=True)

    # Read cell metadata for zoom mapping
    cell_cscl = read_compilation_scale(enc_path) if apply_scamin else None
    cell_intu = read_intended_use(enc_path) if apply_scamin else None

    # Find which of our target layers exist in this ENC
    available = set(list_enc_layers(enc_path))
    target_layers = [name for name in LAYER_NAMES if name in available]

    outputs: list[Path] = []
    for layer_name in target_layers:
        path = convert_layer(enc_path, layer_name, output_dir)
        if path is not None:
            enrich_geojson(
                path,
                cell_cscl=cell_cscl,
                cell_intu=cell_intu,
                intu_zoom_ranges=intu_zoom_ranges,
                apply_scamin=apply_scamin,
            )
            outputs.append(path)
            if on_layer_done is not None:
                on_layer_done(layer_name)

    return outputs
