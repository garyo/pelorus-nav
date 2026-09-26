"""Tests for the download command's version bookkeeping."""

from __future__ import annotations

import argparse
from pathlib import Path

import pytest

from s57_pipeline import cli
from s57_pipeline.enc_catalog import CatalogCell
from s57_pipeline.state import StateDB, region_needs_build

CELLS = ["GOOD", "BAD"]


def _catalog(update: int) -> dict[str, CatalogCell]:
    return {c: CatalogCell(c, "Active", 3, update) for c in CELLS}


@pytest.fixture
def workdir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """A pipeline working directory where every cell exists locally at 3.0
    and region "r" was composited from that data."""
    monkeypatch.chdir(tmp_path)
    for cell in CELLS:
        (tmp_path / "data/enc" / cell).mkdir(parents=True)
        (tmp_path / "data/enc" / cell / f"{cell}.000").write_bytes(b"")
    with StateDB() as db:
        for cell in CELLS:
            db.set_enc_version(cell, 3, 0)
        db.set_region_cell_snapshot("r", {c: ("3.0", "h") for c in CELLS})
    return tmp_path


def _download(
    monkeypatch: pytest.MonkeyPatch, catalog: dict[str, CatalogCell], failing: set[str]
) -> None:
    def fake_download(cell: str, output_dir: Path, _progress: object) -> Path | None:
        return None if cell in failing else output_dir / cell / f"{cell}.000"

    monkeypatch.setattr(cli, "load_product_catalog", lambda **_kwargs: catalog)
    monkeypatch.setattr(cli, "download_enc_cell", fake_download)
    args = argparse.Namespace(
        output="data/enc", cell=CELLS, region=None, force=False, jobs=1, verbose=False
    )
    cli.cmd_download(args)


def _state() -> tuple[dict[str, str], bool]:
    with StateDB() as db:
        return db.get_all_enc_versions(), region_needs_build("r", db, CELLS)


def test_failed_download_keeps_old_version(
    workdir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _download(monkeypatch, _catalog(1), failing={"BAD"})
    versions, needs_build = _state()
    assert versions == {"GOOD": "3.1", "BAD": "3.0"}
    assert needs_build is True


def test_download_failing_every_run_never_needs_a_build(
    workdir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    catalog = {**_catalog(0), "BAD": CatalogCell("BAD", "Active", 3, 1)}
    for _ in range(2):
        _download(monkeypatch, catalog, failing={"BAD"})
        assert _state() == ({"GOOD": "3.0", "BAD": "3.0"}, False)


def test_download_retried_after_failure(
    workdir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    catalog = {**_catalog(0), "BAD": CatalogCell("BAD", "Active", 3, 1)}
    _download(monkeypatch, catalog, failing={"BAD"})
    _download(monkeypatch, catalog, failing=set())
    assert _state() == ({"GOOD": "3.0", "BAD": "3.1"}, True)
