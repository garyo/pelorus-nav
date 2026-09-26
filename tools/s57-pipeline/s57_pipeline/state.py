"""Pipeline state database for minimal rebuild tracking.

SQLite-backed state that tracks each cell's ENC version (NOAA edition and
update, see enc_catalog.py), scan metadata, cell build state, and region
composite state, enabling the pipeline to skip unchanged cells and regions.
"""

from __future__ import annotations

import hashlib
import json
import subprocess
import threading
from collections.abc import Iterable, Mapping
from datetime import datetime, timezone
from pathlib import Path
from typing import NamedTuple

from .enc_catalog import enc_version_key

# Bump when enrichment logic (enrich.py, s52_metadata.py, labels.py, symbols.py)
# changes in a way not captured by LAYER_CONFIGS or tippecanoe version.
PIPELINE_VERSION = 5

SCHEMA_VERSION = 2

# Tables that record the ENC version a cell's derived data was produced from.
_ENC_VERSION_TABLES = ("cell_build_state", "region_cell_snapshot", "cell_scan_cache")


class SeedResult(NamedTuple):
    """Rows touched by StateDB.seed_enc_versions."""

    cells: int
    builds: int
    snapshots: int
    scans: int


class StateDB:
    """SQLite-backed pipeline state database."""

    def __init__(self, db_path: Path | None = None) -> None:
        import sqlite3

        if db_path is None:
            db_path = Path("data/pipeline-state.db")
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(db_path), check_same_thread=False)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._lock = threading.Lock()
        self._init_schema()

    def _init_schema(self) -> None:
        with self._lock, self._conn:
            self._conn.executescript("""
                CREATE TABLE IF NOT EXISTS schema_version (
                    version INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS cell_enc_version (
                    cell_name       TEXT PRIMARY KEY,
                    edition         INTEGER NOT NULL,
                    update_number   INTEGER NOT NULL,
                    checked_at      TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS cell_scan_cache (
                    cell_name       TEXT PRIMARY KEY,
                    enc_version     TEXT NOT NULL,
                    intu            INTEGER,
                    cscl            INTEGER,
                    scale_band      INTEGER NOT NULL,
                    coverage_wkb    BLOB,
                    scanned_at      TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS cell_build_state (
                    cell_name       TEXT PRIMARY KEY,
                    enc_version     TEXT NOT NULL,
                    config_hash     TEXT NOT NULL,
                    built_at        TEXT NOT NULL,
                    tile_count      INTEGER,
                    success         INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS region_composite_state (
                    region_name     TEXT PRIMARY KEY,
                    config_hash     TEXT NOT NULL,
                    composited_at   TEXT NOT NULL,
                    output_size     INTEGER,
                    output_checksum TEXT,
                    success         INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS region_cell_snapshot (
                    region_name     TEXT NOT NULL,
                    cell_name       TEXT NOT NULL,
                    enc_version     TEXT NOT NULL,
                    config_hash     TEXT NOT NULL,
                    PRIMARY KEY (region_name, cell_name)
                );

                CREATE TABLE IF NOT EXISTS region_upload_state (
                    region_name     TEXT PRIMARY KEY,
                    uploaded_at     TEXT NOT NULL,
                    output_checksum TEXT NOT NULL,
                    r2_key          TEXT NOT NULL
                );
            """)
            row = self._conn.execute(
                "SELECT version FROM schema_version LIMIT 1"
            ).fetchone()
            if row is None:
                self._conn.execute(
                    "INSERT INTO schema_version (version) VALUES (?)",
                    (SCHEMA_VERSION,),
                )
            elif row[0] < SCHEMA_VERSION:
                self._migrate(row[0])

    def _migrate(self, from_version: int) -> None:
        """Upgrade an existing database to SCHEMA_VERSION (caller holds the lock).

        v2 keys cells by ENC edition/update instead of the zip Last-Modified
        date: the ``noaa_date`` columns become ``enc_version``, and the old
        ``cell_noaa_state`` table is kept, read only by seed_enc_versions.
        """
        if from_version < 2:
            for table in _ENC_VERSION_TABLES:
                self._conn.execute(
                    f"ALTER TABLE {table} RENAME COLUMN noaa_date TO enc_version"
                )
        self._conn.execute("UPDATE schema_version SET version = ?", (SCHEMA_VERSION,))

    def close(self) -> None:
        self._conn.close()

    def __enter__(self) -> StateDB:
        return self

    def __exit__(self, *args: object) -> None:
        self.close()

    # ── ENC versions ─────────────────────────────────────────────────────

    def get_enc_version(self, cell_name: str) -> str | None:
        """Return the cell's recorded version key ("edition.update") or None."""
        row = self._conn.execute(
            "SELECT edition, update_number FROM cell_enc_version WHERE cell_name = ?",
            (cell_name,),
        ).fetchone()
        return enc_version_key(row[0], row[1]) if row else None

    def get_all_enc_versions(self) -> dict[str, str]:
        """Return {cell_name: version key} for all cells."""
        rows = self._conn.execute(
            "SELECT cell_name, edition, update_number FROM cell_enc_version"
        ).fetchall()
        return {name: enc_version_key(ed, up) for name, ed, up in rows}

    def set_enc_version(
        self,
        cell_name: str,
        edition: int,
        update: int,
        checked_at: str | None = None,
    ) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                """INSERT OR REPLACE INTO cell_enc_version
                   (cell_name, edition, update_number, checked_at)
                   VALUES (?, ?, ?, ?)""",
                (cell_name, edition, update, checked_at or _now_iso()),
            )

    def legacy_noaa_state(self) -> dict[str, str]:
        """Return {cell_name: Last-Modified} from a pre-v2 database, else {}."""
        exists = self._conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='cell_noaa_state'"
        ).fetchone()
        if not exists:
            return {}
        rows = self._conn.execute(
            "SELECT cell_name, last_modified FROM cell_noaa_state"
        ).fetchall()
        return {name: date for name, date in rows}

    def seed_enc_versions(self, versions: Mapping[str, tuple[int, int]]) -> SeedResult:
        """Adopt catalog versions as the baseline for cells tracked by date.

        For each cell that has a legacy Last-Modified entry but no recorded
        version, records ``versions[cell]`` (edition, update) and relabels the
        cell's build, snapshot and scan rows that were produced from that
        Last-Modified download with the new version key, so they stay clean.
        Rows produced from anything else keep their old label and stay dirty.
        Cells already versioned, or never tracked, are left alone, which
        makes seeding safe to repeat.
        """
        legacy = self.legacy_noaa_state()
        recorded = self.get_all_enc_versions()
        now = _now_iso()
        cells = 0
        touched = dict.fromkeys(_ENC_VERSION_TABLES, 0)
        with self._lock, self._conn:
            for cell_name, (edition, update) in versions.items():
                last_modified = legacy.get(cell_name)
                if last_modified is None or cell_name in recorded:
                    continue
                key = enc_version_key(edition, update)
                self._conn.execute(
                    """INSERT INTO cell_enc_version
                       (cell_name, edition, update_number, checked_at)
                       VALUES (?, ?, ?, ?)""",
                    (cell_name, edition, update, now),
                )
                cells += 1
                for table in _ENC_VERSION_TABLES:
                    cur = self._conn.execute(
                        f"""UPDATE {table} SET enc_version = ?
                            WHERE cell_name = ? AND enc_version = ?""",
                        (key, cell_name, last_modified),
                    )
                    touched[table] += cur.rowcount
        return SeedResult(
            cells=cells,
            builds=touched["cell_build_state"],
            snapshots=touched["region_cell_snapshot"],
            scans=touched["cell_scan_cache"],
        )

    # ── Scan cache ───────────────────────────────────────────────────────

    def get_scan_cache(
        self, cell_name: str,
    ) -> tuple[str, int | None, int | None, int, bytes | None] | None:
        """Return (enc_version, intu, cscl, scale_band, coverage_wkb) or None."""
        row = self._conn.execute(
            """SELECT enc_version, intu, cscl, scale_band, coverage_wkb
               FROM cell_scan_cache WHERE cell_name = ?""",
            (cell_name,),
        ).fetchone()
        return row if row else None

    def set_scan_cache(
        self,
        cell_name: str,
        enc_version: str,
        intu: int | None,
        cscl: int | None,
        scale_band: int,
        coverage_wkb: bytes | None,
    ) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                """INSERT OR REPLACE INTO cell_scan_cache
                   (cell_name, enc_version, intu, cscl, scale_band, coverage_wkb, scanned_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (cell_name, enc_version, intu, cscl, scale_band, coverage_wkb, _now_iso()),
            )

    # ── Build state ──────────────────────────────────────────────────────

    def get_build_state(self, cell_name: str) -> tuple[str, str, bool] | None:
        """Return (enc_version, config_hash, success) or None."""
        row = self._conn.execute(
            "SELECT enc_version, config_hash, success FROM cell_build_state WHERE cell_name = ?",
            (cell_name,),
        ).fetchone()
        if row is None:
            return None
        return (row[0], row[1], bool(row[2]))

    def set_build_state(
        self,
        cell_name: str,
        enc_version: str,
        config_hash: str,
        tile_count: int,
        success: bool,
    ) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                """INSERT OR REPLACE INTO cell_build_state
                   (cell_name, enc_version, config_hash, built_at, tile_count, success)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (cell_name, enc_version, config_hash, _now_iso(), tile_count, int(success)),
            )

    def failed_build_cells(self) -> set[str]:
        """Return the cells whose last build failed."""
        rows = self._conn.execute(
            "SELECT cell_name FROM cell_build_state WHERE success = 0"
        ).fetchall()
        return {name for (name,) in rows}

    # ── Region composite state ───────────────────────────────────────────

    def get_composite_state(self, region_name: str) -> tuple[str, bool] | None:
        """Return (config_hash, success) or None."""
        row = self._conn.execute(
            "SELECT config_hash, success FROM region_composite_state WHERE region_name = ?",
            (region_name,),
        ).fetchone()
        if row is None:
            return None
        return (row[0], bool(row[1]))

    def set_composite_state(
        self,
        region_name: str,
        config_hash: str,
        output_size: int,
        output_checksum: str | None,
        success: bool,
    ) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                """INSERT OR REPLACE INTO region_composite_state
                   (region_name, config_hash, composited_at, output_size, output_checksum, success)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (region_name, config_hash, _now_iso(), output_size, output_checksum, int(success)),
            )

    def get_region_cell_snapshot(
        self, region_name: str,
    ) -> dict[str, tuple[str, str]]:
        """Return {cell_name: (enc_version, config_hash)} for a region."""
        rows = self._conn.execute(
            """SELECT cell_name, enc_version, config_hash
               FROM region_cell_snapshot WHERE region_name = ?""",
            (region_name,),
        ).fetchall()
        return {name: (version, chash) for name, version, chash in rows}

    def set_region_cell_snapshot(
        self, region_name: str, snapshot: dict[str, tuple[str, str]],
    ) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                "DELETE FROM region_cell_snapshot WHERE region_name = ?",
                (region_name,),
            )
            self._conn.executemany(
                """INSERT INTO region_cell_snapshot
                   (region_name, cell_name, enc_version, config_hash)
                   VALUES (?, ?, ?, ?)""",
                [
                    (region_name, cell_name, enc_version, config_hash)
                    for cell_name, (enc_version, config_hash) in snapshot.items()
                ],
            )


# ── Dirty checks ─────────────────────────────────────────────────────────


def is_cell_dirty(
    cell_name: str, db: StateDB, config_hash: str, work_dir: Path,
) -> bool:
    """Check whether a cell needs rebuilding."""
    build = db.get_build_state(cell_name)
    if build is None or not build[2]:  # no state or last build failed
        return True
    enc_version = db.get_enc_version(cell_name)
    if enc_version and build[0] != enc_version:  # new ENC edition/update
        return True
    if build[1] != config_hash:  # config changed
        return True
    # Sanity: tiles must exist on disk
    tiles_dir = work_dir / cell_name / "tiles"
    if not tiles_dir.exists() or not any(tiles_dir.glob("*.pmtiles")):
        return True
    return False


def is_region_dirty(
    region_name: str,
    db: StateDB,
    config_hash: str,
    region_cells: list[str],
) -> bool:
    """Check whether a region needs recompositing."""
    comp = db.get_composite_state(region_name)
    if comp is None or not comp[1]:  # no state or last composite failed
        return True
    if comp[0] != config_hash:  # config changed
        return True
    snapshot = db.get_region_cell_snapshot(region_name)
    for cell_name in region_cells:
        enc_version = db.get_enc_version(cell_name) or ""
        snap = snapshot.get(cell_name)
        if snap is None:  # new cell added to region
            return True
        if snap[0] != enc_version:  # new ENC edition/update
            return True
        if snap[1] != config_hash:  # config changed since last composite
            return True
    return False


def region_needs_build(
    region_name: str, db: StateDB, region_cells: Iterable[str]
) -> bool:
    """Check whether a region's tiles lag its downloaded ENC data.

    True when one of the region's cells last failed to build, or when a
    cell with a recorded version (set when a download succeeds) is
    missing from the region's last composite snapshot or was composited at
    another version. The snapshot's cells are compared too, since a
    composite also draws on overview cells of neighbouring regions.
    Cells without a recorded version are ignored, so a cell that has never
    downloaded cannot make its region look stale. Unlike is_region_dirty,
    configuration changes are not considered.
    """
    cells = set(region_cells)
    if cells & db.failed_build_cells():
        return True
    recorded = db.get_all_enc_versions()
    snapshot = db.get_region_cell_snapshot(region_name)
    for cell_name in cells | snapshot.keys():
        version = recorded.get(cell_name)
        snap = snapshot.get(cell_name)
        if version is not None and (snap is None or snap[0] != version):
            return True
    return False


# ── Config hash ──────────────────────────────────────────────────────────


def compute_config_hash(zoom_shift: int) -> str:
    """Compute a hash of pipeline configuration for dirty detection.

    Includes layer configs, tippecanoe version, zoom shift, and pipeline
    version. Changes to any of these force a full rebuild.
    """
    from .layers import LAYER_CONFIGS

    parts: list[str] = []
    for lc in LAYER_CONFIGS:
        parts.append(f"{lc.name}|{lc.group}|{' '.join(lc.tippecanoe_args)}")

    try:
        result = subprocess.run(
            ["tippecanoe", "--version"],
            capture_output=True, text=True,
        )
        tc_ver = result.stderr.strip() or result.stdout.strip()
    except FileNotFoundError:
        tc_ver = "tippecanoe:unknown"

    parts.append(tc_ver)
    parts.append(f"zoom_shift={zoom_shift}")
    parts.append(f"PIPELINE_VERSION={PIPELINE_VERSION}")

    return hashlib.sha256("\n".join(parts).encode()).hexdigest()[:12]


def compute_composite_hash(config_hash: str) -> str:
    """Hash for region composite state: the cell config hash plus the
    compositor's band policy, so a policy change re-composites every
    region without reconverting its cells."""
    from .scamin import COMPOSITE_PREFERRED_BAND, COMPOSITE_PREFERRED_LAYERS

    if not COMPOSITE_PREFERRED_BAND:
        return config_hash  # no policy: plain config hash, nothing to redo
    layers = sorted(COMPOSITE_PREFERRED_LAYERS or [])
    policy = json.dumps([COMPOSITE_PREFERRED_BAND, layers], sort_keys=True)
    return hashlib.sha256(f"{config_hash}\n{policy}".encode()).hexdigest()[:12]


# ── Helpers ──────────────────────────────────────────────────────────────


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
