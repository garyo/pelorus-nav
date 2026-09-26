"""Tests for the pipeline state database."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from s57_pipeline.state import (
    SCHEMA_VERSION,
    SeedResult,
    StateDB,
    compute_composite_hash,
    compute_config_hash,
    is_cell_dirty,
    is_region_dirty,
)


@pytest.fixture
def db(tmp_path: Path) -> StateDB:
    return StateDB(tmp_path / "test.db")


class TestStateDB:
    def test_schema_created(self, db: StateDB) -> None:
        tables = {
            row[0]
            for row in db._conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        assert "cell_enc_version" in tables
        assert "cell_noaa_state" not in tables
        assert "cell_scan_cache" in tables
        assert "cell_build_state" in tables
        assert "region_composite_state" in tables
        assert "region_cell_snapshot" in tables

    def test_enc_version_crud(self, db: StateDB) -> None:
        assert db.get_enc_version("US5MA1AQ") is None
        db.set_enc_version("US5MA1AQ", 3, 1)
        assert db.get_enc_version("US5MA1AQ") == "3.1"
        db.set_enc_version("US5MA1AQ", 4, 0)
        assert db.get_enc_version("US5MA1AQ") == "4.0"

    def test_get_all_enc_versions(self, db: StateDB) -> None:
        db.set_enc_version("CELL_A", 1, 2)
        db.set_enc_version("CELL_B", 3, 4)
        assert db.get_all_enc_versions() == {"CELL_A": "1.2", "CELL_B": "3.4"}

    def test_no_legacy_state_in_fresh_db(self, db: StateDB) -> None:
        assert db.legacy_noaa_state() == {}
        assert db.seed_enc_versions({"CELL": (1, 0)}).cells == 0

    def test_scan_cache_round_trip(self, db: StateDB) -> None:
        assert db.get_scan_cache("US5MA1AQ") is None
        wkb_data = b"\x01\x02\x03"
        db.set_scan_cache("US5MA1AQ", "date1", 5, 45000, 3, wkb_data)
        cached = db.get_scan_cache("US5MA1AQ")
        assert cached is not None
        enc_version, intu, cscl, band, wkb = cached
        assert enc_version == "date1"
        assert intu == 5
        assert cscl == 45000
        assert band == 3
        assert wkb == wkb_data

    def test_scan_cache_null_coverage(self, db: StateDB) -> None:
        db.set_scan_cache("NOCOV", "date1", None, None, 0, None)
        cached = db.get_scan_cache("NOCOV")
        assert cached is not None
        assert cached[1] is None  # intu
        assert cached[2] is None  # cscl
        assert cached[4] is None  # wkb

    def test_build_state_round_trip(self, db: StateDB) -> None:
        assert db.get_build_state("US5MA1AQ") is None
        db.set_build_state("US5MA1AQ", "date1", "abc123", 5, True)
        result = db.get_build_state("US5MA1AQ")
        assert result is not None
        assert result == ("date1", "abc123", True)

    def test_build_state_failure(self, db: StateDB) -> None:
        db.set_build_state("FAIL", "date1", "abc", 0, False)
        result = db.get_build_state("FAIL")
        assert result is not None
        assert result[2] is False

    def test_composite_state_round_trip(self, db: StateDB) -> None:
        assert db.get_composite_state("region-a") is None
        db.set_composite_state("region-a", "hash1", 1000000, None, True)
        result = db.get_composite_state("region-a")
        assert result == ("hash1", True)

    def test_region_cell_snapshot(self, db: StateDB) -> None:
        snapshot = {"CELL_A": ("date_a", "hash1"), "CELL_B": ("date_b", "hash1")}
        db.set_region_cell_snapshot("region-a", snapshot)
        result = db.get_region_cell_snapshot("region-a")
        assert result == snapshot
        # Update snapshot (should replace old)
        new_snapshot = {"CELL_A": ("date_a2", "hash2"), "CELL_C": ("date_c", "hash2")}
        db.set_region_cell_snapshot("region-a", new_snapshot)
        result = db.get_region_cell_snapshot("region-a")
        assert result == new_snapshot


class TestDirtyChecks:
    def test_cell_dirty_no_state(self, db: StateDB, tmp_path: Path) -> None:
        assert is_cell_dirty("NEWCELL", db, "hash1", tmp_path) is True

    def test_cell_dirty_failed_build(self, db: StateDB, tmp_path: Path) -> None:
        db.set_enc_version("FAIL", 1, 1)
        db.set_build_state("FAIL", "1.1", "hash1", 0, False)
        assert is_cell_dirty("FAIL", db, "hash1", tmp_path) is True

    def test_cell_dirty_version_changed(self, db: StateDB, tmp_path: Path) -> None:
        db.set_enc_version("CELL", 1, 2)
        db.set_build_state("CELL", "1.1", "hash1", 5, True)
        # Create tiles dir
        tiles = tmp_path / "CELL" / "tiles"
        tiles.mkdir(parents=True)
        (tiles / "test.pmtiles").write_bytes(b"data")
        assert is_cell_dirty("CELL", db, "hash1", tmp_path) is True

    def test_cell_dirty_config_changed(self, db: StateDB, tmp_path: Path) -> None:
        db.set_enc_version("CELL", 1, 1)
        db.set_build_state("CELL", "1.1", "old_hash", 5, True)
        tiles = tmp_path / "CELL" / "tiles"
        tiles.mkdir(parents=True)
        (tiles / "test.pmtiles").write_bytes(b"data")
        assert is_cell_dirty("CELL", db, "new_hash", tmp_path) is True

    def test_cell_dirty_no_tiles(self, db: StateDB, tmp_path: Path) -> None:
        db.set_enc_version("CELL", 1, 1)
        db.set_build_state("CELL", "1.1", "hash1", 5, True)
        # No tiles dir at all
        assert is_cell_dirty("CELL", db, "hash1", tmp_path) is True

    def test_cell_clean(self, db: StateDB, tmp_path: Path) -> None:
        db.set_enc_version("CELL", 1, 1)
        db.set_build_state("CELL", "1.1", "hash1", 5, True)
        tiles = tmp_path / "CELL" / "tiles"
        tiles.mkdir(parents=True)
        (tiles / "test.pmtiles").write_bytes(b"data")
        assert is_cell_dirty("CELL", db, "hash1", tmp_path) is False

    def test_region_dirty_no_state(self, db: StateDB) -> None:
        assert is_region_dirty("region-a", db, "hash1", ["CELL_A"]) is True

    def test_region_dirty_config_changed(self, db: StateDB) -> None:
        db.set_composite_state("region-a", "old_hash", 1000, None, True)
        db.set_region_cell_snapshot("region-a", {"CELL_A": ("1.1", "old_hash")})
        db.set_enc_version("CELL_A", 1, 1)
        assert is_region_dirty("region-a", db, "new_hash", ["CELL_A"]) is True

    def test_region_dirty_new_cell(self, db: StateDB) -> None:
        db.set_composite_state("region-a", "hash1", 1000, None, True)
        db.set_region_cell_snapshot("region-a", {"CELL_A": ("1.1", "hash1")})
        db.set_enc_version("CELL_A", 1, 1)
        db.set_enc_version("CELL_B", 1, 2)
        # CELL_B not in snapshot
        assert is_region_dirty("region-a", db, "hash1", ["CELL_A", "CELL_B"]) is True

    def test_region_clean(self, db: StateDB) -> None:
        db.set_composite_state("region-a", "hash1", 1000, None, True)
        db.set_region_cell_snapshot(
            "region-a",
            {
                "CELL_A": ("1.1", "hash1"),
                "CELL_B": ("1.2", "hash1"),
            },
        )
        db.set_enc_version("CELL_A", 1, 1)
        db.set_enc_version("CELL_B", 1, 2)
        assert is_region_dirty("region-a", db, "hash1", ["CELL_A", "CELL_B"]) is False


class TestConfigHash:
    def test_deterministic(self) -> None:
        h1 = compute_config_hash(2)
        h2 = compute_config_hash(2)
        assert h1 == h2

    def test_is_12_hex(self) -> None:
        h = compute_config_hash(0)
        assert len(h) == 12
        int(h, 16)  # should not raise

    def test_changes_with_zoom_shift(self) -> None:
        h0 = compute_config_hash(0)
        h2 = compute_config_hash(2)
        assert h0 != h2


V1_SCHEMA = """
    CREATE TABLE schema_version (version INTEGER NOT NULL);
    INSERT INTO schema_version VALUES (1);
    CREATE TABLE cell_noaa_state (
        cell_name TEXT PRIMARY KEY, last_modified TEXT NOT NULL,
        checked_at TEXT NOT NULL);
    CREATE TABLE cell_scan_cache (
        cell_name TEXT PRIMARY KEY, noaa_date TEXT NOT NULL, intu INTEGER,
        cscl INTEGER, scale_band INTEGER NOT NULL, coverage_wkb BLOB,
        scanned_at TEXT NOT NULL);
    CREATE TABLE cell_build_state (
        cell_name TEXT PRIMARY KEY, noaa_date TEXT NOT NULL,
        config_hash TEXT NOT NULL, built_at TEXT NOT NULL, tile_count INTEGER,
        success INTEGER NOT NULL);
    CREATE TABLE region_cell_snapshot (
        region_name TEXT NOT NULL, cell_name TEXT NOT NULL,
        noaa_date TEXT NOT NULL, config_hash TEXT NOT NULL,
        PRIMARY KEY (region_name, cell_name));
"""

OLD = "Mon, 01 Jan 2024 00:00:00 GMT"
NEWER = "Tue, 02 Jan 2024 00:00:00 GMT"


@pytest.fixture
def v1_db_path(tmp_path: Path) -> Path:
    """A schema-v1 database: CURRENT was built from its recorded download,
    STALE was downloaded again (NEWER) after its last build."""
    path = tmp_path / "v1.db"
    conn = sqlite3.connect(path)
    conn.executescript(V1_SCHEMA)
    # (cell, recorded Last-Modified, Last-Modified its tiles were built from)
    rows = [("CURRENT", OLD, OLD), ("STALE", NEWER, OLD)]
    for cell, last_modified, built_from in rows:
        conn.execute(
            "INSERT INTO cell_noaa_state VALUES (?, ?, 'now')", (cell, last_modified)
        )
        conn.execute(
            "INSERT INTO cell_build_state VALUES (?, ?, 'h', 'now', 1, 1)",
            (cell, built_from),
        )
        conn.execute(
            "INSERT INTO region_cell_snapshot VALUES ('r', ?, ?, 'h')",
            (cell, built_from),
        )
        conn.execute(
            "INSERT INTO cell_scan_cache VALUES (?, ?, 5, 1, 3, NULL, 'now')",
            (cell, built_from),
        )
    conn.commit()
    conn.close()
    return path


class TestMigration:
    def test_v1_upgrade_keeps_rows(self, v1_db_path: Path) -> None:
        db = StateDB(v1_db_path)
        version = db._conn.execute("SELECT version FROM schema_version").fetchone()
        assert version == (SCHEMA_VERSION,)
        assert db.get_build_state("CURRENT") == (OLD, "h", True)
        assert db.get_region_cell_snapshot("r")["CURRENT"] == (OLD, "h")
        assert db.legacy_noaa_state() == {"CURRENT": OLD, "STALE": NEWER}
        assert db.get_all_enc_versions() == {}
        db.close()
        # Reopening an upgraded database is a no-op.
        StateDB(v1_db_path).close()

    def test_seed_relabels_current_builds_only(
        self, v1_db_path: Path, tmp_path: Path
    ) -> None:
        db = StateDB(v1_db_path)
        tiles = tmp_path / "work"
        for cell in ("CURRENT", "STALE"):
            (tiles / cell / "tiles").mkdir(parents=True)
            (tiles / cell / "tiles" / "t.pmtiles").write_bytes(b"x")

        result = db.seed_enc_versions(
            {"CURRENT": (3, 1), "STALE": (2, 0), "UNTRACKED": (1, 0)}
        )

        assert result == SeedResult(cells=2, builds=1, snapshots=1, scans=1)
        assert db.get_all_enc_versions() == {"CURRENT": "3.1", "STALE": "2.0"}
        assert is_cell_dirty("CURRENT", db, "h", tiles) is False
        assert is_cell_dirty("STALE", db, "h", tiles) is True
        db.set_composite_state("r", "h", 1, None, True)
        assert is_region_dirty("r", db, "h", ["CURRENT"]) is False
        assert db.get_scan_cache("CURRENT")[0] == "3.1"

    def test_seed_never_overwrites_recorded_version(self, v1_db_path: Path) -> None:
        db = StateDB(v1_db_path)
        db.seed_enc_versions({"CURRENT": (3, 1)})
        again = db.seed_enc_versions({"CURRENT": (3, 2)})
        assert again.cells == 0
        assert db.get_enc_version("CURRENT") == "3.1"


def test_composite_hash_tracks_band_policy(monkeypatch):
    from s57_pipeline import scamin

    base = compute_config_hash(2)
    assert compute_composite_hash(base) == base  # no policy → unchanged
    monkeypatch.setattr(scamin, "COMPOSITE_PREFERRED_BAND", {11: 3})
    with_policy = compute_composite_hash(base)
    assert with_policy != base
    assert with_policy != compute_composite_hash(compute_config_hash(0))
