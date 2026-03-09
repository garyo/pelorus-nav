"""Region definitions and NOAA ENC product catalog queries for cell discovery.

Uses the official NOAA ENC Product Catalog (ISO 19115 XML) as the cell source.
The catalog is ~49MB and is cached locally after first download.
"""

from __future__ import annotations

import json
import re
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from xml.etree.ElementTree import iterparse

# NOAA ENC Product Catalog (ISO 19115 XML)
CATALOG_URL = "https://charts.noaa.gov/ENCs/ENCProdCat_19115.xml"

CACHE_DIR = Path("data/regions")
CATALOG_CACHE = CACHE_DIR / "enc_catalog.json"

# XML namespaces
NS = {
    "gmd": "http://www.isotc211.org/2005/gmd",
    "gco": "http://www.isotc211.org/2005/gco",
    "gml": "http://www.opengis.net/gml/3.2",
}


@dataclass(frozen=True)
class CellEntry:
    """A single ENC cell from the product catalog."""

    name: str
    title: str
    # Bounding box derived from polygon: (west, south, east, north)
    bbox: tuple[float, float, float, float]


@dataclass(frozen=True)
class Region:
    name: str
    bbox: tuple[float, float, float, float]  # (west, south, east, north)
    description: str


REGIONS: dict[str, Region] = {
    "boston-test": Region(
        name="Boston Harbor (test)",
        bbox=(-71.3, 41.9, -69.9, 42.7),
        description="Boston area with approach charts -- dev iteration",
    ),
    "new-england": Region(
        name="Long Island to Northern Maine",
        bbox=(-73.8, 40.5, -66.9, 47.5),
        description="Full coverage: Long Island Sound through Downeast Maine",
    ),
    "usvi": Region(
        name="USVI & Puerto Rico",
        bbox=(-68.0, 17.5, -64.4, 18.7),
        description="Puerto Rico, US Virgin Islands, and approaches west to Isla de Mona",
    ),
}


def _download_catalog(cache_path: Path) -> Path:
    """Download the NOAA product catalog XML if not cached."""
    xml_path = cache_path.with_suffix(".xml")
    if xml_path.exists():
        return xml_path
    print(f"Downloading NOAA ENC product catalog ({CATALOG_URL})...")
    xml_path.parent.mkdir(parents=True, exist_ok=True)
    urllib.request.urlretrieve(CATALOG_URL, xml_path)
    print(f"  Saved to {xml_path}")
    return xml_path


def _parse_catalog(xml_path: Path) -> list[CellEntry]:
    """Parse the catalog XML using streaming (iterparse) to avoid loading 49MB into memory."""
    entries: list[CellEntry] = []

    # Track state as we iterate
    current_name = ""
    current_title = ""
    in_polygon = False
    coords: list[tuple[float, float]] = []  # (lon, lat) pairs

    for event, elem in iterparse(str(xml_path), events=("start", "end")):
        tag = elem.tag

        if event == "start":
            if tag == f"{{{NS['gmd']}}}CI_Citation":
                current_name = ""
                current_title = ""
            elif tag == f"{{{NS['gml']}}}Polygon":
                in_polygon = True
                coords = []
        elif event == "end":
            # Cell name: first <gco:CharacterString> matching US cell pattern
            if tag == f"{{{NS['gco']}}}CharacterString":
                text = (elem.text or "").strip()
                if not current_name and re.match(r"^US\d[A-Z0-9]{3,}", text):
                    current_name = text
                elif current_name and not current_title and text and text != "ENC cell":
                    current_title = text

            elif tag == f"{{{NS['gml']}}}pos" and in_polygon:
                # gml:pos contains "lat lon"
                text = (elem.text or "").strip()
                parts = text.split()
                if len(parts) == 2:
                    lat, lon = float(parts[0]), float(parts[1])
                    coords.append((lon, lat))

            elif tag == f"{{{NS['gml']}}}Polygon":
                in_polygon = False
                if current_name and coords:
                    lons = [c[0] for c in coords]
                    lats = [c[1] for c in coords]
                    bbox = (min(lons), min(lats), max(lons), max(lats))
                    entries.append(CellEntry(
                        name=current_name,
                        title=current_title,
                        bbox=bbox,
                    ))
                coords = []

            # Free memory for completed elements
            elem.clear()

    return entries


def _load_or_build_catalog(force: bool = False) -> list[CellEntry]:
    """Load catalog from JSON cache, or download and parse the XML."""
    if not force and CATALOG_CACHE.exists():
        data = json.loads(CATALOG_CACHE.read_text())
        return [CellEntry(**e) for e in data]

    xml_path = _download_catalog(CATALOG_CACHE)
    entries = _parse_catalog(xml_path)
    print(f"  Parsed {len(entries)} ENC cells from catalog")

    # Cache as JSON for fast loading
    CATALOG_CACHE.parent.mkdir(parents=True, exist_ok=True)
    CATALOG_CACHE.write_text(json.dumps(
        [{"name": e.name, "title": e.title, "bbox": list(e.bbox)} for e in entries],
    ))
    print(f"  Cached to {CATALOG_CACHE}")

    return entries


def _bbox_intersects(
    a: tuple[float, float, float, float],
    b: tuple[float, float, float, float],
) -> bool:
    """Check if two bboxes (west, south, east, north) intersect."""
    return not (a[2] < b[0] or a[0] > b[2] or a[3] < b[1] or a[1] > b[3])


def query_region(
    bbox: tuple[float, float, float, float],
    cache_path: Path | None = None,
) -> list[str]:
    """Find ENC cells whose bounding polygon intersects a bounding box.

    Uses the NOAA ENC Product Catalog (ISO 19115 XML) as the authoritative
    source. Results are cached per-region for fast subsequent lookups.

    Args:
        bbox: (west, south, east, north) in lon/lat.
        cache_path: If provided, cache results to this JSON file.

    Returns:
        Sorted list of cell names (e.g. ["US2EC04M", "US5MA10M"]).
    """
    if cache_path and cache_path.exists():
        data = json.loads(cache_path.read_text())
        # Invalidate cache if bbox changed (e.g. region definition updated)
        cached_bbox = tuple(data.get("bbox", []))
        if cached_bbox == tuple(bbox):
            return data["cells"]

    catalog = _load_or_build_catalog()

    cells = sorted(
        e.name for e in catalog if _bbox_intersects(e.bbox, bbox)
    )

    if cache_path:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(json.dumps({
            "bbox": list(bbox),
            "cells": cells,
            "count": len(cells),
        }, indent=2) + "\n")

    return cells


def get_region_cells(region_name: str) -> list[str]:
    """Get cell list for a named region, using cache if available."""
    region = REGIONS[region_name]
    cache_path = CACHE_DIR / f"{region_name}.json"
    return query_region(region.bbox, cache_path)
