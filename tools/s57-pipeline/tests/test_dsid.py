"""Tests for DSID reading and the cancelled-cell guard in the coverage scan."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from s57_pipeline import convert, coverage
from s57_pipeline.convert import DsidMetadata, read_dsid_metadata
from s57_pipeline.coverage import scan_all_cells
from s57_pipeline.state import ScanRecord, StateDB

OGRINFO_DSID = """INFO: Open of `US5WA12M.000'
      using driver `S57' successful.

Layer name: DSID
Geometry: None
Feature Count: 1
DSID_INTU: Integer (3.0)
DSID_EDTN: String (0.0)
DSPM_CSCL: Integer (10.0)
OGRFeature(DSID):0
  DSID_EXPP (Integer) = 1
  DSID_INTU (Integer) = 5
  DSID_DSNM (String) = US5WA12M.000
  DSID_EDTN (String) = {edition}
  DSID_UPDN (String) = 1
  DSID_PSDN (String) =
  DSID_COMT (String) = Produced by NOAA
  DSPM_CSCL (Integer) = 25000
"""


def _ogrinfo(stdout: str, returncode: int = 0):
    def run(cmd: list[str], **_kwargs: object) -> subprocess.CompletedProcess[str]:
        return subprocess.CompletedProcess(cmd, returncode, stdout, "")

    return run


class TestReadDsid:
    def test_reads_intu_cscl_edition(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            subprocess, "run", _ogrinfo(OGRINFO_DSID.format(edition=30))
        )
        assert read_dsid_metadata(Path("x.000")) == DsidMetadata(5, 25000, 30)
        assert convert.read_intended_use(Path("x.000")) == 5
        assert convert.read_compilation_scale(Path("x.000")) == 25000

    def test_cancelled_edition(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(subprocess, "run", _ogrinfo(OGRINFO_DSID.format(edition=0)))
        assert read_dsid_metadata(Path("x.000")).edition == 0

    def test_ogrinfo_failure(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(subprocess, "run", _ogrinfo("", returncode=1))
        assert read_dsid_metadata(Path("x.000")) == DsidMetadata(None, None, None)


class TestScanGuard:
    @pytest.fixture
    def scanned(self, monkeypatch: pytest.MonkeyPatch) -> list[str]:
        """Scan with fake DSID data: cells named CANC* carry edition 0.

        Returns the names of the cells actually read from disk.
        """
        reads: list[str] = []

        def fake_dsid(enc_path: Path) -> DsidMetadata:
            reads.append(enc_path.stem)
            return DsidMetadata(5, 20000, 0 if enc_path.stem.startswith("CANC") else 7)

        monkeypatch.setattr(coverage, "read_dsid_metadata", fake_dsid)
        monkeypatch.setattr(coverage, "extract_coverage_polygon", lambda _p: None)
        return reads

    def test_edition_zero_marks_cell_cancelled(self, scanned: list[str]) -> None:
        metas = scan_all_cells([Path("LIVE.000"), Path("CANC.000")], jobs=1)
        cancelled = {m.enc_path.stem: m.cancelled for m in metas}
        assert cancelled == {"LIVE": False, "CANC": True}

    def test_cached_edition_survives_cache_hit(
        self, scanned: list[str], tmp_path: Path
    ) -> None:
        db = StateDB(tmp_path / "state.db")
        db.set_enc_version("CANC", 30, 1)
        scan_all_cells([Path("CANC.000")], jobs=1, db=db)
        metas = scan_all_cells([Path("CANC.000")], jobs=1, db=db)
        assert scanned == ["CANC"]  # second scan was a cache hit
        assert metas[0].cancelled

    def test_cache_row_without_edition_is_rescanned(
        self, scanned: list[str], tmp_path: Path
    ) -> None:
        db = StateDB(tmp_path / "state.db")
        db.set_enc_version("CANC", 30, 1)
        db.set_scan_cache("CANC", ScanRecord("30.1", 5, 20000, None, 3, None))
        metas = scan_all_cells([Path("CANC.000")], jobs=1, db=db)
        assert scanned == ["CANC"]
        assert metas[0].cancelled
        cached = db.get_scan_cache("CANC")
        assert cached is not None and cached.edition == 0
