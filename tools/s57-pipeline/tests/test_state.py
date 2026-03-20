"""Tests for the pipeline state database."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from s57_pipeline.state import (
    StateDB,
    compute_config_hash,
    is_cell_dirty,
    is_region_dirty,
    migrate_json_state,
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
        assert "cell_noaa_state" in tables
        assert "cell_scan_cache" in tables
        assert "cell_build_state" in tables
        assert "region_composite_state" in tables
        assert "region_cell_snapshot" in tables

    def test_noaa_state_crud(self, db: StateDB) -> None:
        assert db.get_noaa_date("US5MA1AQ") is None
        db.upsert_noaa_state("US5MA1AQ", "Mon, 01 Jan 2024 00:00:00 GMT")
        assert db.get_noaa_date("US5MA1AQ") == "Mon, 01 Jan 2024 00:00:00 GMT"
        # Update
        db.upsert_noaa_state("US5MA1AQ", "Tue, 02 Jan 2024 00:00:00 GMT")
        assert db.get_noaa_date("US5MA1AQ") == "Tue, 02 Jan 2024 00:00:00 GMT"

    def test_get_all_noaa_state(self, db: StateDB) -> None:
        db.upsert_noaa_state("CELL_A", "date_a")
        db.upsert_noaa_state("CELL_B", "date_b")
        result = db.get_all_noaa_state()
        assert result == {"CELL_A": "date_a", "CELL_B": "date_b"}

    def test_scan_cache_round_trip(self, db: StateDB) -> None:
        assert db.get_scan_cache("US5MA1AQ") is None
        wkb_data = b"\x01\x02\x03"
        db.set_scan_cache("US5MA1AQ", "date1", 5, 45000, 3, wkb_data)
        cached = db.get_scan_cache("US5MA1AQ")
        assert cached is not None
        noaa_date, intu, cscl, band, wkb = cached
        assert noaa_date == "date1"
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
        db.upsert_noaa_state("FAIL", "date1")
        db.set_build_state("FAIL", "date1", "hash1", 0, False)
        assert is_cell_dirty("FAIL", db, "hash1", tmp_path) is True

    def test_cell_dirty_noaa_changed(self, db: StateDB, tmp_path: Path) -> None:
        db.upsert_noaa_state("CELL", "date2")
        db.set_build_state("CELL", "date1", "hash1", 5, True)
        # Create tiles dir
        tiles = tmp_path / "CELL" / "tiles"
        tiles.mkdir(parents=True)
        (tiles / "test.pmtiles").write_bytes(b"data")
        assert is_cell_dirty("CELL", db, "hash1", tmp_path) is True

    def test_cell_dirty_config_changed(self, db: StateDB, tmp_path: Path) -> None:
        db.upsert_noaa_state("CELL", "date1")
        db.set_build_state("CELL", "date1", "old_hash", 5, True)
        tiles = tmp_path / "CELL" / "tiles"
        tiles.mkdir(parents=True)
        (tiles / "test.pmtiles").write_bytes(b"data")
        assert is_cell_dirty("CELL", db, "new_hash", tmp_path) is True

    def test_cell_dirty_no_tiles(self, db: StateDB, tmp_path: Path) -> None:
        db.upsert_noaa_state("CELL", "date1")
        db.set_build_state("CELL", "date1", "hash1", 5, True)
        # No tiles dir at all
        assert is_cell_dirty("CELL", db, "hash1", tmp_path) is True

    def test_cell_clean(self, db: StateDB, tmp_path: Path) -> None:
        db.upsert_noaa_state("CELL", "date1")
        db.set_build_state("CELL", "date1", "hash1", 5, True)
        tiles = tmp_path / "CELL" / "tiles"
        tiles.mkdir(parents=True)
        (tiles / "test.pmtiles").write_bytes(b"data")
        assert is_cell_dirty("CELL", db, "hash1", tmp_path) is False

    def test_region_dirty_no_state(self, db: StateDB) -> None:
        assert is_region_dirty("region-a", db, "hash1", ["CELL_A"]) is True

    def test_region_dirty_config_changed(self, db: StateDB) -> None:
        db.set_composite_state("region-a", "old_hash", 1000, None, True)
        db.set_region_cell_snapshot("region-a", {"CELL_A": ("date1", "old_hash")})
        db.upsert_noaa_state("CELL_A", "date1")
        assert is_region_dirty("region-a", db, "new_hash", ["CELL_A"]) is True

    def test_region_dirty_new_cell(self, db: StateDB) -> None:
        db.set_composite_state("region-a", "hash1", 1000, None, True)
        db.set_region_cell_snapshot("region-a", {"CELL_A": ("date1", "hash1")})
        db.upsert_noaa_state("CELL_A", "date1")
        db.upsert_noaa_state("CELL_B", "date2")
        # CELL_B not in snapshot
        assert is_region_dirty("region-a", db, "hash1", ["CELL_A", "CELL_B"]) is True

    def test_region_clean(self, db: StateDB) -> None:
        db.set_composite_state("region-a", "hash1", 1000, None, True)
        db.set_region_cell_snapshot("region-a", {
            "CELL_A": ("date1", "hash1"),
            "CELL_B": ("date2", "hash1"),
        })
        db.upsert_noaa_state("CELL_A", "date1")
        db.upsert_noaa_state("CELL_B", "date2")
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


class TestMigration:
    def test_migrate_json(self, tmp_path: Path) -> None:
        json_path = tmp_path / "enc-update-state.json"
        json_path.write_text(json.dumps({
            "US5MA1AQ": {"last_modified": "Mon, 01 Jan 2024 00:00:00 GMT"},
            "US5MA1AR": {"last_modified": "Tue, 02 Jan 2024 00:00:00 GMT"},
        }))
        db = StateDB(tmp_path / "test.db")
        migrate_json_state(db, json_path)
        assert db.get_noaa_date("US5MA1AQ") == "Mon, 01 Jan 2024 00:00:00 GMT"
        assert db.get_noaa_date("US5MA1AR") == "Tue, 02 Jan 2024 00:00:00 GMT"
        # JSON file should be renamed
        assert not json_path.exists()
        assert (tmp_path / "enc-update-state.json.migrated").exists()

    def test_migrate_no_json(self, tmp_path: Path) -> None:
        db = StateDB(tmp_path / "test.db")
        migrate_json_state(db, tmp_path / "nonexistent.json")
        # Should not error

    def test_migrate_idempotent(self, tmp_path: Path) -> None:
        json_path = tmp_path / "enc-update-state.json"
        json_path.write_text(json.dumps({"CELL": {"last_modified": "date1"}}))
        db = StateDB(tmp_path / "test.db")
        migrate_json_state(db, json_path)
        # Second call: JSON file is gone, should no-op
        migrate_json_state(db, json_path)
        assert db.get_noaa_date("CELL") == "date1"
