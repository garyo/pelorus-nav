"""CLI entry point for the S-57 → PMTiles pipeline."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .convert import convert_enc
from .download import download_enc_cell
from .merge import merge_tiles
from .regions import REGIONS, get_region_cells, query_region
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

    for cell_name in cells:
        # Skip cells already downloaded
        cell_dir = output_dir / cell_name
        enc_files = list(cell_dir.glob("*.000")) if cell_dir.exists() else []
        if enc_files:
            print(f"Skipping {cell_name} (already exists)")
            continue
        download_enc_cell(cell_name, output_dir)


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


def cmd_pipeline(args: argparse.Namespace) -> None:
    """Full pipeline: convert ENC files to a single PMTiles."""
    output_path = Path(args.output)

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
        print(f"No .000 files found")
        sys.exit(1)

    if args.min_cells and len(enc_files) < args.min_cells:
        print(
            f"Error: only {len(enc_files)} cells found, "
            f"but --min-cells requires {args.min_cells}. "
            f"Run download first?"
        )
        sys.exit(1)

    print(f"Processing {len(enc_files)} ENC files")

    all_pmtiles: list[Path] = []
    work_dir = Path("data/work")

    for enc_path in enc_files:
        cell_name = enc_path.stem
        print(f"\n=== Processing {cell_name} ===")

        cell_dir = work_dir / cell_name
        geojson_dir = cell_dir / "geojson"
        tiles_dir = cell_dir / "tiles"

        # Incremental: skip if tiles are newer than source
        if not args.force:
            existing_tiles = list(tiles_dir.glob("*.pmtiles")) if tiles_dir.exists() else []
            if existing_tiles and all(
                t.stat().st_mtime > enc_path.stat().st_mtime for t in existing_tiles
            ):
                print(f"Skipping {cell_name} (tiles up to date)")
                all_pmtiles.extend(existing_tiles)
                continue

        geojson_files = convert_enc(enc_path, geojson_dir)
        if geojson_files:
            pmtiles = tile_geojson_files(geojson_dir, tiles_dir)
            all_pmtiles.extend(pmtiles)

    if all_pmtiles:
        print(f"\n=== Merging {len(all_pmtiles)} tile sets ===")
        merge_tiles(all_pmtiles, output_path)
    else:
        print("No tiles generated")
        sys.exit(1)


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

    # download
    dl = subparsers.add_parser("download", help="Download ENC cells from NOAA")
    dl.add_argument("--output", "-o", default="data/enc", help="Output directory")
    dl.add_argument("--cell", "-c", action="append", help="Cell name (repeatable)")
    dl.add_argument("--region", "-r", help="Named region (e.g. boston-test, new-england)")
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
    pl.set_defaults(func=cmd_pipeline)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
