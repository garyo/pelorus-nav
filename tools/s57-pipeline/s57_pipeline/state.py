"""Pipeline state database for minimal rebuild tracking.

SQLite-backed state that tracks NOAA dates, scan metadata, cell build state,
and region composite state, enabling the pipeline to skip unchanged cells
and regions.
"""

from __future__ import annotations

import hashlib
import json
import subprocess
import threading
from datetime import datetime, timezone
from pathlib import Path

# Bump when enrichment logic (enrich.py, s52_metadata.py, labels.py, symbols.py)
# changes in a way not captured by LAYER_CONFIGS or tippecanoe version.
PIPELINE_VERSION = 3

SCHEMA_VERSION = 1


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

                CREATE TABLE IF NOT EXISTS cell_noaa_state (
                    cell_name       TEXT PRIMARY KEY,
                    last_modified   TEXT NOT NULL,
                    checked_at      TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS cell_scan_cache (
                    cell_name       TEXT PRIMARY KEY,
                    noaa_date       TEXT NOT NULL,
                    intu            INTEGER,
                    cscl            INTEGER,
                    scale_band      INTEGER NOT NULL,
                    coverage_wkb    BLOB,
                    scanned_at      TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS cell_build_state (
                    cell_name       TEXT PRIMARY KEY,
                    noaa_date       TEXT NOT NULL,
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
                    noaa_date       TEXT NOT NULL,
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
            # Set schema version if not present
            row = self._conn.execute(
                "SELECT version FROM schema_version LIMIT 1"
            ).fetchone()
            if row is None:
                self._conn.execute(
                    "INSERT INTO schema_version (version) VALUES (?)",
                    (SCHEMA_VERSION,),
                )

    def close(self) -> None:
        self._conn.close()

    def __enter__(self) -> StateDB:
        return self

    def __exit__(self, *args: object) -> None:
        self.close()

    # ── NOAA state ───────────────────────────────────────────────────────

    def get_noaa_date(self, cell_name: str) -> str | None:
        row = self._conn.execute(
            "SELECT last_modified FROM cell_noaa_state WHERE cell_name = ?",
            (cell_name,),
        ).fetchone()
        return row[0] if row else None

    def upsert_noaa_state(
        self, cell_name: str, last_modified: str, checked_at: str | None = None,
    ) -> None:
        if checked_at is None:
            checked_at = _now_iso()
        with self._lock, self._conn:
            self._conn.execute(
                """INSERT OR REPLACE INTO cell_noaa_state
                   (cell_name, last_modified, checked_at) VALUES (?, ?, ?)""",
                (cell_name, last_modified, checked_at),
            )

    def get_all_noaa_state(self) -> dict[str, str]:
        """Return {cell_name: last_modified} for all cells."""
        rows = self._conn.execute(
            "SELECT cell_name, last_modified FROM cell_noaa_state"
        ).fetchall()
        return {name: date for name, date in rows}

    # ── Scan cache ───────────────────────────────────────────────────────

    def get_scan_cache(
        self, cell_name: str,
    ) -> tuple[str, int | None, int | None, int, bytes | None] | None:
        """Return (noaa_date, intu, cscl, scale_band, coverage_wkb) or None."""
        row = self._conn.execute(
            """SELECT noaa_date, intu, cscl, scale_band, coverage_wkb
               FROM cell_scan_cache WHERE cell_name = ?""",
            (cell_name,),
        ).fetchone()
        return row if row else None

    def set_scan_cache(
        self,
        cell_name: str,
        noaa_date: str,
        intu: int | None,
        cscl: int | None,
        scale_band: int,
        coverage_wkb: bytes | None,
    ) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                """INSERT OR REPLACE INTO cell_scan_cache
                   (cell_name, noaa_date, intu, cscl, scale_band, coverage_wkb, scanned_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (cell_name, noaa_date, intu, cscl, scale_band, coverage_wkb, _now_iso()),
            )

    # ── Build state ──────────────────────────────────────────────────────

    def get_build_state(self, cell_name: str) -> tuple[str, str, bool] | None:
        """Return (noaa_date, config_hash, success) or None."""
        row = self._conn.execute(
            "SELECT noaa_date, config_hash, success FROM cell_build_state WHERE cell_name = ?",
            (cell_name,),
        ).fetchone()
        if row is None:
            return None
        return (row[0], row[1], bool(row[2]))

    def set_build_state(
        self,
        cell_name: str,
        noaa_date: str,
        config_hash: str,
        tile_count: int,
        success: bool,
    ) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                """INSERT OR REPLACE INTO cell_build_state
                   (cell_name, noaa_date, config_hash, built_at, tile_count, success)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (cell_name, noaa_date, config_hash, _now_iso(), tile_count, int(success)),
            )

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
        """Return {cell_name: (noaa_date, config_hash)} for a region."""
        rows = self._conn.execute(
            """SELECT cell_name, noaa_date, config_hash
               FROM region_cell_snapshot WHERE region_name = ?""",
            (region_name,),
        ).fetchall()
        return {name: (date, chash) for name, date, chash in rows}

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
                   (region_name, cell_name, noaa_date, config_hash)
                   VALUES (?, ?, ?, ?)""",
                [
                    (region_name, cell_name, noaa_date, config_hash)
                    for cell_name, (noaa_date, config_hash) in snapshot.items()
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
    noaa_date = db.get_noaa_date(cell_name)
    if noaa_date and build[0] != noaa_date:  # NOAA date changed
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
        noaa_date = db.get_noaa_date(cell_name) or ""
        snap = snapshot.get(cell_name)
        if snap is None:  # new cell added to region
            return True
        if snap[0] != noaa_date:  # NOAA date changed
            return True
        if snap[1] != config_hash:  # config changed since last composite
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


# ── Migration ────────────────────────────────────────────────────────────


def migrate_json_state(db: StateDB, json_path: Path) -> None:
    """Migrate enc-update-state.json into the SQLite database.

    After migration, renames the JSON file to .json.migrated.
    """
    if not json_path.exists():
        return
    try:
        state = json.loads(json_path.read_text())
    except (json.JSONDecodeError, OSError):
        return

    now = _now_iso()
    for cell_name, info in state.items():
        last_mod = info if isinstance(info, str) else info.get("last_modified", "")
        if last_mod:
            db.upsert_noaa_state(cell_name, last_mod, now)

    json_path.rename(json_path.with_suffix(".json.migrated"))


# ── Helpers ──────────────────────────────────────────────────────────────


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
