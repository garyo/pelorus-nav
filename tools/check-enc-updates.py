#!/usr/bin/env python3
"""Check NOAA ENC cells for updates and optionally rebuild + upload.

Sends parallel HTTP HEAD requests to NOAA for each cell in the specified
regions, compares Last-Modified dates against a local state file, and
reports which cells have changed.

Usage:
  uv run python tools/check-enc-updates.py [--rebuild] [--upload] [--region REGION] [--quiet] [-j N]

Options:
  --rebuild   Re-download changed cells, rebuild tiles, and update state
  --upload    Upload rebuilt PMTiles to R2 (implies --rebuild)
  --region R  Check only this region (default: all production regions)
  --quiet     Only print if there are changes
  -j N        Parallel HTTP requests (default: 20)

State is stored in tools/s57-pipeline/data/enc-update-state.json
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen

# Adjust path so we can import pipeline modules
TOOLS_DIR = Path(__file__).resolve().parent
PIPELINE_DIR = TOOLS_DIR / "s57-pipeline"
sys.path.insert(0, str(PIPELINE_DIR))

from s57_pipeline.regions import REGIONS, get_region_cells  # noqa: E402

NOAA_BASE = "https://charts.noaa.gov/ENCs"
STATE_FILE = PIPELINE_DIR / "data" / "enc-update-state.json"
OUTPUT_DIR = TOOLS_DIR.parent / "public"


def check_cell(
    cell: str, stored_date: str, timeout: int = 15
) -> tuple[str, str, str]:
    """Check a single cell via HTTP HEAD.

    Returns (cell, status, last_modified) where status is one of:
      "unchanged", "changed", "new", "error:<reason>"
    """
    url = f"{NOAA_BASE}/{cell}.zip"
    try:
        req = Request(url, method="HEAD")
        with urlopen(req, timeout=timeout) as resp:
            last_modified = resp.headers.get("Last-Modified", "")
            if not stored_date:
                return (cell, "new", last_modified)
            if last_modified != stored_date:
                return (cell, "changed", last_modified)
            return (cell, "unchanged", last_modified)
    except URLError as e:
        return (cell, f"error:{e.reason}", "")
    except Exception as e:
        return (cell, f"error:{e}", "")


def run_cmd(args: list[str], cwd: Path | None = None) -> None:
    """Run a subprocess, streaming output."""
    subprocess.run(args, cwd=cwd, check=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--rebuild", action="store_true",
                        help="Re-download changed cells and rebuild tiles")
    parser.add_argument("--upload", action="store_true",
                        help="Upload rebuilt PMTiles to R2 (implies --rebuild)")
    parser.add_argument("--region", action="append", dest="regions",
                        help="Check only this region (repeatable)")
    parser.add_argument("--quiet", action="store_true",
                        help="Only print if there are changes")
    parser.add_argument("-j", "--parallel", type=int, default=20,
                        help="Concurrent HTTP requests (default: 20)")
    args = parser.parse_args()

    if args.upload:
        args.rebuild = True

    # Default: all production regions
    if not args.regions:
        args.regions = [r for r in REGIONS if r != "boston-test"]

    for r in args.regions:
        if r not in REGIONS:
            print(f"Unknown region: {r}", file=sys.stderr)
            sys.exit(1)

    # Load state
    if STATE_FILE.exists():
        state = json.loads(STATE_FILE.read_text())
    else:
        state = {}

    # Collect cells per region (deduplicate across regions for HTTP checks)
    region_cells: dict[str, list[str]] = {}
    all_cells: dict[str, list[str]] = {}  # cell -> regions it belongs to
    for region_name in args.regions:
        cells = get_region_cells(region_name)
        region_cells[region_name] = cells
        for c in cells:
            all_cells.setdefault(c, []).append(region_name)

    unique_cells = list(all_cells.keys())
    total = len(unique_cells)
    if not args.quiet:
        print(
            f"Checking {total} unique cells across {len(args.regions)} regions "
            f"({args.parallel} parallel)..."
        )

    # Parallel HTTP HEAD checks
    results: dict[str, tuple[str, str]] = {}
    checked = 0

    with ThreadPoolExecutor(max_workers=args.parallel) as pool:
        futures = {
            pool.submit(
                check_cell, cell, state.get(cell, {}).get("last_modified", "")
            ): cell
            for cell in unique_cells
        }
        for future in as_completed(futures):
            cell, status, last_modified = future.result()
            results[cell] = (status, last_modified)
            checked += 1
            if not args.quiet and checked % 200 == 0:
                print(f"  ... checked {checked} / {total}")

    # Summarize per region
    total_changed = 0
    changed_regions: list[str] = []
    updates: dict[str, str] = {}

    for region_name in args.regions:
        cells = region_cells[region_name]
        region_new = 0
        region_changed = 0
        region_errors = 0

        for cell in cells:
            status, last_modified = results[cell]
            if status == "new":
                region_new += 1
                updates[cell] = last_modified
            elif status == "changed":
                region_changed += 1
                updates[cell] = last_modified
                if not args.quiet:
                    old = state.get(cell, {}).get("last_modified", "")
                    print(f"  UPDATED: {cell} (was: {old}, now: {last_modified})")
            elif status.startswith("error"):
                region_errors += 1
                if not args.quiet:
                    print(f"  ERROR: {cell} ({status})")

        region_total = region_changed + region_new
        total_changed += region_total

        if region_total > 0:
            changed_regions.append(region_name)

        if not args.quiet:
            parts = []
            if region_changed:
                parts.append(f"{region_changed} changed")
            if region_new:
                parts.append(f"{region_new} new (no prior state)")
            if parts:
                print(f"{region_name}: {', '.join(parts)} of {len(cells)} cells")
            else:
                print(f"{region_name}: all {len(cells)} cells up to date")
            if region_errors:
                print(f"  ({region_errors} errors)")

    print(f"\nSummary: {total_changed} changed out of {total} cells checked")

    # Update state file
    if updates:
        for cell, date in updates.items():
            state[cell] = {"last_modified": date}
        STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        STATE_FILE.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n")
        print(f"State file updated: {len(updates)} cells")
    else:
        print("No updates needed.")
        return

    if not args.rebuild:
        print("\nRun with --rebuild to download changes and rebuild tiles.")
        return

    # Rebuild changed regions
    print("\n=== Rebuilding changed regions ===")
    for region_name in changed_regions:
        print(f"\n--- Downloading {region_name} ---")
        run_cmd(
            ["uv", "run", "python", "-m", "s57_pipeline", "download",
             "--region", region_name],
            cwd=PIPELINE_DIR,
        )

        print(f"\n--- Building {region_name} ---")
        run_cmd(
            ["bash", str(TOOLS_DIR / "build-tiles.sh"), region_name],
            cwd=TOOLS_DIR.parent,
        )

    if args.upload:
        print("\n=== Uploading to R2 ===")
        run_cmd(
            ["bash", str(TOOLS_DIR / "upload-tiles.sh")],
            cwd=TOOLS_DIR.parent,
        )

    print(f"\nDone! Rebuilt regions: {', '.join(changed_regions)}")


if __name__ == "__main__":
    main()
