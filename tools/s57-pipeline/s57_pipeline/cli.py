"""CLI entry point for the S-57 → PMTiles pipeline."""

from __future__ import annotations

import argparse
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from shapely.geometry.base import BaseGeometry

from .composite import CellTileSource, composite_tiles
from .convert import convert_enc, read_compilation_scale, read_intended_use
from .coverage import build_cell_coverage
from .download import download_enc_cell
from .merge import merge_tiles
from .query import build_index
from .regions import REGIONS, get_region_cells, query_region
from .scamin import (
    compute_intu_zoom_ranges,
    cscl_to_scale_band,
    cscl_to_zoom_range,
    intu_to_scale_band,
    intu_to_zoom_range,
)
from .tile import tile_geojson_files


def cmd_list_cells(args: argparse.Namespace) -> None:
    """List ENC cells for a region or bounding box."""
    if args.region:
        if args.region not in REGIONS:
            print(f"Unknown region: {args.region}")
            print(f"Available regions: {', '.join(REGIONS)}")
            sys.exit(1)
        region = REGIONS[args.region]
        print(f"Region: {region.name} — {region.description}")
        print(f"Bbox: {region.bbox}")
        cells = get_region_cells(args.region)
    elif args.bbox:
        parts = [float(x.strip()) for x in args.bbox.split(",")]
        if len(parts) != 4:
            print("Bbox must have 4 values: west,south,east,north")
            sys.exit(1)
        bbox = (parts[0], parts[1], parts[2], parts[3])
        print(f"Bbox: {bbox}")
        cells = query_region(bbox)
    else:
        print("Provide --region or --bbox")
        sys.exit(1)

    print(f"\n{len(cells)} cells:")
    for cell in cells:
        print(f"  {cell}  https://charts.noaa.gov/ENCs/{cell}.zip")



def cmd_query(args: argparse.Namespace) -> None:
    """Query ENC cell coverage at a point or within a bounding box."""
    input_dir = Path(args.input)
    enc_files = list(input_dir.rglob("*.000"))
    if not enc_files:
        print(f"No .000 files found in {input_dir}")
        sys.exit(1)

    cache_dir = Path("data/regions")
    index = build_index(enc_files, cache_dir=cache_dir)

    if args.point:
        parts = [x.strip() for x in args.point.split(",")]
        if len(parts) != 2:
            print("--point must be lat,lon (e.g. '44.38,-67.69')")
            sys.exit(1)
        lat, lon = float(parts[0]), float(parts[1])

        # Exact matches
        hits = index.query_point(lon, lat)
        print(f"\nCells covering ({lat}, {lon}): {len(hits)}")
        for c in sorted(hits, key=lambda c: c.band):
            print(f"  {c.name}  INTU={c.intu}  band={c.band}  bounds={c.bounds_str()}")

        # Nearby if no exact hits or always show nearby
        if not hits or args.nearby:
            nearby = index.query_nearby(lon, lat, max_distance=args.radius)
            # Filter out exact hits
            hit_names = {c.name for c in hits}
            nearby = [(d, c) for d, c in nearby if c.name not in hit_names]
            if nearby:
                print(f"\nNearby cells (within {args.radius}°):")
                for dist, c in nearby[:20]:
                    print(
                        f"  {c.name}  INTU={c.intu}  band={c.band}  "
                        f"dist={dist:.4f}°  bounds={c.bounds_str()}"
                    )

    elif args.bbox:
        parts = [float(x.strip()) for x in args.bbox.split(",")]
        if len(parts) != 4:
            print("--bbox must be west,south,east,north")
            sys.exit(1)
        west, south, east, north = parts
        hits = index.query_bbox(west, south, east, north)
        print(f"\nCells intersecting bbox ({west},{south},{east},{north}): {len(hits)}")
        for c in sorted(hits, key=lambda c: (c.band, c.name)):
            print(f"  {c.name}  INTU={c.intu}  band={c.band}  bounds={c.bounds_str()}")

    else:
        print("Provide --point or --bbox")
        sys.exit(1)


def cmd_download(args: argparse.Namespace) -> None:
    """Download ENC cells from NOAA."""
    output_dir = Path(args.output)

    if args.cell:
        cells = args.cell
    elif args.region:
        if args.region not in REGIONS:
            print(f"Unknown region: {args.region}")
            print(f"Available regions: {', '.join(REGIONS)}")
            sys.exit(1)
        cells = get_region_cells(args.region)
        print(f"Downloading {len(cells)} cells for region '{args.region}'...")
    else:
        # Default: boston-test
        cells = get_region_cells("boston-test")
        print(f"Downloading {len(cells)} boston-test cells (default)...")

    # Filter to cells that need downloading
    to_download = []
    skipped = 0
    for cell_name in cells:
        # NOAA zips extract to {cell}/ or ENC_ROOT/{cell}/
        enc_files = list(output_dir.rglob(f"{cell_name}/{cell_name}.000"))
        if enc_files:
            skipped += 1
        else:
            to_download.append(cell_name)

    if skipped:
        print(f"Skipping {skipped} already-downloaded cells")

    if not to_download:
        print("All cells already downloaded")
        return

    max_workers = min(8, args.jobs if args.jobs else 8)
    print(f"Downloading {len(to_download)} cells ({max_workers} parallel)...")

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(download_enc_cell, cell_name, output_dir): cell_name
            for cell_name in to_download
        }
        done = 0
        failed = 0
        for future in as_completed(futures):
            cell_name = futures[future]
            try:
                result = future.result()
                if result:
                    done += 1
                else:
                    failed += 1
            except Exception as e:
                print(f"Error downloading {cell_name}: {e}")
                failed += 1

    print(f"Downloaded {done} cells ({failed} failed, {skipped} skipped)")


def cmd_convert(args: argparse.Namespace) -> None:
    """Convert a single ENC file to GeoJSON + PMTiles."""
    enc_path = Path(args.input)
    output_dir = Path(args.output)

    if not enc_path.exists():
        print(f"Error: {enc_path} not found")
        sys.exit(1)

    print(f"Converting {enc_path.name}...")
    geojson_dir = output_dir / "geojson"
    geojson_files = convert_enc(enc_path, geojson_dir)

    if not geojson_files:
        print("No layers converted")
        sys.exit(1)

    print(f"\nTiling {len(geojson_files)} layers...")
    tiles_dir = output_dir / "tiles"
    pmtiles = tile_geojson_files(geojson_dir, tiles_dir)

    if pmtiles:
        merged = output_dir / f"{enc_path.stem.lower()}.pmtiles"
        merge_tiles(pmtiles, merged)


def _process_cell(
    enc_path: Path,
    work_dir: Path,
    force: bool,
    intu_zoom_ranges: dict[int, tuple[int, int, int]] | None = None,
) -> tuple[list[Path], int]:
    """Process a single ENC cell: convert → tile.

    Returns:
        Tuple of (list of PMTiles paths, scale_band).
    """
    cell_name = enc_path.stem
    cell_dir = work_dir / cell_name
    geojson_dir = cell_dir / "geojson"
    tiles_dir = cell_dir / "tiles"

    # Determine cell's scale band and zoom range
    cell_intu = read_intended_use(enc_path)
    min_zoom, max_zoom = 0, 14
    scale_band = 0
    if cell_intu is not None:
        min_zoom, max_zoom = intu_to_zoom_range(cell_intu, intu_zoom_ranges)
        scale_band = intu_to_scale_band(cell_intu)
    else:
        cell_cscl = read_compilation_scale(enc_path)
        if cell_cscl is not None:
            min_zoom, max_zoom = cscl_to_zoom_range(cell_cscl)
            scale_band = cscl_to_scale_band(cell_cscl)

    # Incremental: skip if tiles are newer than source
    if not force:
        existing_tiles = list(tiles_dir.glob("*.pmtiles")) if tiles_dir.exists() else []
        if existing_tiles and all(
            t.stat().st_mtime > enc_path.stat().st_mtime for t in existing_tiles
        ):
            print(f"Skipping {cell_name} (tiles up to date)")
            return existing_tiles, scale_band

    # Convert to GeoJSON and tile
    print(f"Processing {cell_name} (z{min_zoom}-{max_zoom}, band {scale_band})...")
    geojson_files = convert_enc(
        enc_path, geojson_dir, intu_zoom_ranges=intu_zoom_ranges
    )
    if not geojson_files:
        return [], scale_band

    tiles = tile_geojson_files(
        geojson_dir, tiles_dir, min_zoom=min_zoom, max_zoom=max_zoom,
    )
    return tiles, scale_band


def _find_enc_files(args: argparse.Namespace) -> list[Path]:
    """Resolve ENC files from --region or --input args."""
    if args.region:
        if args.region not in REGIONS:
            print(f"Unknown region: {args.region}")
            print(f"Available regions: {', '.join(REGIONS)}")
            sys.exit(1)
        cell_list = get_region_cells(args.region)
        input_dir = Path(args.input)
        enc_files = []
        for cell_name in cell_list:
            found = list(input_dir.rglob(f"{cell_name}/*.000"))
            if found:
                enc_files.extend(found)
            else:
                print(f"Warning: cell {cell_name} not found in {input_dir}")
        print(f"Region '{args.region}': {len(enc_files)} of {len(cell_list)} cells available")
    else:
        input_dir = Path(args.input)
        enc_files = list(input_dir.rglob("*.000"))

    if not enc_files:
        print("No .000 files found")
        sys.exit(1)

    if args.min_cells and len(enc_files) < args.min_cells:
        print(
            f"Error: only {len(enc_files)} cells found, "
            f"but --min-cells requires {args.min_cells}. "
            f"Run download first?"
        )
        sys.exit(1)

    return enc_files


def _build_composite_sources(
    enc_files: list[Path],
    cell_coverage: dict[Path, "BaseGeometry"],
    work_dir: Path,
) -> list[CellTileSource]:
    """Build CellTileSource list from existing per-cell tiles in work_dir."""
    from shapely.geometry import box as shapely_box

    sources: list[CellTileSource] = []
    for enc_path in enc_files:
        cell_name = enc_path.stem
        tiles_dir = work_dir / cell_name / "tiles"
        if not tiles_dir.exists():
            continue

        pmtiles_list = list(tiles_dir.glob("*.pmtiles"))
        if not pmtiles_list:
            continue

        # Determine band
        intu = read_intended_use(enc_path)
        if intu is not None:
            band = intu_to_scale_band(intu)
        else:
            cscl = read_compilation_scale(enc_path)
            band = cscl_to_scale_band(cscl) if cscl is not None else 0

        coverage = cell_coverage.get(enc_path)
        if coverage is None:
            coverage = shapely_box(-180, -90, 180, 90)

        cell_name = enc_path.stem
        for pt in pmtiles_list:
            sources.append(CellTileSource(
                pmtiles_path=pt,
                band=band,
                coverage=coverage,
                cell_name=cell_name,
            ))

    return sources


def cmd_pipeline(args: argparse.Namespace) -> None:
    """Full pipeline: convert ENC files to a single PMTiles."""
    output_path = Path(args.output)
    enc_files = _find_enc_files(args)
    composite_only = getattr(args, "composite_only", False)
    work_dir = Path("data/work")

    # Pass 1: Scan INTU values and M_COVR coverage polygons
    print("Pass 1: Scanning INTU values and M_COVR coverage...")
    present_intus: set[int] = set()
    cell_bands: dict[Path, int] = {}
    for enc_path in enc_files:
        intu = read_intended_use(enc_path)
        if intu is not None:
            present_intus.add(intu)
            cell_bands[enc_path] = intu_to_scale_band(intu)
        else:
            cell_cscl = read_compilation_scale(enc_path)
            if cell_cscl is not None:
                cell_bands[enc_path] = cscl_to_scale_band(cell_cscl)
            else:
                cell_bands[enc_path] = 0

    zoom_shift = getattr(args, "zoom_shift", 0)
    intu_zoom_ranges = compute_intu_zoom_ranges(present_intus, zoom_shift=zoom_shift)
    if intu_zoom_ranges:
        print(f"  INTU bands present: {sorted(present_intus)}")
        for intu, (zmin, zmax, band) in sorted(intu_zoom_ranges.items()):
            print(f"    INTU {intu}: z{zmin}-{zmax} (band {band})")
    else:
        print("  No INTU values found; falling back to CSCL-based zoom")

    # Build per-cell M_COVR coverage
    cell_coverage = build_cell_coverage(enc_files)
    cells_with_coverage = len(cell_coverage)
    cells_without = len(enc_files) - cells_with_coverage
    print(f"  M_COVR: {cells_with_coverage} cells with coverage")
    if cells_without:
        print(f"  Warning: {cells_without} cells without M_COVR")

    # Pass 2: Convert and tile each cell independently
    if not composite_only:
        max_workers = max(1, args.jobs if args.jobs else (os.cpu_count() or 4) - 3)
        print(f"\nPass 2: Processing {len(enc_files)} ENC files ({max_workers} parallel workers)")

        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {
                executor.submit(
                    _process_cell, enc_path, work_dir, args.force, intu_zoom_ranges,
                ): enc_path
                for enc_path in enc_files
            }
            for future in as_completed(futures):
                enc_path = futures[future]
                try:
                    future.result()
                except Exception as e:
                    print(f"Error processing {enc_path.stem}: {e}")
    else:
        print("\nPass 2: Skipped (--composite-only)")

    # Pass 3: Composite tiles using M_COVR coverage
    sources = _build_composite_sources(enc_files, cell_coverage, work_dir)
    if not sources:
        print("No tiles found to composite")
        sys.exit(1)

    # Parse debug-latlon if provided
    debug_latlon = None
    debug_latlon_str = getattr(args, "debug_latlon", None)
    if debug_latlon_str:
        parts = [float(x.strip()) for x in debug_latlon_str.split(",")]
        if len(parts) != 2:
            print("--debug-latlon must be lat,lon (e.g. '43.02,-70.54')")
            sys.exit(1)
        debug_latlon = (parts[0], parts[1])

    print(f"\n=== Compositing: {len(sources)} tile sets ===")
    composite_tiles(sources, output_path, debug_latlon=debug_latlon)


def main() -> None:
    """Main CLI entry point."""
    parser = argparse.ArgumentParser(
        prog="s57_pipeline",
        description="S-57 ENC → PMTiles vector tile pipeline",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    # list-cells
    lc = subparsers.add_parser("list-cells", help="List ENC cells for a region")
    lc.add_argument("--region", "-r", help="Named region (e.g. boston-test, new-england)")
    lc.add_argument("--bbox", "-b", help="Bounding box: west,south,east,north")
    lc.set_defaults(func=cmd_list_cells)

    # query
    qr = subparsers.add_parser("query", help="Query cell coverage at a point or bbox")
    qr.add_argument("--input", "-i", default="data/enc", help="Directory with .000 files")
    qr.add_argument("--point", "-p", help="lat,lon to query (e.g. '44.38,-67.69')")
    qr.add_argument("--bbox", "-b", help="Bounding box: west,south,east,north")
    qr.add_argument(
        "--nearby", "-n", action="store_true",
        help="Also show nearby cells (even if exact matches found)",
    )
    qr.add_argument(
        "--radius", type=float, default=0.5,
        help="Search radius in degrees for nearby cells (default: 0.5)",
    )
    qr.set_defaults(func=cmd_query)

    # download
    dl = subparsers.add_parser("download", help="Download ENC cells from NOAA")
    dl.add_argument("--output", "-o", default="data/enc", help="Output directory")
    dl.add_argument("--cell", "-c", action="append", help="Cell name (repeatable)")
    dl.add_argument("--region", "-r", help="Named region (e.g. boston-test, new-england)")
    dl.add_argument(
        "--jobs", "-j", type=int, default=0,
        help="Parallel downloads (default: 8)",
    )
    dl.set_defaults(func=cmd_download)

    # convert
    cv = subparsers.add_parser("convert", help="Convert a single ENC to PMTiles")
    cv.add_argument("--input", "-i", required=True, help="Path to .000 file")
    cv.add_argument("--output", "-o", default="data/tiles", help="Output directory")
    cv.set_defaults(func=cmd_convert)

    # pipeline
    pl = subparsers.add_parser("pipeline", help="Full pipeline for all ENCs in a dir")
    pl.add_argument("--input", "-i", default="data/enc", help="Directory with .000 files")
    pl.add_argument(
        "--output", "-o", default="data/nautical.pmtiles", help="Output PMTiles path"
    )
    pl.add_argument("--region", "-r", help="Named region to filter cells")
    pl.add_argument("--force", "-f", action="store_true", help="Force rebuild all cells")
    pl.add_argument(
        "--min-cells", type=int, default=0, help="Minimum number of cells required"
    )
    pl.add_argument(
        "--jobs", "-j", type=int, default=0,
        help="Parallel workers (default: half of CPU cores, 0=auto)",
    )
    pl.add_argument(
        "--zoom-shift", type=int, default=2,
        help="Shift INTU zoom ranges down by N levels for more detail (default: 2)",
    )
    pl.add_argument(
        "--composite-only", action="store_true",
        help="Skip convert/tile, only re-run compositing from existing tiles",
    )
    pl.add_argument(
        "--debug-latlon",
        help="lat,lon to debug compositing (e.g. '43.02,-70.54')",
    )
    pl.set_defaults(func=cmd_pipeline)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
