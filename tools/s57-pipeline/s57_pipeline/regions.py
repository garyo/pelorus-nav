"""Region definitions and NOAA ArcGIS API queries for ENC cell discovery."""

from __future__ import annotations

import json
import urllib.request
import urllib.parse
from dataclasses import dataclass
from pathlib import Path

# NOAA ArcGIS ENC coverage service
COVERAGE_URL = (
    "https://gis.charttools.noaa.gov/arcgis/rest/services"
    "/encdirect/enc_coverage/MapServer"
)

# Layer IDs: 0=Overview, 1=General, 2=Coastal, 3=Approach, 4=Harbor, 5=Berthing
COVERAGE_LAYERS = [0, 1, 2, 3, 4, 5]

CACHE_DIR = Path("data/regions")


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
        name="Cape Cod to Southern Maine",
        bbox=(-71.5, 41.5, -69.8, 43.2),
        description="Full coverage for demo deployment",
    ),
}


def query_region(
    bbox: tuple[float, float, float, float],
    cache_path: Path | None = None,
) -> list[str]:
    """Query NOAA ArcGIS API for ENC cells within a bounding box.

    Args:
        bbox: (west, south, east, north) in lon/lat.
        cache_path: If provided, cache results to this JSON file.

    Returns:
        Sorted list of cell names (e.g. ["US2EC04M", "US5MA10M"]).
    """
    if cache_path and cache_path.exists():
        data = json.loads(cache_path.read_text())
        return data["cells"]

    cells: set[str] = set()
    west, south, east, north = bbox

    for layer_id in COVERAGE_LAYERS:
        url = f"{COVERAGE_URL}/{layer_id}/query"
        params = urllib.parse.urlencode({
            "geometry": f"{west},{south},{east},{north}",
            "geometryType": "esriGeometryEnvelope",
            "inSR": "4326",
            "spatialRel": "esriSpatialRelIntersects",
            "outFields": "DSNM",
            "returnGeometry": "false",
            "f": "json",
        })
        full_url = f"{url}?{params}"

        try:
            with urllib.request.urlopen(full_url, timeout=30) as resp:
                data = json.loads(resp.read())
        except Exception as e:
            print(f"Warning: failed to query layer {layer_id}: {e}")
            continue

        for feature in data.get("features", []):
            dsnm = feature.get("attributes", {}).get("DSNM", "")
            if dsnm:
                # DSNM may include .000 extension — strip it
                cell_name = dsnm.replace(".000", "")
                cells.add(cell_name)

    result = sorted(cells)

    if cache_path:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(json.dumps({
            "bbox": list(bbox),
            "cells": result,
            "count": len(result),
        }, indent=2) + "\n")

    return result


def get_region_cells(region_name: str) -> list[str]:
    """Get cell list for a named region, using cache if available."""
    region = REGIONS[region_name]
    cache_path = CACHE_DIR / f"{region_name}.json"
    return query_region(region.bbox, cache_path)
