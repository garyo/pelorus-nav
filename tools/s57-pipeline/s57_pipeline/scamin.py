"""SCAMIN → tippecanoe minzoom mapping.

S-57 features have a SCAMIN (Scale Minimum) attribute that indicates
the smallest scale at which the feature should be displayed. This module
maps SCAMIN values to tile zoom levels for use with tippecanoe's
per-feature minzoom control.

When SCAMIN is absent (common for COALNE, LNDARE, etc.), the ENC cell's
compilation scale (DSPM_CSCL) is used as a fallback to prevent coarse
overview geometry from rendering at high zoom levels.
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
    (22_000, 13),
    (10_000, 15),
]
DEFAULT_ZOOM = 0


def scamin_to_minzoom(scamin: int | float | None) -> int:
    """Convert a SCAMIN value to a tippecanoe minzoom level.

    Features without SCAMIN are always visible (minzoom 0).

    Args:
        scamin: The SCAMIN attribute value, or None if not present.

    Returns:
        The appropriate tile zoom level.
    """
    if scamin is None or scamin <= 0:
        return DEFAULT_ZOOM

    for threshold, zoom in SCAMIN_ZOOM_TABLE:
        if scamin >= threshold:
            return zoom

    return DEFAULT_ZOOM


# Compilation scale (DSPM_CSCL) → (minzoom, maxzoom) for the cell.
# maxzoom is only applied to terrain polygon layers (DEPARE, LNDARE, etc.)
# where finer-scale cells provide replacement geometry. Lines and points
# don't get maxzoom since they just overlay without conflict.
CSCL_ZOOM_TABLE: list[tuple[int, int, int]] = [
    # (max_cscl, minzoom, maxzoom)
    (100_000, 0, 9),    # Band 2/3 overview: z0-9 for polygons
    (50_000, 8, 12),    # Band 4 approach: z8-12 for polygons
    (0, 10, 14),        # Band 5+ harbor: z10-14
]

# Layer groups that get maxzoom capping (features that overlap between scales)
_MAXZOOM_GROUPS = {"terrain", "regulatory", "lines"}


def cscl_to_minzoom(cscl: int) -> int:
    """Map a cell's compilation scale to a minzoom level.

    Args:
        cscl: The DSPM_CSCL value from the ENC cell.

    Returns:
        minzoom for features from this cell.
    """
    for max_cscl, minzoom, _maxzoom in CSCL_ZOOM_TABLE:
        if cscl > max_cscl:
            return minzoom
    return 10


def cscl_to_zoom_range(cscl: int) -> tuple[int, int]:
    """Map a cell's compilation scale to a (minzoom, maxzoom) range.

    Args:
        cscl: The DSPM_CSCL value from the ENC cell.

    Returns:
        (minzoom, maxzoom) tuple for features from this cell.
    """
    for max_cscl, minzoom, maxzoom in CSCL_ZOOM_TABLE:
        if cscl > max_cscl:
            return (minzoom, maxzoom)
    return (10, 14)


def add_minzoom_to_geojson(
    input_path: Path,
    output_path: Path | None = None,
    cell_cscl: int | None = None,
) -> int:
    """Add tippecanoe minzoom/maxzoom to each feature in a GeoJSON file.

    Uses SCAMIN if present on the feature, otherwise falls back to the
    cell's compilation scale to assign appropriate zoom ranges.

    For terrain polygon layers (DEPARE, LNDARE, etc.), maxzoom is set to
    prevent coarse data from overlaying finer-scale data at high zoom.
    For lines and points, only minzoom is set — they overlay without conflict.

    The layer name is inferred from the input filename (e.g. depare.geojson → DEPARE).

    Args:
        input_path: Path to input GeoJSON file.
        output_path: Path to output GeoJSON file. If None, overwrites input.
        cell_cscl: The cell's DSPM_CSCL compilation scale. If provided,
            features without SCAMIN get zoom ranges based on this.

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

    # Compute cell-level zoom range if compilation scale provided
    cell_minzoom: int | None = None
    cell_maxzoom: int | None = None
    if cell_cscl is not None:
        cell_minzoom, cell_maxzoom = cscl_to_zoom_range(cell_cscl)

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
            # No SCAMIN and no cell scale — show everywhere
            feature["tippecanoe"]["minzoom"] = DEFAULT_ZOOM

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
