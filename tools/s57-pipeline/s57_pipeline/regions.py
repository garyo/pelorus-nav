"""Region definitions and ENC cell selection.

A region's cells are the Active cells of its producer — NOAA, or the US Army
Corps of Engineers for the inland rivers — in the merged ENC catalog
(enc_catalog.py) whose coverage bounding box intersects the region's bbox.
Cancelled cells are listed in the catalog without coverage, so they drop out
of every region.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

from .enc_catalog import BBox, CatalogCell
from .inland import is_inland_cell

Catalog = Mapping[str, CatalogCell]

# Overview cells (usage bands 1-3) within this many degrees of a region are
# built with it: at low zoom (z5-z7) a tile spans several degrees past the
# region boundary, and these cells fill it. Tile-center ownership (z8+)
# prevents double rendering.
OVERVIEW_MARGIN_DEG = 5.0
OVERVIEW_MAX_USAGE_BAND = 3


@dataclass(frozen=True)
class Region:
    name: str
    bbox: BBox
    description: str
    # "NOAA", or "USACE" for the Corps' Inland ENCs (tools/regions.json)
    producer: str = "NOAA"
    # Inland regions split the rivers between them by the river code in the
    # cell name (U37UM723: UM, the Upper Mississippi): their bboxes overlap
    # where the rivers meet.
    rivers: frozenset[str] | None = None

    @property
    def tile_bbox(self) -> BBox | None:
        """The area whose tiles (and coverage) this region alone serves, or
        None when it serves all its cells' tiles. A region that takes its cells
        by river owns no area: where its bbox overlaps another river region's,
        the two hold different rivers' cells, so each must keep every tile."""
        return self.bbox if self.rivers is None else None


# Shared source of truth for region id/name/bbox. See tools/regions.json.
# Descriptions are Python-only (doc/CLI), so they live here keyed by id.
REGIONS_JSON = Path(__file__).resolve().parent.parent.parent / "regions.json"

_DESCRIPTIONS: dict[str, str] = {
    "boston-test": "Boston area with approach charts -- dev iteration",
    "southern-new-england": "CT coast, RI, Buzzards Bay, Martha's Vineyard, Nantucket",
    "northern-new-england": "Cape Cod, Boston, NH coast, Maine through Downeast",
    "new-york": "Long Island, NJ coast, Delaware Bay",
    "mid-atlantic": "Chesapeake Bay through Cape Hatteras",
    "south-atlantic": "Carolinas through Florida Keys",
    "usvi": "Puerto Rico, US Virgin Islands, and approaches west to Isla de Mona",
    "gulf-coast": "TX/LA/MS/AL/west-FL coast, Gulf ICW, and Dry Tortugas",
    "great-lakes": "Lakes Superior, Michigan, Huron, Erie, Ontario, St. Clair, Detroit/Niagara rivers",
    "ny-inland": "Erie Canal, Oswego Canal, Mohawk River, Finger Lakes (Seneca, Cayuga), Oneida Lake",
    "inland-rivers-north": "USACE Inland ENCs: Upper Mississippi, Illinois, Missouri, Kaskaskia, Ohio, Allegheny, Monongahela, Kanawha, Green",
    "inland-rivers-south": "USACE Inland ENCs: Lower Mississippi, Arkansas, White, Red, Ouachita, Atchafalaya, Tennessee, Cumberland, Clinch, Tenn-Tom, Tombigbee, Black Warrior",
    "washington": "WA outer coast, Strait of Juan de Fuca, San Juan Islands, Puget Sound (Seattle/Tacoma)",
    "oregon": "Oregon coast (Brookings to Astoria) and lower Columbia River",
    "northern-california": "CA coast from Bodega/Point Reyes north — Mendocino, Eureka, Crescent City",
    "central-california": "Point Conception to Point Reyes — Big Sur, Monterey Bay, San Francisco Bay, Half Moon Bay",
    "southern-california": "San Diego to Point Conception — Channel Islands, Catalina, LA/Long Beach",
    "hawaii": "Hawaiian Islands (Kauai, Oahu, Molokai, Maui, Lanai, Hawai'i) and approaches",
}


def _load_regions() -> dict[str, Region]:
    raw = json.loads(REGIONS_JSON.read_text())
    out: dict[str, Region] = {}
    for entry in raw:
        rid = entry["id"]
        out[rid] = Region(
            name=entry["name"],
            bbox=tuple(entry["bbox"]),  # type: ignore[arg-type]
            description=_DESCRIPTIONS.get(rid, ""),
            producer=entry.get("producer", "NOAA"),
            rivers=frozenset(entry["rivers"]) if "rivers" in entry else None,
        )
    return out


REGIONS: dict[str, Region] = _load_regions()


def usage_band(cell_name: str) -> int:
    """NOAA usage band, the digit after "US" in the cell name (US5MA22M → 5).
    Inland ENCs (U37…) are river charts at harbour scale: band 5."""
    if is_inland_cell(cell_name):
        return 5
    return int(cell_name[2])


def _bbox_intersects(a: BBox, b: BBox) -> bool:
    return not (a[2] < b[0] or a[0] > b[2] or a[3] < b[1] or a[1] > b[3])


def query_region(bbox: BBox, catalog: Catalog) -> list[str]:
    """Sorted names of the Active cells whose coverage intersects ``bbox``."""
    return sorted(
        cell.name
        for cell in catalog.values()
        if cell.active and cell.bbox is not None and _bbox_intersects(cell.bbox, bbox)
    )


def get_region_cells(region_name: str, catalog: Catalog) -> list[str]:
    """The Active cells of a named region, from its producer's charts."""
    region = REGIONS[region_name]
    inland = region.producer == "USACE"
    return [
        c
        for c in query_region(region.bbox, catalog)
        if is_inland_cell(c) == inland
        and (region.rivers is None or c[3:5] in region.rivers)
    ]


def get_region_build_cells(region_name: str, catalog: Catalog) -> list[str]:
    """The cells a region's build draws on: its own cells, followed by the
    overview cells within OVERVIEW_MARGIN_DEG of it."""
    cells = get_region_cells(region_name, catalog)
    if REGIONS[region_name].producer != "NOAA":
        return cells  # NOAA's overview charts belong to NOAA regions
    own = set(cells)
    west, south, east, north = REGIONS[region_name].bbox
    m = OVERVIEW_MARGIN_DEG
    nearby = query_region((west - m, south - m, east + m, north + m), catalog)
    return cells + [
        c for c in nearby if c not in own and usage_band(c) <= OVERVIEW_MAX_USAGE_BAND
    ]


# NOAA's harbour and berthing charts take precedence over the river charts:
# richer than the Corps' where the two meet, and NOAA comes first.
NOAA_PRECEDENCE_BAND = 5


def ceded_cells(region_name: str, catalog: Catalog) -> list[str]:
    """NOAA's harbour and berthing cells a river region gives way to: where
    one covers the water, the river chart is cut away along its coverage so
    NOAA's chart alone is drawn there. Other regions cede nothing."""
    region = REGIONS[region_name]
    if region.rivers is None:
        return []
    boxes = [
        bbox
        for c in get_region_cells(region_name, catalog)
        if (bbox := catalog[c].bbox) is not None
    ]
    return sorted(
        cell.name
        for cell in catalog.values()
        if cell.active
        and cell.bbox is not None
        and not is_inland_cell(cell.name)
        and usage_band(cell.name) >= NOAA_PRECEDENCE_BAND
        and any(_bbox_intersects(cell.bbox, b) for b in boxes)
    )


def unclaimed_inland_cells(catalog: Catalog) -> list[str]:
    """Active Inland ENC cells no region takes: a river the Corps has added
    whose code no inland region lists yet (tools/regions.json "rivers")."""
    claimed = {
        cell
        for name, region in REGIONS.items()
        if region.producer == "USACE"
        for cell in get_region_cells(name, catalog)
    }
    return sorted(
        c.name
        for c in catalog.values()
        if c.active and is_inland_cell(c.name) and c.name not in claimed
    )
