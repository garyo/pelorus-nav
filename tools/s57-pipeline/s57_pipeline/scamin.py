"""SCAMIN and CSCL → tippecanoe minzoom/maxzoom + scale band mapping.

S-57 features have a SCAMIN (Scale Minimum) attribute that indicates
the smallest scale at which the feature should be displayed. This module
maps SCAMIN values to tile zoom levels for use with tippecanoe's
per-feature minzoom control.

When SCAMIN is absent (common for COALNE, LNDARE, etc.), the ENC cell's
compilation scale (DSPM_CSCL) is used as a fallback. Most layer groups
also get maxzoom to prevent echoes from overlapping multi-scale cells.

Each feature also gets a `_scale_band` property (0–3) indicating its
source cell's scale band, for potential runtime sort-key use.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from .layers import get_layer_config

# SCAMIN thresholds → tile zoom levels (checked in descending order).
# A feature with SCAMIN >= threshold gets this minzoom.
SCAMIN_ZOOM_TABLE: list[tuple[int, int]] = [
    (5_000_000, 3),
    (1_000_000, 6),
    (200_000, 9),
    (50_000, 11),
    (20_000, 12),
    (10_000, 13),
]
DEFAULT_ZOOM = 0


def scamin_to_minzoom(scamin: int | float | None) -> int:
    """Convert a SCAMIN value to a tippecanoe minzoom level.

    Features without SCAMIN are always visible (minzoom 0).
    """
    if scamin is None or scamin <= 0:
        return DEFAULT_ZOOM

    for threshold, zoom in SCAMIN_ZOOM_TABLE:
        if scamin >= threshold:
            return zoom

    return DEFAULT_ZOOM


# Compilation scale (DSPM_CSCL) → (minzoom, maxzoom, scale_band).
CSCL_BANDS: list[tuple[int, int, int, int]] = [
    # (max_cscl, minzoom, maxzoom, scale_band)
    (500_000, 0, 5, 0),    # Overview (CSCL > 500k): z0-5
    (100_000, 6, 9, 1),    # Coastal (CSCL 100k-500k): z6-9
    (50_000, 9, 12, 2),    # Approach (CSCL 50k-100k): z9-12
    (0, 9, 14, 3),         # Harbor (CSCL ≤ 50k): z9-14
]

# Layer groups that get maxzoom capping to prevent echoes/duplicates
# from overlapping multi-scale cells. Infrastructure is excluded
# (sparse, cell-specific features that don't overlap problematically).
_MAXZOOM_GROUPS = {"terrain", "regulatory", "lines", "hazards", "navaids", "dense_points", "labels"}


def cscl_to_minzoom(cscl: int) -> int:
    """Map a cell's compilation scale to a minzoom level."""
    for max_cscl, minzoom, _maxzoom, _band in CSCL_BANDS:
        if cscl > max_cscl:
            return minzoom
    return 9


def cscl_to_zoom_range(cscl: int) -> tuple[int, int]:
    """Map a cell's compilation scale to a (minzoom, maxzoom) range."""
    for max_cscl, minzoom, maxzoom, _band in CSCL_BANDS:
        if cscl > max_cscl:
            return (minzoom, maxzoom)
    return (9, 14)


def cscl_to_scale_band(cscl: int) -> int:
    """Map a cell's compilation scale to a scale band (0–3).

    0 = overview, 1 = coastal, 2 = approach, 3 = harbor.
    Stored as _scale_band property for potential runtime sort-key use.
    """
    for max_cscl, _minzoom, _maxzoom, band in CSCL_BANDS:
        if cscl > max_cscl:
            return band
    return 3


def add_minzoom_to_geojson(
    input_path: Path,
    output_path: Path | None = None,
    cell_cscl: int | None = None,
) -> int:
    """Add tippecanoe minzoom/maxzoom and _scale_band to each feature.

    Uses SCAMIN if present on the feature (minzoom only, no maxzoom).
    Otherwise falls back to the cell's compilation scale for zoom range.
    Maxzoom is applied to most layer groups to prevent echoes from
    overlapping multi-scale cells.

    Every feature gets a _scale_band property (0–3) for potential
    runtime sort-key ordering in MapLibre.

    Args:
        input_path: Path to input GeoJSON file.
        output_path: Path to output GeoJSON file. If None, overwrites input.
        cell_cscl: The cell's DSPM_CSCL compilation scale.

    Returns:
        Number of features processed.
    """
    if output_path is None:
        output_path = input_path

    with open(input_path) as f:
        geojson = json.load(f)

    # Determine if this layer should get maxzoom
    layer_name = input_path.stem.upper()
    layer_cfg = get_layer_config(layer_name)
    use_maxzoom = layer_cfg is not None and layer_cfg.group in _MAXZOOM_GROUPS

    # Compute cell-level values
    cell_minzoom: int | None = None
    cell_maxzoom: int | None = None
    scale_band = 0
    if cell_cscl is not None:
        cell_minzoom, cell_maxzoom = cscl_to_zoom_range(cell_cscl)
        scale_band = cscl_to_scale_band(cell_cscl)

    count = 0
    for feature in geojson.get("features", []):
        props = feature.get("properties", {})
        scamin = props.get("SCAMIN")

        if "tippecanoe" not in feature:
            feature["tippecanoe"] = {}

        if scamin is not None and scamin > 0:
            # Feature has explicit SCAMIN — use it for minzoom only
            feature["tippecanoe"]["minzoom"] = scamin_to_minzoom(scamin)
        elif cell_minzoom is not None:
            # No SCAMIN — use cell compilation scale
            feature["tippecanoe"]["minzoom"] = cell_minzoom
            if use_maxzoom and cell_maxzoom is not None:
                feature["tippecanoe"]["maxzoom"] = cell_maxzoom
        else:
            feature["tippecanoe"]["minzoom"] = DEFAULT_ZOOM

        # Scale band for potential runtime sort-key ordering
        props["_scale_band"] = scale_band

        count += 1

    with open(output_path, "w") as f:
        json.dump(geojson, f)

    return count


def main() -> None:
    """CLI entry point for standalone SCAMIN processing."""
    if len(sys.argv) < 2:
        print("Usage: python -m s57_pipeline.scamin <input.geojson> [output.geojson]")
        sys.exit(1)

    input_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2]) if len(sys.argv) > 2 else None
    count = add_minzoom_to_geojson(input_path, output_path)
    print(f"Processed {count} features")


if __name__ == "__main__":
    main()
