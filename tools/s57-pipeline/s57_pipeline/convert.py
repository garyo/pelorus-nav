"""ogr2ogr wrapper: S-57 → GeoJSON conversion."""

from __future__ import annotations

import json
import os
import subprocess
from collections.abc import Callable
from pathlib import Path
from typing import NamedTuple

from .enrich import (
    annotate_enclosing_depth,
    annotate_parents,
    correlate_topmarks,
    enrich_geojson,
)
from .inland import STANDARD_LAYER, s57_tables_dir, standardize_attributes
from .land_labels import annotate_land_label_anchors
from .layers import LAYER_NAMES


def _ogr_env() -> dict[str, str]:
    """Environment for GDAL's S-57 driver, with the Inland ENC tables."""
    env = os.environ.copy()
    env["OGR_S57_OPTIONS"] = "SPLIT_MULTIPOINT=ON,ADD_SOUNDG_DEPTH=ON"
    env["S57_CSV"] = str(s57_tables_dir())
    return env


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
        env=_ogr_env(),
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


class DsidMetadata(NamedTuple):
    intu: int | None  # DSID_INTU, intended usage (1-6)
    cscl: int | None  # DSPM_CSCL, compilation scale
    # DSID_EDTN with updates applied; a cancellation update sets it to 0
    edition: int | None


def _read_dsid(enc_path: Path) -> dict[str, str]:
    """Read the DSID record's fields ({name: value}) with updates applied.

    Returns {} if ogrinfo fails.
    """
    result = subprocess.run(
        ["ogrinfo", "-ro", "-al", str(enc_path), "DSID"],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return {}
    # Field lines read "  DSID_INTU (Integer) = 5"
    fields: dict[str, str] = {}
    for line in result.stdout.splitlines():
        head, sep, value = line.partition(" = ")
        words = head.split()
        if sep and words:
            fields[words[0]] = value.strip()
    return fields


def _int_field(fields: dict[str, str], name: str) -> int | None:
    try:
        return int(fields[name])
    except (KeyError, ValueError):
        return None


def read_compilation_scale(enc_path: Path) -> int | None:
    """Read the compilation scale (DSPM_CSCL) from an S-57 ENC file."""
    return _int_field(_read_dsid(enc_path), "DSPM_CSCL")


# Largest compilation scale (denominator) of each S-57 intended use, berthing
# to general; anything coarser is overview (1).
_INTU_MAX_SCALE = ((4_000, 6), (22_000, 5), (90_000, 4), (350_000, 3), (1_500_000, 2))


def intended_use(intu: int | None, cscl: int | None) -> int | None:
    """DSID_INTU as S-57's 1-6. Inland ENCs record other values (7), so
    those are placed by compilation scale instead."""
    if intu is None or 1 <= intu <= 6 or cscl is None:
        return intu
    return next((band for max_scale, band in _INTU_MAX_SCALE if cscl <= max_scale), 1)


def read_intended_use(enc_path: Path) -> int | None:
    """Read the intended use (DSID_INTU, 1-6) from an S-57 ENC file."""
    fields = _read_dsid(enc_path)
    return intended_use(
        _int_field(fields, "DSID_INTU"), _int_field(fields, "DSPM_CSCL")
    )


def read_dsid_metadata(enc_path: Path) -> DsidMetadata:
    """Read INTU, CSCL and edition from an S-57 ENC file in one ogrinfo call."""
    fields = _read_dsid(enc_path)
    return DsidMetadata(
        intu=intended_use(
            _int_field(fields, "DSID_INTU"), _int_field(fields, "DSPM_CSCL")
        ),
        cscl=_int_field(fields, "DSPM_CSCL"),
        edition=_int_field(fields, "DSID_EDTN"),
    )


def convert_layer(
    enc_path: Path,
    layer_name: str,
    output_dir: Path,
    output_name: str | None = None,
) -> tuple[Path | None, str | None]:
    """Convert a single S-57 layer to GeoJSON using ogr2ogr.

    Args:
        enc_path: Path to the .000 ENC file.
        layer_name: S-57 layer name (e.g., "DEPARE", "SOUNDG").
        output_dir: Directory to write GeoJSON output.
        output_name: File stem to write, when not the layer name lowercased.

    Returns:
        (path, failure_reason): the output GeoJSON path (None when the layer
        produced no usable output), and — when the absence is an ERROR rather
        than a legitimately empty layer — a short human-readable reason.
        A dropped layer on a nautical chart can be a missing hazard, so
        callers must surface non-None reasons.
    """
    output_path = output_dir / f"{output_name or layer_name.lower()}.geojson"

    env = _ogr_env()

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

    if result.returncode != 0:
        # Clean up partial output on failure
        output_path.unlink(missing_ok=True)
        stderr_tail = (result.stderr or "").strip().splitlines()
        detail = stderr_tail[-1] if stderr_tail else "no stderr"
        return None, f"ogr2ogr exit {result.returncode}: {detail}"

    if not output_path.exists():
        # Layer was listed as present but ogr2ogr wrote nothing — suspicious.
        return None, "ogr2ogr exit 0 but produced no output file"

    # Check if file has features (ogr2ogr creates empty files for missing layers)
    if output_path.stat().st_size < 100:
        output_path.unlink(missing_ok=True)
        return None, None  # legitimately empty layer

    # Validate JSON is parseable (catches truncated writes from disk-full, etc.)
    try:
        with open(output_path) as f:
            data = json.load(f)
        if not data.get("features"):
            output_path.unlink(missing_ok=True)
            return None, None  # legitimately empty layer
    except (json.JSONDecodeError, OSError) as e:
        output_path.unlink(missing_ok=True)
        return None, f"unparseable GeoJSON output ({type(e).__name__})"

    return output_path, None


def fold_inland(inland_path: Path, standard_path: Path) -> Path:
    """Append an Inland ENC layer's features, with their attributes copied
    onto standard names, to the standard layer's GeoJSON (created if the
    cell had none). Removes the inland file; returns the standard one."""
    with open(inland_path) as f:
        inland = json.load(f)
    for feature in inland["features"]:
        standardize_attributes(feature.setdefault("properties", {}))
    if standard_path.exists():
        with open(standard_path) as f:
            merged = json.load(f)
        merged["features"].extend(inland["features"])
    else:
        merged = inland
    with open(standard_path, "w") as f:
        json.dump(merged, f)
    inland_path.unlink()
    return standard_path


def convert_enc(
    enc_path: Path,
    output_dir: Path,
    apply_scamin: bool = True,
    intu_zoom_ranges: dict[int, tuple[int, int, int]] | None = None,
    on_layer_done: Callable[[str], None] | None = None,
    on_layer_failed: Callable[[str, str], None] | None = None,
) -> list[Path]:
    """Convert all known layers from an S-57 ENC file to GeoJSON.

    Args:
        enc_path: Path to the .000 ENC file.
        output_dir: Directory to write GeoJSON files.
        apply_scamin: Whether to add tippecanoe minzoom from SCAMIN attributes.
        intu_zoom_ranges: Optional INTU-based zoom range mapping.
        on_layer_done: Optional callback invoked with the layer name after
            each layer is successfully converted.
        on_layer_failed: Optional callback invoked with (layer_name, reason)
            when a layer is dropped by an error (not when legitimately
            empty) — the caller decides how loudly to surface it.

    Returns:
        List of paths to successfully created GeoJSON files.
    """
    output_dir.mkdir(parents=True, exist_ok=True)

    # Read cell metadata for zoom mapping
    cell_cscl = read_compilation_scale(enc_path) if apply_scamin else None
    cell_intu = read_intended_use(enc_path) if apply_scamin else None
    # Deterministic cell identifier from filename (e.g. "US5MA22M" → int).
    # Uses zlib.crc32 instead of hash() which is randomized per process.
    import zlib

    cell_id = zlib.crc32(enc_path.stem.encode()) & 0xFFFFFFFF

    # Find which of our target layers exist in this ENC, and the Inland ENC
    # layers that fold into one of them (see inland.py).
    available = set(list_enc_layers(enc_path))
    target_layers = [name for name in LAYER_NAMES if name in available]
    inland_layers = [
        name
        for name, standard in STANDARD_LAYER.items()
        if name in available and standard in LAYER_NAMES
    ]

    converted: dict[str, Path] = {}
    for layer_name in target_layers:
        path, failure = convert_layer(enc_path, layer_name, output_dir)
        if failure is not None and on_layer_failed is not None:
            on_layer_failed(layer_name, failure)
        if path is not None:
            converted[layer_name] = path
    for layer_name in inland_layers:
        path, failure = convert_layer(
            enc_path, layer_name, output_dir, output_name=f"{layer_name}.inland"
        )
        if failure is not None and on_layer_failed is not None:
            on_layer_failed(layer_name, failure)
        if path is not None:
            standard = STANDARD_LAYER[layer_name]
            converted[standard] = fold_inland(
                path, output_dir / f"{standard.lower()}.geojson"
            )

    outputs: list[Path] = []
    for layer_name, path in converted.items():
        if path is not None:
            ok = enrich_geojson(
                path,
                cell_cscl=cell_cscl,
                cell_intu=cell_intu,
                cell_id=cell_id,
                intu_zoom_ranges=intu_zoom_ranges,
                apply_scamin=apply_scamin,
            )
            if not ok and on_layer_failed is not None:
                on_layer_failed(layer_name, "corrupt GeoJSON removed by enrich")
            # enrich_geojson may remove corrupt files
            if path.exists():
                outputs.append(path)
            if on_layer_done is not None:
                on_layer_done(layer_name)

    # Cross-reference TOPMAR features with buoys/beacons so the frontend
    # can adjust label offsets when a topmark is present.
    correlate_topmarks(output_dir)

    # Stamp child features with their parent's LNAM/OBJNAM/LAYER from S-57
    # FFPT pointers. Needed for PEL / directional light cluster rendering.
    annotate_parents(output_dir)

    # Annotate hazard features with enclosing DEPARE depth for isolated
    # danger detection (S-52 UDWHAZ05).
    annotate_enclosing_depth(output_dir)

    # Record which label anchors keep each island name off neighbouring land,
    # per zoom band, for the front-end's variable-anchor placement.
    annotate_land_label_anchors(output_dir)

    return outputs
