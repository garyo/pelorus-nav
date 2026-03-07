"""M_COVR coverage polygon extraction and clip mask computation."""

from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path

from shapely import make_valid, union_all
from shapely.geometry import mapping, shape
from shapely.geometry.base import BaseGeometry


def extract_coverage_polygon(enc_path: Path) -> BaseGeometry | None:
    """Extract M_COVR from ENC, return coverage polygon (CATCOV=1 minus CATCOV=2).

    Args:
        enc_path: Path to the .000 ENC file.

    Returns:
        Shapely geometry representing the cell's coverage area, or None if
        no M_COVR layer exists.
    """
    with tempfile.TemporaryDirectory(prefix="mcovr_") as tmpdir:
        out_path = Path(tmpdir) / "mcovr.geojson"
        result = subprocess.run(
            [
                "ogr2ogr",
                "-f",
                "GeoJSON",
                str(out_path),
                str(enc_path),
                "M_COVR",
                "-lco",
                "RFC7946=YES",
                "-skipfailures",
            ],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0 or not out_path.exists():
            return None

        if out_path.stat().st_size < 100:
            return None

        with open(out_path) as f:
            geojson = json.load(f)

    features = geojson.get("features", [])
    if not features:
        return None

    catcov1_polys: list[BaseGeometry] = []
    catcov2_polys: list[BaseGeometry] = []

    for feat in features:
        geom = feat.get("geometry")
        props = feat.get("properties", {})
        if geom is None:
            continue

        poly = make_valid(shape(geom))
        if poly.is_empty:
            continue

        catcov = props.get("CATCOV")
        if catcov == 2:
            catcov2_polys.append(poly)
        else:
            # CATCOV=1 or missing — treat as coverage
            catcov1_polys.append(poly)

    if not catcov1_polys:
        return None

    coverage = make_valid(union_all(catcov1_polys))
    if catcov2_polys:
        holes = make_valid(union_all(catcov2_polys))
        coverage = make_valid(coverage.difference(holes))

    return coverage if not coverage.is_empty else None


def build_coverage_index(
    enc_files: list[Path],
    bands: dict[Path, int],
) -> dict[int, BaseGeometry]:
    """Build per-band union of all coverage polygons.

    Args:
        enc_files: List of ENC file paths.
        bands: Mapping of enc_path to scale_band.

    Returns:
        Dict of {band: union_polygon} for bands that have M_COVR data.
    """
    band_polys: dict[int, list[BaseGeometry]] = {}

    for enc_path in enc_files:
        band = bands.get(enc_path, 0)
        poly = extract_coverage_polygon(enc_path)
        if poly is not None:
            band_polys.setdefault(band, []).append(poly)
        else:
            print(f"  Warning: no M_COVR in {enc_path.stem}, skipping coverage")

    result: dict[int, BaseGeometry] = {}
    for band, polys in band_polys.items():
        result[band] = make_valid(union_all(polys))

    return result


def build_cell_coverage(
    enc_files: list[Path],
) -> dict[Path, BaseGeometry]:
    """Extract per-cell M_COVR coverage polygons.

    Args:
        enc_files: List of ENC file paths.

    Returns:
        Dict of {enc_path: coverage_polygon} for cells with M_COVR data.
    """
    result: dict[Path, BaseGeometry] = {}
    for enc_path in enc_files:
        poly = extract_coverage_polygon(enc_path)
        if poly is not None:
            result[enc_path] = poly
        else:
            print(f"  Warning: no M_COVR in {enc_path.stem}")
    return result


def compute_clip_mask(
    cell_band: int,
    coverage_index: dict[int, BaseGeometry],
) -> BaseGeometry | None:
    """Compute the union of all higher-band coverage polygons.

    Args:
        cell_band: The scale band of the cell to be clipped.
        coverage_index: Per-band coverage polygons from build_coverage_index.

    Returns:
        Geometry to subtract from this cell's features, or None if no
        higher bands exist (no clipping needed).
    """
    higher_polys: list[BaseGeometry] = []
    for band, geom in coverage_index.items():
        if band > cell_band:
            higher_polys.append(geom)

    if not higher_polys:
        return None

    mask = make_valid(union_all(higher_polys))
    return mask if not mask.is_empty else None


def compute_clip_segments(
    cell_band: int,
    cell_minzoom: int,
    cell_maxzoom: int,
    coverage_index: dict[int, BaseGeometry],
    band_minzooms: dict[int, int],
) -> list[tuple[int, int, BaseGeometry | None]]:
    """Compute zoom segments with per-segment clip masks for a cell.

    At each zoom level, the clip mask only includes higher bands that
    actually generate tiles at that zoom. This prevents clipping away
    features at low zooms where no higher-band tiles exist to fill in.

    Args:
        cell_band: Scale band of this cell.
        cell_minzoom: Minimum zoom for this cell's tiles.
        cell_maxzoom: Maximum zoom for this cell's tiles.
        coverage_index: Per-band coverage polygons.
        band_minzooms: Dict of band → minimum zoom where tiles are generated.

    Returns:
        List of (minzoom, maxzoom, clip_mask) segments. clip_mask is None
        for segments where no higher band has tiles (no clipping needed).
    """
    # Collect higher bands with M_COVR coverage, sorted by their minzoom
    higher_bands: list[tuple[int, int]] = []  # (minzoom, band)
    for band, _geom in coverage_index.items():
        if band > cell_band:
            minzoom = band_minzooms.get(band, 0)
            higher_bands.append((minzoom, band))

    if not higher_bands:
        return [(cell_minzoom, cell_maxzoom, None)]

    higher_bands.sort()

    # Build segments at each zoom threshold where a new band becomes active
    segments: list[tuple[int, int, BaseGeometry | None]] = []
    active_bands: list[int] = []
    prev_zoom = cell_minzoom

    for threshold_zoom, band in higher_bands:
        # Clamp threshold to cell's zoom range
        threshold_zoom = max(threshold_zoom, cell_minzoom)

        if threshold_zoom > prev_zoom:
            # Segment before this band starts: use current active mask
            mask = _build_mask(active_bands, coverage_index)
            segments.append((prev_zoom, threshold_zoom - 1, mask))
            prev_zoom = threshold_zoom

        active_bands.append(band)

    # Final segment to cell_maxzoom
    if prev_zoom <= cell_maxzoom:
        mask = _build_mask(active_bands, coverage_index)
        segments.append((prev_zoom, cell_maxzoom, mask))

    return segments


def _build_mask(
    bands: list[int],
    coverage_index: dict[int, BaseGeometry],
) -> BaseGeometry | None:
    """Build a union mask from the given bands' coverage polygons."""
    if not bands:
        return None
    polys = [coverage_index[b] for b in bands if b in coverage_index]
    if not polys:
        return None
    mask = make_valid(union_all(polys))
    return mask if not mask.is_empty else None


def clip_geojson(geojson_path: Path, clip_mask: BaseGeometry) -> int:
    """Clip features in-place: subtract clip_mask from each feature's geometry.

    Features that become empty after clipping are removed.

    Args:
        geojson_path: Path to a GeoJSON file to clip in-place.
        clip_mask: Geometry to subtract from each feature.

    Returns:
        Number of features removed (became empty after clipping).
    """
    with open(geojson_path) as f:
        geojson = json.load(f)

    features = geojson.get("features", [])
    if not features:
        return 0

    kept: list[dict] = []
    removed = 0

    for feat in features:
        geom = feat.get("geometry")
        if geom is None:
            removed += 1
            continue

        feat_geom = make_valid(shape(geom))
        if feat_geom.is_empty:
            removed += 1
            continue

        clipped = feat_geom.difference(clip_mask)
        if clipped.is_empty:
            removed += 1
            continue

        clipped = make_valid(clipped)
        feat["geometry"] = mapping(clipped)
        kept.append(feat)

    geojson["features"] = kept

    with open(geojson_path, "w") as f:
        json.dump(geojson, f)

    return removed
