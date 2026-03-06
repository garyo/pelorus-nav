"""SCAMIN, CSCL, and INTU → tippecanoe minzoom/maxzoom + scale band mapping.

S-57 features have a SCAMIN (Scale Minimum) attribute that indicates
the smallest scale at which the feature should be displayed. This module
maps SCAMIN values to tile zoom levels for use with tippecanoe's
per-feature minzoom control.

When SCAMIN is absent (common for COALNE, LNDARE, etc.), the ENC cell's
DSID_INTU (Intended Use) is preferred over DSPM_CSCL for zoom mapping,
following the enc-tiles approach. Most layer groups also get maxzoom to
prevent echoes from overlapping multi-scale cells.

Each feature also gets a `_scale_band` property (0–5) indicating its
source cell's scale band, for potential runtime sort-key use.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


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


# enc-tiles reference zoom ranges (non-overlapping, assumes complete coverage).
# See: https://github.com/openwatersio/enc-tiles/blob/main/bin/s57-to-tiles
INTU_BASE_ZOOMS: dict[int, tuple[int, int]] = {
    1: (0, 6),    # Overview
    2: (7, 8),    # General
    3: (9, 10),   # Coastal
    4: (11, 12),  # Approach
    5: (13, 14),  # Harbour
    6: (15, 16),  # Berthing
}

INTU_SCALE_BAND: dict[int, int] = {
    1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5,
}


def compute_intu_zoom_ranges(
    present_intus: set[int],
    zoom_shift: int = 0,
) -> dict[int, tuple[int, int, int]]:
    """Compute adjusted zoom ranges based on which INTU bands are present.

    For each present band, extends maxzoom to fill gaps where the next
    higher band doesn't exist. The lowest present band extends down to z0.

    This handles NOAA's ENC rescheming where some INTU levels may not
    exist for a given area (e.g., no INTU 4 Approach charts for MA).

    Args:
        present_intus: Set of INTU values found in the dataset.
        zoom_shift: Shift all zoom ranges down by this many levels.
            Positive values show more detail at each zoom (e.g., shift=2
            makes harbour data appear 2 zoom levels earlier). The highest
            band extends up to z14 regardless of shift.

    Returns:
        Dict of intu → (minzoom, maxzoom, scale_band).
    """
    sorted_intus = sorted(present_intus & set(INTU_BASE_ZOOMS))
    if not sorted_intus:
        return {}

    result: dict[int, tuple[int, int, int]] = {}
    for i, intu in enumerate(sorted_intus):
        base_min, base_max = INTU_BASE_ZOOMS[intu]
        band = INTU_SCALE_BAND[intu]

        # Lowest present band extends down to z0
        adj_min = 0 if i == 0 else base_min

        # Extend maxzoom to fill gap before next present band
        if i < len(sorted_intus) - 1:
            next_intu = sorted_intus[i + 1]
            next_min = INTU_BASE_ZOOMS[next_intu][0]
            adj_max = max(base_max, next_min - 1)
        else:
            adj_max = base_max

        result[intu] = (adj_min, adj_max, band)

    # Apply zoom shift: shift all ranges down, keeping non-overlapping.
    # The highest band extends up to z14.
    if zoom_shift > 0 and result:
        shifted: dict[int, tuple[int, int, int]] = {}
        sorted_result = sorted(result.items())
        for i, (intu, (zmin, zmax, band)) in enumerate(sorted_result):
            new_min = max(0, zmin - zoom_shift)
            new_max = max(0, zmax - zoom_shift)
            # Highest band extends up to z14
            if i == len(sorted_result) - 1:
                new_max = max(new_max, 14)
            # Ensure non-overlapping: min can't be less than previous max + 1
            if i > 0:
                prev_intu = sorted_result[i - 1][0]
                prev_max = shifted[prev_intu][1]
                new_min = max(new_min, prev_max + 1)
            shifted[intu] = (new_min, new_max, band)
        result = shifted

    return result


def intu_to_zoom_range(
    intu: int,
    zoom_ranges: dict[int, tuple[int, int, int]] | None = None,
) -> tuple[int, int]:
    """Map a cell's DSID_INTU to a (minzoom, maxzoom) range.

    Args:
        intu: DSID_INTU value (1-6).
        zoom_ranges: Pre-computed ranges from compute_intu_zoom_ranges().
            If None, uses the enc-tiles base (non-overlapping) ranges.
    """
    if zoom_ranges is not None:
        entry = zoom_ranges.get(intu)
        if entry is not None:
            return (entry[0], entry[1])
    base = INTU_BASE_ZOOMS.get(intu)
    if base is not None:
        return base
    return (0, 14)


def intu_to_scale_band(intu: int) -> int:
    """Map a cell's DSID_INTU to a scale band (0–5).

    0 = overview, 1 = general, 2 = coastal, 3 = approach, 4 = harbour, 5 = berthing.
    """
    return INTU_SCALE_BAND.get(intu, 0)


def add_minzoom_to_geojson(
    input_path: Path,
    output_path: Path | None = None,
    cell_cscl: int | None = None,
    cell_intu: int | None = None,
    intu_zoom_ranges: dict[int, tuple[int, int, int]] | None = None,
) -> int:
    """Add tippecanoe minzoom/maxzoom and _scale_band to each feature.

    Uses SCAMIN if present on the feature for per-feature minzoom
    (density control within a cell's tile zoom range). Tile-level
    bounds (tippecanoe -Z/-z) are the sole zoom boundary control;
    no per-feature minzoom/maxzoom is set from the cell band.

    Every feature gets a _scale_band property (0–5) for potential
    runtime sort-key ordering in MapLibre.

    Args:
        input_path: Path to input GeoJSON file.
        output_path: Path to output GeoJSON file. If None, overwrites input.
        cell_cscl: The cell's DSPM_CSCL compilation scale.
        cell_intu: The cell's DSID_INTU intended use (1-6).
        intu_zoom_ranges: Pre-computed ranges from compute_intu_zoom_ranges().
            If None, uses enc-tiles base ranges.

    Returns:
        Number of features processed.
    """
    if output_path is None:
        output_path = input_path

    with open(input_path) as f:
        geojson = json.load(f)

    # Compute scale band — prefer INTU over CSCL
    scale_band = 0
    if cell_intu is not None and cell_intu in INTU_BASE_ZOOMS:
        scale_band = intu_to_scale_band(cell_intu)
    elif cell_cscl is not None:
        scale_band = cscl_to_scale_band(cell_cscl)

    count = 0
    for feature in geojson.get("features", []):
        props = feature.get("properties", {})
        scamin = props.get("SCAMIN")

        if "tippecanoe" not in feature:
            feature["tippecanoe"] = {}

        if scamin is not None and scamin > 0:
            # Feature has explicit SCAMIN — use it for minzoom.
            # Controls feature density within the cell's tile zoom range.
            feature["tippecanoe"]["minzoom"] = scamin_to_minzoom(scamin)
        # No per-feature minzoom/maxzoom from cell band — tile-level bounds
        # (tippecanoe -Z/-z) are the sole zoom boundary control.

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
