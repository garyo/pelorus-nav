"""CLI entry point for the S-57 → PMTiles pipeline."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .convert import convert_enc
from .download import TEST_CELLS, download_enc_cell
from .merge import merge_tiles
from .tile import tile_geojson_files


def cmd_download(args: argparse.Namespace) -> None:
    """Download ENC cells from NOAA."""
    output_dir = Path(args.output)

    if args.cell:
        cells = args.cell
    else:
        # Download test cells
        cells = list(TEST_CELLS.keys())
        print(f"Downloading {len(cells)} test cells...")

    for cell_name in cells:
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
    """Full pipeline: convert all ENC files in a directory to a single PMTiles."""
    input_dir = Path(args.input)
    output_path = Path(args.output)

    enc_files = list(input_dir.rglob("*.000"))
    if not enc_files:
        print(f"No .000 files found in {input_dir}")
        sys.exit(1)

    print(f"Found {len(enc_files)} ENC files")

    all_pmtiles: list[Path] = []
    work_dir = input_dir / "work"

    for enc_path in enc_files:
        cell_name = enc_path.stem
        print(f"\n=== Processing {cell_name} ===")

        cell_dir = work_dir / cell_name
        geojson_dir = cell_dir / "geojson"
        tiles_dir = cell_dir / "tiles"

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

    # download
    dl = subparsers.add_parser("download", help="Download ENC cells from NOAA")
    dl.add_argument("--output", "-o", default="data/enc", help="Output directory")
    dl.add_argument("--cell", "-c", action="append", help="Cell name (repeatable)")
    dl.set_defaults(func=cmd_download)

    # convert
    cv = subparsers.add_parser("convert", help="Convert a single ENC to PMTiles")
    cv.add_argument("--input", "-i", required=True, help="Path to .000 file")
    cv.add_argument("--output", "-o", default="data/tiles", help="Output directory")
    cv.set_defaults(func=cmd_convert)

    # pipeline
    pl = subparsers.add_parser("pipeline", help="Full pipeline for all ENCs in a dir")
    pl.add_argument("--input", "-i", required=True, help="Directory with .000 files")
    pl.add_argument(
        "--output", "-o", default="data/nautical.pmtiles", help="Output PMTiles path"
    )
    pl.set_defaults(func=cmd_pipeline)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
