#!/usr/bin/env python3
"""Check NOAA ENC cells for updates.

Pure checker + state manager. No orchestration — build-tiles.sh handles that.

Usage:
  uv run python tools/check-enc-updates.py [--region R] [--json] [--quiet]
      [--pending-builds | --seed-from-catalog]

Options:
  (default)            Human-readable change report
  --json               Machine-readable output for build-tiles.sh
  --pending-builds     List regions with downloaded data not yet built
  --seed-from-catalog  One-time baseline adoption (see below)
  --region R           Check only this region (repeatable)
  --quiet              Minimal output

A region's cells are the Active cells of NOAA's product catalog
(ENCProdCat.xml, one download) that intersect it (see regions.py). A cell
counts as changed when the catalog lists an edition/update for it that
differs from the version recorded in tile-data/pipeline-state.db. Cells with
no recorded version, such as cells NOAA newly published, are "new" and
trigger a rebuild. A cell NOAA cancels drops out of its regions, which are
rebuilt without it.

A cell's version is recorded only when the pipeline's download step fetches
it, so a cell that fails to download stays changed and is retried on the
next run. A region is also reported as changed while its tiles lag its
downloaded data or its cell list, or one of its cells failed to build (see
state.region_needs_build), so a build interrupted after its download is
finished on the next run.

--pending-builds, run by build-tiles.sh after downloading, prints the
selected regions whose downloaded data is not yet built, one per line, so a
region is rebuilt only when a download brought new data. Cells still behind
the catalog (their download failed) are listed on stderr.

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
import math
import sys
from collections import Counter
from pathlib import Path

# Adjust path so we can import pipeline modules
TOOLS_DIR = Path(__file__).resolve().parent
PIPELINE_DIR = TOOLS_DIR / "s57-pipeline"
sys.path.insert(0, str(PIPELINE_DIR))

from s57_pipeline.enc_catalog import (  # noqa: E402
    CATALOG_MAX_AGE_S,
    CatalogCell,
    CatalogError,
    CellStatus,
    classify_cell,
    load_product_catalog,
)
from s57_pipeline.regions import (  # noqa: E402
    REGIONS,
    Catalog,
    get_region_build_cells,
    get_region_cells,
)
from s57_pipeline.state import StateDB, region_needs_build  # noqa: E402

DATA_DIR = PIPELINE_DIR / "data"
CATALOG_CACHE = DATA_DIR / "ENCProdCat.xml"
# Statuses of cells whose catalog version has not been downloaded yet.
BEHIND = (CellStatus.CHANGED, CellStatus.NEW)


def _open_db() -> StateDB:
    return StateDB(DATA_DIR / "pipeline-state.db")


def _load_catalog(max_age_s: float) -> dict[str, CatalogCell]:
    try:
        return load_product_catalog(CATALOG_CACHE, max_age_s=max_age_s)
    except CatalogError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


def _unbuilt_regions(build_cells: dict[str, list[str]], db: StateDB) -> list[str]:
    return [r for r, cl in build_cells.items() if region_needs_build(r, db, cl)]


def pending_builds(
    catalog: Catalog, build_cells: dict[str, list[str]], cells: list[str]
) -> None:
    with _open_db() as db:
        recorded = db.get_all_enc_versions()
        pending = _unbuilt_regions(build_cells, db)
    behind = [
        c for c in cells if classify_cell(recorded.get(c), catalog.get(c)) in BEHIND
    ]
    if behind:
        print(
            f"!!! {len(behind)} ENC cells failed to download "
            f"(retried next run): {', '.join(behind)}",
            file=sys.stderr,
        )
    for region in pending:
        print(region)


def seed_from_catalog(catalog: Catalog, cells: list[str]) -> None:
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
    catalog: Catalog,
    region_cells: dict[str, list[str]],
    build_cells: dict[str, list[str]],
    cells: list[str],
    as_json: bool,
    quiet: bool,
) -> None:
    report = not quiet and not as_json
    if report:
        print(
            f"Checking {len(cells)} unique cells across {len(region_cells)} "
            "regions against the NOAA product catalog..."
        )
    with _open_db() as db:
        recorded = db.get_all_enc_versions()
        legacy = db.legacy_noaa_state()
        unbuilt = _unbuilt_regions(build_cells, db)
        dropped = {
            r: sorted(db.get_region_cell_snapshot(r).keys() - set(cl))
            for r, cl in build_cells.items()
        }

    status = {c: classify_cell(recorded.get(c), catalog.get(c)) for c in cells}
    behind = {c for c in cells if status[c] in BEHIND}

    changed_regions: list[str] = []
    for region_name, region_cell_list in region_cells.items():
        counts = Counter(status[c] for c in region_cell_list)
        if region_name in unbuilt or any(c in behind for c in region_cell_list):
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
        if dropped[region_name]:
            print(
                f"  {len(dropped[region_name])} cells dropped since the last build: "
                f"{', '.join(dropped[region_name])}"
            )
        if region_name in unbuilt:
            print(
                "  (tiles lag the cell list or downloaded data, or a cell build failed)"
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
                    "total_changed": len(behind),
                }
            )
        )
    else:
        print(f"\nSummary: {len(behind)} changed out of {len(cells)} cells")
        if behind:
            print(f"{len(behind)} cells have updates available.")
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
        "--pending-builds",
        action="store_true",
        help="List regions with downloaded data not yet built (no check performed)",
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

    # --pending-builds reuses the cached catalog, whatever its age: it is the
    # one the download just used.
    catalog = _load_catalog(
        math.inf if args.pending_builds else CATALOG_MAX_AGE_S
    )
    region_cells = {r: get_region_cells(r, catalog) for r in regions}
    build_cells = {r: get_region_build_cells(r, catalog) for r in regions}
    cells = list(dict.fromkeys(c for cl in region_cells.values() for c in cl))

    if args.pending_builds:
        pending_builds(catalog, build_cells, cells)
    elif args.seed_from_catalog:
        seed_from_catalog(catalog, cells)
    else:
        check(catalog, region_cells, build_cells, cells, args.json, args.quiet)


if __name__ == "__main__":
    main()
