"""NOAA ENC product catalog (ENCProdCat.xml): per-cell edition and update.

The catalog lists every NOAA ENC cell with its status and the S-57 edition
(``edtn``) and update (``updn``) numbers of the currently published data. The
pair changes only when chart content changes, unlike the zip files'
Last-Modified times, which NOAA refreshes whenever it regenerates the zips.

A cell's version is recorded as the key ``"<edition>.<update>"``.
"""

from __future__ import annotations

import time
import urllib.request
from dataclasses import dataclass
from enum import StrEnum
from http.client import HTTPException
from pathlib import Path
from typing import BinaryIO
from xml.etree.ElementTree import ParseError, iterparse

PRODUCT_CATALOG_URL = "https://charts.noaa.gov/ENCs/ENCProdCat.xml"
PRODUCT_CATALOG_CACHE = Path("data/ENCProdCat.xml")
# NOAA publishes the catalog once a day; a cached copy younger than this is
# reused, so a check and the download that follows it see the same catalog.
CATALOG_MAX_AGE_S = 3600
FETCH_ATTEMPTS = 3
FETCH_TIMEOUT_S = 120
FETCH_RETRY_DELAY_S = 5


class CatalogError(Exception):
    """The product catalog could not be fetched or parsed."""


def enc_version_key(edition: int, update: int) -> str:
    return f"{edition}.{update}"


@dataclass(frozen=True)
class CatalogCell:
    name: str
    status: str
    edition: int
    update: int

    @property
    def active(self) -> bool:
        return self.status == "Active"

    @property
    def version(self) -> str:
        return enc_version_key(self.edition, self.update)


class CellStatus(StrEnum):
    """How a cell's catalog entry compares with its recorded version."""

    UNCHANGED = "unchanged"
    CHANGED = "changed"
    NEW = "new"  # no recorded version
    INACTIVE = "inactive"  # listed, but not Active (e.g. Cancelled)
    MISSING = "missing"  # not in the catalog at all


def classify_cell(stored_version: str | None, entry: CatalogCell | None) -> CellStatus:
    """Compare a cell's recorded version with its catalog entry.

    Inactive and missing cells never count as changed: NOAA publishes no new
    content for them, so the last downloaded data stays in use.
    """
    if entry is None:
        return CellStatus.MISSING
    if not entry.active:
        return CellStatus.INACTIVE
    if stored_version is None:
        return CellStatus.NEW
    if stored_version != entry.version:
        return CellStatus.CHANGED
    return CellStatus.UNCHANGED


def parse_product_catalog(source: Path | BinaryIO) -> dict[str, CatalogCell]:
    """Parse ENCProdCat.xml into {cell name: CatalogCell}.

    Cells lacking a name or numeric edition/update are skipped.
    """
    cells: dict[str, CatalogCell] = {}
    for _event, elem in iterparse(source, events=("end",)):
        if elem.tag != "cell":
            continue
        name = (elem.findtext("name") or "").strip()
        edition = (elem.findtext("edtn") or "").strip()
        update = (elem.findtext("updn") or "").strip()
        if name and edition.isdigit() and update.isdigit():
            cells[name] = CatalogCell(
                name=name,
                status=(elem.findtext("status") or "").strip(),
                edition=int(edition),
                update=int(update),
            )
        elem.clear()
    return cells


def load_product_catalog(
    cache_path: Path = PRODUCT_CATALOG_CACHE,
    max_age_s: float = CATALOG_MAX_AGE_S,
    url: str = PRODUCT_CATALOG_URL,
) -> dict[str, CatalogCell]:
    """Return the parsed catalog, downloading it unless the cache is fresh.

    A download replaces the cache only once it parses. Raises CatalogError
    when no usable catalog can be fetched.
    """
    if cache_path.exists() and time.time() - cache_path.stat().st_mtime < max_age_s:
        return parse_product_catalog(cache_path)

    cache_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = cache_path.with_name(cache_path.name + ".tmp")
    error: Exception | None = None
    for attempt in range(FETCH_ATTEMPTS):
        if attempt:
            time.sleep(FETCH_RETRY_DELAY_S * attempt)
        try:
            with urllib.request.urlopen(url, timeout=FETCH_TIMEOUT_S) as resp:
                tmp.write_bytes(resp.read())
            cells = parse_product_catalog(tmp)
            if not cells:
                raise ParseError("no cells in catalog")
            tmp.replace(cache_path)
            return cells
        except (OSError, HTTPException, ParseError) as e:
            tmp.unlink(missing_ok=True)
            error = e
    raise CatalogError(f"cannot fetch {url}: {error}") from error
