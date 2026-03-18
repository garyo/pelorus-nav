#!/usr/bin/env python3
"""Check NOAA ENC cells for updates.

Pure checker + state manager. No orchestration — build-tiles.sh handles that.

Usage:
  uv run python tools/check-enc-updates.py [--region R] [--json] [--save-state] [--quiet] [-j N]

Options:
  (default)      Human-readable change report
  --json         Machine-readable output for build-tiles.sh
  --save-state   Update enc-update-state.json with current NOAA dates
  --region R     Check only this region (repeatable)
  --quiet        Minimal output
  -j N           Parallel requests (default: 20)

State is stored in tile-data/enc-update-state.json
"""

from __future__ import annotations

import argparse
import json
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


def load_state() -> dict[str, dict[str, str]]:
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text())
    return {}


def save_state(state: dict[str, dict[str, str]]) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--json", action="store_true",
        help="Machine-readable JSON output",
    )
    parser.add_argument(
        "--save-state", action="store_true",
        help="Update state file with current NOAA dates (no check performed)",
    )
    parser.add_argument(
        "--region", action="append", dest="regions",
        help="Check only this region (repeatable)",
    )
    parser.add_argument(
        "--quiet", action="store_true",
        help="Minimal output",
    )
    parser.add_argument(
        "-j", "--parallel", type=int, default=20,
        help="Concurrent HTTP requests (default: 20)",
    )
    args = parser.parse_args()

    # Default: all production regions
    if not args.regions:
        args.regions = [r for r in REGIONS if r != "boston-test"]

    for r in args.regions:
        if r not in REGIONS:
            print(f"Unknown region: {r}", file=sys.stderr)
            sys.exit(1)

    state = load_state()

    # Handle --save-state: re-check and write current dates
    if args.save_state:
        region_cells_map: dict[str, list[str]] = {}
        all_cells: dict[str, list[str]] = {}
        for region_name in args.regions:
            cells = get_region_cells(region_name)
            region_cells_map[region_name] = cells
            for c in cells:
                all_cells.setdefault(c, []).append(region_name)

        unique_cells = list(all_cells.keys())
        if not args.quiet:
            print(f"Fetching current dates for {len(unique_cells)} cells...")

        with ThreadPoolExecutor(max_workers=args.parallel) as pool:
            futures = {
                pool.submit(check_cell, cell, ""): cell
                for cell in unique_cells
            }
            for future in as_completed(futures):
                cell, _status, last_modified = future.result()
                if last_modified:
                    state[cell] = {"last_modified": last_modified}

        save_state(state)
        if not args.quiet:
            print(f"State file updated: {len(unique_cells)} cells")
        return

    # Collect cells per region
    region_cells_map = {}
    all_cells = {}
    for region_name in args.regions:
        cells = get_region_cells(region_name)
        region_cells_map[region_name] = cells
        for c in cells:
            all_cells.setdefault(c, []).append(region_name)

    unique_cells = list(all_cells.keys())
    total = len(unique_cells)
    if not args.quiet and not args.json:
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
            if not args.quiet and not args.json and checked % 200 == 0:
                print(f"  ... checked {checked} / {total}")

    # Summarize per region
    total_changed = 0
    changed_regions: list[str] = []

    for region_name in args.regions:
        cells = region_cells_map[region_name]
        region_new = 0
        region_changed = 0
        region_errors = 0

        for cell in cells:
            status, last_modified = results[cell]
            if status == "new":
                region_new += 1
            elif status == "changed":
                region_changed += 1
                if not args.quiet and not args.json:
                    old = state.get(cell, {}).get("last_modified", "")
                    print(f"  UPDATED: {cell} (was: {old}, now: {last_modified})")
            elif status.startswith("error"):
                region_errors += 1
                if not args.quiet and not args.json:
                    print(f"  ERROR: {cell} ({status})")

        region_total = region_changed + region_new
        total_changed += region_total

        if region_total > 0:
            changed_regions.append(region_name)

        if not args.quiet and not args.json:
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

    # Output
    if args.json:
        output = {
            "changed_regions": changed_regions,
            "total_checked": total,
            "total_changed": total_changed,
        }
        print(json.dumps(output))
    else:
        print(f"\nSummary: {total_changed} changed out of {total} cells checked")
        if not total_changed:
            print("No updates needed.")
        else:
            print(f"{total_changed} cells have updates available.")


if __name__ == "__main__":
    main()
