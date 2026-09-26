"""NOAA ENC product catalog (ENCProdCat.xml): cell status, version, coverage.

The catalog lists every NOAA ENC cell with its status, its coverage, and the
S-57 edition (``edtn``) and update (``updn``) numbers of the currently
published data. The pair changes only when chart content changes, unlike the
zip files' Last-Modified times, which NOAA refreshes whenever it regenerates
the zips. Cancelled cells are listed without coverage.

A cell's version is recorded as the key ``"<edition>.<update>"``.
"""

from __future__ import annotations

import sys
import time
import urllib.request
from dataclasses import dataclass
from enum import StrEnum
from http.client import HTTPException
from pathlib import Path
from typing import BinaryIO
from xml.etree.ElementTree import Element, ParseError, iterparse

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


BBox = tuple[float, float, float, float]  # (west, south, east, north)


@dataclass(frozen=True)
class CatalogCell:
    name: str
    status: str
    edition: int
    update: int
    bbox: BBox | None = None  # extent of the coverage panels, None if absent

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


def _coverage_bbox(cell: Element) -> BBox | None:
    """Bounding box of a cell's coverage (type "E") panels.

    Longitudes west of the antimeridian are given below -180.
    """
    lons: list[float] = []
    lats: list[float] = []
    for panel in cell.iterfind("cov/panel"):
        if panel.findtext("type") != "E":
            continue
        for vertex in panel.iterfind("vertex"):
            lon, lat = vertex.findtext("long"), vertex.findtext("lat")
            if lon and lat:
                lons.append(float(lon))
                lats.append(float(lat))
    if not lons:
        return None
    return (min(lons), min(lats), max(lons), max(lats))


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
                bbox=_coverage_bbox(elem),
            )
        elem.clear()
    return cells


def load_product_catalog(
    cache_path: Path = PRODUCT_CATALOG_CACHE,
    max_age_s: float = CATALOG_MAX_AGE_S,
    url: str = PRODUCT_CATALOG_URL,
    stale_ok: bool = False,
) -> dict[str, CatalogCell]:
    """Return the parsed catalog, downloading it unless the cache is fresh.

    A download replaces the cache only once it parses. When no usable
    catalog can be fetched, a stale cache is used with a warning if
    ``stale_ok``; otherwise CatalogError is raised.
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
    if stale_ok and cache_path.exists():
        print(
            f"Warning: cannot fetch {url} ({error}); using cached {cache_path}",
            file=sys.stderr,
        )
        return parse_product_catalog(cache_path)
    raise CatalogError(f"cannot fetch {url}: {error}") from error
