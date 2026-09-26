"""Tests for NOAA ENC product catalog parsing and change classification."""

from __future__ import annotations

import io
import os
import time
from pathlib import Path

import pytest

from s57_pipeline.enc_catalog import (
    CatalogCell,
    CatalogError,
    CellStatus,
    classify_cell,
    load_product_catalog,
    parse_product_catalog,
)

CATALOG_XML = b"""<?xml version="1.0" encoding="UTF-8" ?>
<EncProductCatalog>
  <Header>
    <title>ENC Product Catalog</title>
    <date_created>2026-09-26</date_created>
  </Header>
  <cell>
    <name>US5MA1SK</name>
    <lname>Boston Harbor</lname>
    <cscale>10000</cscale>
    <status>Active</status>
    <states><state>MA</state></states>
    <zipfile_location>https://www.charts.noaa.gov/ENCs/US5MA1SK.zip</zipfile_location>
    <zipfile_datetime_iso8601>2026-09-26T04:44:34Z</zipfile_datetime_iso8601>
    <edtn>3</edtn>
    <updn>1</updn>
    <uadt>2025-02-27</uadt>
    <isdt>2025-06-04</isdt>
    <cov>
      <panel>
        <panel_no>1</panel_no>
        <type>E</type>
        <vertex><lat>42.3</lat><long>-71.05</long></vertex>
        <vertex><lat>42.3</lat><long>-71.0</long></vertex>
        <vertex><lat>42.35</lat><long>-71.0</long></vertex>
        <vertex><lat>42.3</lat><long>-71.05</long></vertex>
      </panel>
      <panel>
        <panel_no>2</panel_no>
        <type>E</type>
        <vertex><lat>42.4</lat><long>-70.95</long></vertex>
        <vertex><lat>42.4</lat><long>-70.9</long></vertex>
        <vertex><lat>42.45</lat><long>-70.9</long></vertex>
        <vertex><lat>42.4</lat><long>-70.95</long></vertex>
      </panel>
      <panel>
        <panel_no>3</panel_no>
        <type>I</type>
        <vertex><lat>40.0</lat><long>-75.0</long></vertex>
        <vertex><lat>40.0</lat><long>-74.0</long></vertex>
        <vertex><lat>41.0</lat><long>-74.0</long></vertex>
        <vertex><lat>40.0</lat><long>-75.0</long></vertex>
      </panel>
    </cov>
  </cell>
  <cell>
    <name>US2EC03M</name>
    <lname>Cape Sable to Cape Hatteras</lname>
    <status>Cancelled</status>
    <edtn>10</edtn>
    <updn>2</updn>
  </cell>
  <cell>
    <name>US4BROKEN</name>
    <status>Active</status>
    <edtn></edtn>
    <updn>1</updn>
  </cell>
</EncProductCatalog>
"""

ACTIVE = CatalogCell("US5MA1SK", "Active", 3, 1, (-71.05, 42.3, -70.9, 42.45))
CANCELLED = CatalogCell("US2EC03M", "Cancelled", 10, 2)


class TestParse:
    def test_parses_cells(self) -> None:
        cells = parse_product_catalog(io.BytesIO(CATALOG_XML))
        assert cells == {"US5MA1SK": ACTIVE, "US2EC03M": CANCELLED}

    def test_version_and_status(self) -> None:
        assert ACTIVE.version == "3.1"
        assert ACTIVE.active
        assert not CANCELLED.active


class TestClassify:
    @pytest.mark.parametrize(
        ("stored", "entry", "expected"),
        [
            ("3.1", ACTIVE, CellStatus.UNCHANGED),
            ("3.0", ACTIVE, CellStatus.CHANGED),
            ("2.4", ACTIVE, CellStatus.CHANGED),
            (None, ACTIVE, CellStatus.NEW),
            ("10.1", CANCELLED, CellStatus.INACTIVE),
            (None, CANCELLED, CellStatus.INACTIVE),
            ("3.1", None, CellStatus.MISSING),
            (None, None, CellStatus.MISSING),
        ],
    )
    def test_classify(
        self, stored: str | None, entry: CatalogCell | None, expected: CellStatus
    ) -> None:
        assert classify_cell(stored, entry) is expected


class TestLoad:
    def test_fresh_cache_skips_download(self, tmp_path: Path) -> None:
        cache = tmp_path / "ENCProdCat.xml"
        cache.write_bytes(CATALOG_XML)
        cells = load_product_catalog(cache, url="http://invalid.invalid/")
        assert set(cells) == {"US5MA1SK", "US2EC03M"}

    def test_downloads_stale_cache(self, tmp_path: Path) -> None:
        source = tmp_path / "source.xml"
        source.write_bytes(CATALOG_XML.replace(b"<updn>1</updn>", b"<updn>2</updn>"))
        cache = tmp_path / "ENCProdCat.xml"
        cache.write_bytes(CATALOG_XML)
        old = time.time() - 7200
        os.utime(cache, (old, old))
        cells = load_product_catalog(cache, max_age_s=3600, url=source.as_uri())
        assert cells["US5MA1SK"].version == "3.2"
        assert cache.read_bytes() == source.read_bytes()

    def test_stale_ok_falls_back_to_cache(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr("s57_pipeline.enc_catalog.FETCH_RETRY_DELAY_S", 0)
        cache = tmp_path / "ENCProdCat.xml"
        cache.write_bytes(CATALOG_XML)
        missing = (tmp_path / "missing.xml").as_uri()
        cells = load_product_catalog(cache, max_age_s=0, url=missing, stale_ok=True)
        assert set(cells) == {"US5MA1SK", "US2EC03M"}
        with pytest.raises(CatalogError):
            load_product_catalog(tmp_path / "none.xml", url=missing, stale_ok=True)

    def test_unusable_download_keeps_cache(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr("s57_pipeline.enc_catalog.FETCH_RETRY_DELAY_S", 0)
        source = tmp_path / "source.xml"
        source.write_bytes(CATALOG_XML[:200])
        cache = tmp_path / "ENCProdCat.xml"
        cache.write_bytes(CATALOG_XML)
        with pytest.raises(CatalogError):
            load_product_catalog(cache, max_age_s=0, url=source.as_uri())
        assert cache.read_bytes() == CATALOG_XML
        assert not (tmp_path / "ENCProdCat.xml.tmp").exists()
