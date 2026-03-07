"""Spatial query utility for ENC cells.

Builds an STRtree index from M_COVR coverage polygons for fast
point-in-polygon and bbox intersection queries.  The index is cached
to disk as JSON so subsequent queries are near-instant.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from shapely import STRtree, make_valid
from shapely.geometry import Point, box, mapping, shape
from shapely.geometry.base import BaseGeometry

from .convert import read_compilation_scale, read_intended_use
from .coverage import extract_coverage_polygon
from .scamin import cscl_to_scale_band, intu_to_scale_band

INDEX_FILENAME = "cell_index.json"


@dataclass
class CellInfo:
    """Metadata for a single ENC cell."""

    name: str
    enc_path: str
    intu: int | None
    band: int
    coverage_wkt: str  # WKT for serialization
    coverage: BaseGeometry  # runtime only

    def bounds_str(self) -> str:
        b = self.coverage.bounds  # (minx, miny, maxx, maxy)
        return f"({b[0]:.3f}, {b[1]:.3f}) to ({b[2]:.3f}, {b[3]:.3f})"


class CellIndex:
    """Spatial index over ENC cell coverage polygons."""

    def __init__(self, cells: list[CellInfo]) -> None:
        self.cells = cells
        geoms = [c.coverage for c in cells]
        self._tree = STRtree(geoms)

    def query_point(self, lon: float, lat: float) -> list[CellInfo]:
        """Find all cells whose M_COVR contains the given point."""
        pt = Point(lon, lat)
        idxs = self._tree.query(pt, predicate="intersects")
        return [self.cells[i] for i in idxs]

    def query_bbox(
        self, west: float, south: float, east: float, north: float
    ) -> list[CellInfo]:
        """Find all cells whose M_COVR intersects the given bbox."""
        rect = box(west, south, east, north)
        idxs = self._tree.query(rect, predicate="intersects")
        return [self.cells[i] for i in idxs]

    def query_nearby(
        self, lon: float, lat: float, max_distance: float = 0.5
    ) -> list[tuple[float, CellInfo]]:
        """Find cells near a point, sorted by distance (degrees)."""
        pt = Point(lon, lat)
        results: list[tuple[float, CellInfo]] = []
        # Query with buffered point for candidate filtering
        buffered = pt.buffer(max_distance)
        idxs = self._tree.query(buffered, predicate="intersects")
        for i in idxs:
            cell = self.cells[i]
            dist = cell.coverage.distance(pt)
            if dist <= max_distance:
                results.append((dist, cell))
        results.sort(key=lambda x: x[0])
        return results


def build_index(enc_files: list[Path], cache_dir: Path | None = None) -> CellIndex:
    """Build spatial index from ENC files, using cache if available.

    Args:
        enc_files: List of .000 ENC file paths.
        cache_dir: Directory to cache the index JSON. If the cache exists
                   and covers the same files, it's used instead of re-scanning.
    """
    cache_path = cache_dir / INDEX_FILENAME if cache_dir else None

    # Try loading from cache
    if cache_path and cache_path.exists():
        cells = _load_cache(cache_path)
        if cells is not None:
            print(f"Loaded cell index from cache ({len(cells)} cells)")
            return CellIndex(cells)

    # Scan all ENC files
    print(f"Building cell index from {len(enc_files)} ENC files...")
    cells = []
    for enc_path in enc_files:
        cov = extract_coverage_polygon(enc_path)
        if cov is None:
            continue

        intu = read_intended_use(enc_path)
        if intu is not None:
            band = intu_to_scale_band(intu)
        else:
            cscl = read_compilation_scale(enc_path)
            band = cscl_to_scale_band(cscl) if cscl is not None else 0

        cells.append(CellInfo(
            name=enc_path.stem,
            enc_path=str(enc_path),
            intu=intu,
            band=band,
            coverage_wkt=cov.wkt,
            coverage=cov,
        ))

    # Save cache
    if cache_path:
        _save_cache(cache_path, cells)
        print(f"Cached cell index to {cache_path}")

    print(f"Indexed {len(cells)} cells with M_COVR coverage")
    return CellIndex(cells)


def _save_cache(path: Path, cells: list[CellInfo]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    data = [
        {
            "name": c.name,
            "enc_path": c.enc_path,
            "intu": c.intu,
            "band": c.band,
            "coverage_geojson": mapping(c.coverage),
        }
        for c in cells
    ]
    path.write_text(json.dumps(data))


def _load_cache(path: Path) -> list[CellInfo] | None:
    try:
        data = json.loads(path.read_text())
        cells: list[CellInfo] = []
        for entry in data:
            cov = make_valid(shape(entry["coverage_geojson"]))
            cells.append(CellInfo(
                name=entry["name"],
                enc_path=entry["enc_path"],
                intu=entry["intu"],
                band=entry["band"],
                coverage_wkt=cov.wkt,
                coverage=cov,
            ))
        return cells
    except Exception:
        return None
