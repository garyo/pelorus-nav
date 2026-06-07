#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["shapely>=2.0", "pyproj>=3.6"]
# ///
"""Build an offline street basemap for a region from the Protomaps daily build.

Produces public/basemap-<region>.pmtiles with a two-tier pyramid:
  - z0-13  : 10 nm buffer of the region's chart coverage (context everywhere)
  - z14-15 : 1 nm buffer of US5/US6 (harbor/berthing) ENC cell bboxes
             (street-level detail where you actually approach and dock)

Requires a prior chart build for the region (coverage geojson + cell cache),
plus the `pmtiles` CLI and tippecanoe's `tile-join` on PATH.

Usage:
  uv run tools/basemap/build-basemap.py --region northern-new-england
  uv run tools/basemap/build-basemap.py --region usvi --source 20260606
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import urllib.request
from datetime import date, timedelta
from pathlib import Path
from typing import NoReturn

from pyproj import Transformer
from shapely.geometry import MultiPolygon, Polygon, box, mapping, shape
from shapely.ops import transform, unary_union

PROJECT_DIR = Path(__file__).resolve().parents[2]
PUBLIC_DIR = PROJECT_DIR / "public"
TILE_DATA_DIR = PROJECT_DIR / "tile-data"
WORK_DIR = TILE_DATA_DIR / "work" / "basemap"
REGIONS_JSON = PROJECT_DIR / "tools" / "regions.json"

PROTOMAPS_BUILDS = "https://build.protomaps.com"
NM = 1852.0
BAND_BUFFER_M = 10 * NM  # coastal band: 10 nm around chart coverage
DETAIL_BUFFER_M = 1 * NM  # harbor band: 1 nm around US5/US6 cell bboxes
BAND_MAXZOOM = 13
DETAIL_MINZOOM = 14
DETAIL_MAXZOOM = 15
# Usage band is the 3rd char of the cell name (US5MA22M): 5=harbor, 6=berthing
DETAIL_USAGE_BANDS = {"5", "6"}


def fail(msg: str) -> NoReturn:
    print(f"Error: {msg}", file=sys.stderr)
    sys.exit(1)


def region_bbox(region: str) -> tuple[float, float, float, float]:
    regions = json.loads(REGIONS_JSON.read_text())
    for entry in regions:
        if entry["id"] == region:
            return tuple(entry["bbox"])
    fail(f"unknown region {region!r} (see {REGIONS_JSON})")


def utm_transformers(bbox: tuple[float, float, float, float]):
    """Forward/inverse transforms to the UTM zone at the bbox centre.

    Regions can span several zones; for buffering a band mask the edge
    distortion (a few percent) is irrelevant.
    """
    center_lon = (bbox[0] + bbox[2]) / 2
    zone = int((center_lon + 180) / 6) + 1
    epsg = 32600 + zone  # all chart regions are in the northern hemisphere
    fwd = Transformer.from_crs("EPSG:4326", f"EPSG:{epsg}", always_xy=True).transform
    inv = Transformer.from_crs(f"EPSG:{epsg}", "EPSG:4326", always_xy=True).transform
    return fwd, inv


def coverage_geometry(region: str) -> MultiPolygon:
    """Chart coverage = the holes of the inverted coverage mask."""
    path = PUBLIC_DIR / f"nautical-{region}.coverage.geojson"
    if not path.exists():
        fail(f"{path} not found — build the region's charts first")
    fc = json.loads(path.read_text())
    rings: list[Polygon] = []
    for feature in fc.get("features", [fc]):
        geom = shape(feature["geometry"])
        polys = list(geom.geoms) if isinstance(geom, MultiPolygon) else [geom]
        for poly in polys:
            if isinstance(poly, Polygon):
                rings.extend(Polygon(r) for r in poly.interiors)
    if not rings:
        fail(f"{path} has no interior rings — not an inverted coverage mask?")
    return MultiPolygon(rings)


def harbor_cells_geometry(region: str) -> MultiPolygon | None:
    """Union of US5/US6 cell bboxes for the region (None if cache missing)."""
    cells_path = TILE_DATA_DIR / "regions" / f"{region}.json"
    catalog_path = TILE_DATA_DIR / "regions" / "enc_catalog.json"
    if not cells_path.exists() or not catalog_path.exists():
        return None
    names = json.loads(cells_path.read_text())["cells"]
    catalog = {c["name"]: c for c in json.loads(catalog_path.read_text())}
    boxes = [
        box(*catalog[n]["bbox"])
        for n in names
        if n in catalog and n[2] in DETAIL_USAGE_BANDS
    ]
    if not boxes:
        return None
    union = unary_union(boxes)
    if isinstance(union, MultiPolygon):
        return union
    return MultiPolygon([union]) if isinstance(union, Polygon) else None


def write_band(geom, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"type": "Feature", "properties": {}, "geometry": mapping(geom)})
    )


def buffered_band(geom, buffer_m: float, bbox, simplify_m: float = 200.0):
    """Buffer in UTM metres, simplify, clip to the region bbox."""
    fwd, inv = utm_transformers(bbox)
    band = transform(fwd, geom).buffer(buffer_m).simplify(simplify_m)
    return transform(inv, band).intersection(box(*bbox))


def latest_protomaps_source(explicit: str | None) -> str:
    """Resolve the Protomaps source archive URL (probe recent daily builds)."""
    if explicit:
        if explicit.startswith("http"):
            return explicit
        return f"{PROTOMAPS_BUILDS}/{explicit}.pmtiles"
    for days_back in range(8):
        d = (date.today() - timedelta(days=days_back)).strftime("%Y%m%d")
        url = f"{PROTOMAPS_BUILDS}/{d}.pmtiles"
        # Cloudflare rejects urllib's default User-Agent with a 403
        req = urllib.request.Request(
            url,
            headers={"Range": "bytes=0-0", "User-Agent": "pelorus-nav-basemap-build"},
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                if resp.status in (200, 206):
                    return url
        except Exception:
            continue
    fail(f"no recent daily build found at {PROTOMAPS_BUILDS}")


def run(cmd: list[str]) -> None:
    print(f"$ {' '.join(cmd)}", flush=True)
    subprocess.run(cmd, check=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--region", required=True)
    parser.add_argument(
        "--source",
        help="Protomaps build: YYYYMMDD, full URL, or local .pmtiles path "
        "(default: latest daily build)",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        help="output path (default: public/basemap-<region>.pmtiles)",
    )
    args = parser.parse_args()

    for tool in ("pmtiles", "tile-join"):
        if not shutil.which(tool):
            fail(f"`{tool}` not found on PATH (brew install pmtiles tippecanoe)")

    region = args.region
    output = args.output or PUBLIC_DIR / f"basemap-{region}.pmtiles"
    bbox = region_bbox(region)
    source = (
        args.source
        if args.source and Path(args.source).exists()
        else latest_protomaps_source(args.source)
    )
    print(f"Source: {source}")

    coverage = coverage_geometry(region)
    band = buffered_band(coverage, BAND_BUFFER_M, bbox)
    band_path = WORK_DIR / f"{region}-band.geojson"
    write_band(band, band_path)

    harbors = harbor_cells_geometry(region)
    detail_path = None
    if harbors is None:
        print(
            f"Warning: no US5/US6 cell cache for {region} — "
            f"skipping z{DETAIL_MINZOOM}-{DETAIL_MAXZOOM} harbor detail",
            file=sys.stderr,
        )
    else:
        detail = buffered_band(harbors, DETAIL_BUFFER_M, bbox, simplify_m=100.0)
        detail_path = WORK_DIR / f"{region}-detail.geojson"
        write_band(detail, detail_path)

    band_tiles = WORK_DIR / f"{region}-band.pmtiles"
    run(
        [
            "pmtiles", "extract", source, str(band_tiles),
            f"--region={band_path}", f"--maxzoom={BAND_MAXZOOM}",
        ]
    )

    if detail_path is None:
        output.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(band_tiles, output)
    else:
        detail_tiles = WORK_DIR / f"{region}-detail.pmtiles"
        run(
            [
                "pmtiles", "extract", source, str(detail_tiles),
                f"--region={detail_path}",
                f"--minzoom={DETAIL_MINZOOM}", f"--maxzoom={DETAIL_MAXZOOM}",
            ]
        )
        run(["tile-join", "-f", "-o", str(output), "-pk", str(band_tiles), str(detail_tiles)])

    size_mb = output.stat().st_size / 1e6
    print(f"Wrote {output} ({size_mb:.0f} MB)")


if __name__ == "__main__":
    main()
