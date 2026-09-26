#!/usr/bin/env python3
"""Check NOAA ENC cells for updates.

Pure checker + state manager. No orchestration — build-tiles.sh handles that.

Usage:
  uv run python tools/check-enc-updates.py [--region R] [--json] [--quiet]
      [--save-state | --seed-from-catalog]

Options:
  (default)            Human-readable change report
  --json               Machine-readable output for build-tiles.sh
  --save-state         Record the versions seen by the last check as built
  --seed-from-catalog  One-time baseline adoption (see below)
  --region R           Check only this region (repeatable)
  --quiet              Minimal output

A cell counts as changed when NOAA's product catalog (ENCProdCat.xml, one
download) lists an edition/update for it that differs from the version
recorded in tile-data/pipeline-state.db. Cells the catalog lists as not
Active (e.g. Cancelled) or omits entirely are reported but never trigger a
rebuild, since NOAA publishes no new content for them. Cells with no
recorded version are "new" and trigger a rebuild.

The versions a check sees are saved to tile-data/enc-check-versions.json;
--save-state (run by build-tiles.sh after a successful build) records those,
not a later catalog, so an edition published mid-build is still reported
as changed on the next check.

--seed-from-catalog migrates a state DB that tracked cells by zip
Last-Modified date. For every cell of the selected regions that has such a
date but no recorded version, it records the current catalog version and
relabels the cell's existing build/scan state with it, so the next check
sees those cells as unchanged instead of rebuilding everything. Run it once,
only when the current tiles were built from the current NOAA data; it never
overwrites a recorded version, so repeating it is harmless.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

# Adjust path so we can import pipeline modules
TOOLS_DIR = Path(__file__).resolve().parent
PIPELINE_DIR = TOOLS_DIR / "s57-pipeline"
sys.path.insert(0, str(PIPELINE_DIR))

from s57_pipeline.enc_catalog import (  # noqa: E402
    CatalogCell,
    CatalogError,
    CellStatus,
    classify_cell,
    load_product_catalog,
)
from s57_pipeline.regions import REGIONS, get_region_cells  # noqa: E402
from s57_pipeline.state import StateDB  # noqa: E402

DATA_DIR = PIPELINE_DIR / "data"
CATALOG_CACHE = DATA_DIR / "ENCProdCat.xml"
# {cell: [edition, update]} as seen by the last check, applied by --save-state.
CHECK_VERSIONS_FILE = DATA_DIR / "enc-check-versions.json"


def _open_db() -> StateDB:
    return StateDB(DATA_DIR / "pipeline-state.db")


def _load_catalog() -> dict[str, CatalogCell]:
    try:
        return load_product_catalog(CATALOG_CACHE)
    except CatalogError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


def _read_check_versions() -> dict[str, tuple[int, int]]:
    try:
        raw = json.loads(CHECK_VERSIONS_FILE.read_text())
    except (OSError, json.JSONDecodeError):
        return {}
    return {cell: (int(v[0]), int(v[1])) for cell, v in raw.items()}


def _write_check_versions(catalog: dict[str, CatalogCell], cells: list[str]) -> None:
    """Merge this check's versions over earlier ones, so cells outside this
    run's regions keep their entries."""
    versions = _read_check_versions()
    for cell in cells:
        if entry := catalog.get(cell):
            versions[cell] = (entry.edition, entry.update)
    CHECK_VERSIONS_FILE.parent.mkdir(parents=True, exist_ok=True)
    CHECK_VERSIONS_FILE.write_text(json.dumps(versions, indent=0))


def save_state(cells: list[str], quiet: bool) -> None:
    """Record the check-time versions of `cells` as their built versions.

    Cells without a check-time version (manual run, fresh state) fall back
    to the current catalog.
    """
    check_versions = _read_check_versions()
    missing = [c for c in cells if c not in check_versions]
    fallback: dict[str, tuple[int, int]] = {}
    if missing:
        catalog = _load_catalog()
        fallback = {
            c: (entry.edition, entry.update)
            for c in missing
            if (entry := catalog.get(c))
        }

    with _open_db() as db:
        for cell in cells:
            version = check_versions.get(cell) or fallback.get(cell)
            if version:
                db.set_enc_version(cell, *version)

    if not quiet:
        applied = len(cells) - len(missing)
        print(
            f"State updated: {applied} cells from check-time versions, "
            f"{len(fallback)} from the current catalog"
        )


def seed_from_catalog(cells: list[str]) -> None:
    catalog = _load_catalog()
    versions = {
        c: (entry.edition, entry.update) for c in cells if (entry := catalog.get(c))
    }
    with _open_db() as db:
        result = db.seed_enc_versions(versions)
    print(
        f"Seeded {result.cells} of {len(cells)} cells with catalog versions; "
        f"relabelled {result.builds} build, {result.snapshots} snapshot and "
        f"{result.scans} scan-cache rows"
    )


def check(
    region_cells: dict[str, list[str]], cells: list[str], as_json: bool, quiet: bool
) -> None:
    report = not quiet and not as_json
    if report:
        print(
            f"Checking {len(cells)} unique cells across {len(region_cells)} "
            "regions against the NOAA product catalog..."
        )
    catalog = _load_catalog()
    with _open_db() as db:
        recorded = db.get_all_enc_versions()
        legacy = db.legacy_noaa_state()

    status = {c: classify_cell(recorded.get(c), catalog.get(c)) for c in cells}
    _write_check_versions(catalog, cells)

    changed_cells: set[str] = set()
    changed_regions: list[str] = []
    for region_name, region_cell_list in region_cells.items():
        counts = Counter(status[c] for c in region_cell_list)
        region_changed = [
            c
            for c in region_cell_list
            if status[c] in (CellStatus.CHANGED, CellStatus.NEW)
        ]
        changed_cells.update(region_changed)
        if region_changed:
            changed_regions.append(region_name)
        if not report:
            continue
        for c in region_cell_list:
            if status[c] == CellStatus.CHANGED:
                print(f"  UPDATED: {c} ({recorded[c]} -> {catalog[c].version})")
        parts = [
            f"{counts[s]} {label}"
            for s, label in (
                (CellStatus.CHANGED, "changed"),
                (CellStatus.NEW, "new (no recorded version)"),
            )
            if counts[s]
        ]
        total = len(region_cell_list)
        if parts:
            print(f"{region_name}: {', '.join(parts)} of {total} cells")
        else:
            print(f"{region_name}: all {total} cells up to date")
        if counts[CellStatus.INACTIVE] or counts[CellStatus.MISSING]:
            print(
                f"  ({counts[CellStatus.INACTIVE]} not Active in catalog, "
                f"{counts[CellStatus.MISSING]} not in catalog)"
            )

    unseeded = sum(1 for c in cells if status[c] == CellStatus.NEW and c in legacy)
    if unseeded:
        print(
            f"Note: {unseeded} cells are tracked only by zip date and count as new. "
            "If their tiles are current, adopt the catalog baseline once with: "
            f"{Path(__file__).name} --seed-from-catalog",
            file=sys.stderr,
        )

    if as_json:
        print(
            json.dumps(
                {
                    "changed_regions": changed_regions,
                    "total_checked": len(cells),
                    "total_changed": len(changed_cells),
                }
            )
        )
    else:
        print(f"\nSummary: {len(changed_cells)} changed out of {len(cells)} cells")
        if changed_cells:
            print(f"{len(changed_cells)} cells have updates available.")
        else:
            print("No updates needed.")


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--json", action="store_true", help="Machine-readable JSON output"
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--save-state",
        action="store_true",
        help="Record the versions seen by the last check (no check performed)",
    )
    mode.add_argument(
        "--seed-from-catalog",
        action="store_true",
        help="Adopt current catalog versions for date-tracked cells (one-time)",
    )
    parser.add_argument(
        "--region",
        action="append",
        dest="regions",
        help="Check only this region (repeatable)",
    )
    parser.add_argument("--quiet", action="store_true", help="Minimal output")
    args = parser.parse_args()

    # Default: all production regions
    regions: list[str] = args.regions or [r for r in REGIONS if r != "boston-test"]
    for r in regions:
        if r not in REGIONS:
            print(f"Unknown region: {r}", file=sys.stderr)
            sys.exit(1)

    region_cells = {r: get_region_cells(r) for r in regions}
    cells = list(dict.fromkeys(c for cl in region_cells.values() for c in cl))

    if args.save_state:
        save_state(cells, args.quiet)
    elif args.seed_from_catalog:
        seed_from_catalog(cells)
    else:
        check(region_cells, cells, args.json, args.quiet)


if __name__ == "__main__":
    main()
