"""M_COVR coverage polygon extraction and clip mask computation."""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path

from shapely import make_valid, union_all
from shapely.geometry import mapping, shape
from shapely.geometry.base import BaseGeometry

from .convert import read_dsid_metadata
from .scamin import cscl_to_scale_band, intu_to_scale_band
from .state import StateDB


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


@dataclass
class CellMetadata:
    """Combined DSID metadata and M_COVR coverage for a single cell."""

    enc_path: Path
    intu: int | None
    cscl: int | None
    scale_band: int
    coverage: BaseGeometry | None


def _scan_one_cell(enc_path: Path) -> CellMetadata:
    """Read DSID metadata + extract M_COVR for a single cell.

    Runs two subprocess calls (ogrinfo for DSID, ogr2ogr for M_COVR).
    Designed to be called in parallel from a thread pool.
    """
    intu, cscl = read_dsid_metadata(enc_path)

    if intu is not None:
        band = intu_to_scale_band(intu)
    elif cscl is not None:
        band = cscl_to_scale_band(cscl)
    else:
        band = 0

    coverage = extract_coverage_polygon(enc_path)

    return CellMetadata(
        enc_path=enc_path,
        intu=intu,
        cscl=cscl,
        scale_band=band,
        coverage=coverage,
    )


def scan_all_cells(
    enc_files: list[Path],
    jobs: int = 0,
    db: StateDB | None = None,
) -> list[CellMetadata]:
    """Scan DSID metadata and M_COVR coverage for all cells in parallel.

    Combines INTU/CSCL reading and M_COVR extraction into a single
    parallel pass using threads (subprocess I/O bound, not CPU bound).

    When a StateDB is provided, uses cached scan results for cells whose
    NOAA date hasn't changed, avoiding ~2 subprocess calls per cache hit.

    Args:
        enc_files: List of ENC file paths.
        jobs: Number of parallel workers (0 = auto).
        db: Optional StateDB for scan caching.

    Returns:
        List of CellMetadata, one per input cell.
    """
    if jobs <= 0:
        jobs = max(1, (os.cpu_count() or 4) - 1)

    results: list[CellMetadata] = []
    to_scan: list[Path] = []
    cache_hits = 0

    # Check cache for each cell
    for enc_path in enc_files:
        if db is not None:
            cell_name = enc_path.stem
            noaa_date = db.get_noaa_date(cell_name)
            cached = db.get_scan_cache(cell_name)
            if cached is not None and noaa_date and cached[0] == noaa_date:
                # Cache hit — reconstruct CellMetadata from cached values
                coverage = _wkb_to_coverage(cached[4])
                results.append(CellMetadata(
                    enc_path=enc_path,
                    intu=cached[1],
                    cscl=cached[2],
                    scale_band=cached[3],
                    coverage=coverage,
                ))
                cache_hits += 1
                continue
        to_scan.append(enc_path)

    if cache_hits:
        print(f"  Scan cache: {cache_hits} hits, {len(to_scan)} misses")

    # Scan cache misses in parallel
    with ThreadPoolExecutor(max_workers=jobs) as executor:
        futures = {
            executor.submit(_scan_one_cell, enc_path): enc_path
            for enc_path in to_scan
        }
        for future in as_completed(futures):
            enc_path = futures[future]
            try:
                meta = future.result()
                results.append(meta)
                # Write to cache
                if db is not None:
                    noaa_date = db.get_noaa_date(enc_path.stem) or ""
                    coverage_wkb = _coverage_to_wkb(meta.coverage)
                    db.set_scan_cache(
                        enc_path.stem, noaa_date,
                        meta.intu, meta.cscl, meta.scale_band,
                        coverage_wkb,
                    )
            except Exception as e:
                print(f"  Error scanning {enc_path.stem}: {e}")
                results.append(CellMetadata(
                    enc_path=enc_path,
                    intu=None,
                    cscl=None,
                    scale_band=0,
                    coverage=None,
                ))

    return results


def _coverage_to_wkb(geom: BaseGeometry | None) -> bytes | None:
    """Serialize a Shapely geometry to WKB bytes."""
    if geom is None:
        return None
    from shapely import wkb
    return wkb.dumps(geom)


def _wkb_to_coverage(data: bytes | None) -> BaseGeometry | None:
    """Deserialize WKB bytes to a Shapely geometry."""
    if data is None:
        return None
    from shapely import wkb
    return wkb.loads(data)
