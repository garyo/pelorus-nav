"""Extract named features from enriched GeoJSON into a compact search index.

Produces a JSON file per region with feature names, types, centroids,
and optional bounding boxes for area/line features.  The front-end uses
this index for type-ahead search with autocomplete.
"""

from __future__ import annotations

import json
from pathlib import Path

from shapely.geometry import shape


# Layers to skip — either unnamed or too numerous/uninteresting for search.
_SKIP_LAYERS = frozenset({
    "SOUNDG", "DEPARE", "DEPCNT", "SBDARE", "MAGVAR",
    "UNSARE", "DRGARE", "LAKARE", "RIVERS",
    "TOPMAR", "DAYMAR",  # topmarks/daymarks are co-located with parent navaids
    "COALNE", "SLCONS",  # coastline/shoreline — unnamed line features
    "DYKCON", "SLOTOP",  # unnamed terrain lines
})


def _centroid(geometry: dict) -> tuple[float, float] | None:
    """Return (lon, lat) centroid for a GeoJSON geometry, or None."""
    geom_type = geometry.get("type")
    if not geom_type:
        return None

    if geom_type == "Point":
        coords = geometry["coordinates"]
        return (round(coords[0], 4), round(coords[1], 4))

    # For complex geometries, use Shapely
    try:
        geom = shape(geometry)
        if geom.is_empty:
            return None
        pt = geom.centroid
        return (round(pt.x, 4), round(pt.y, 4))
    except Exception:
        return None


def _bbox(geometry: dict) -> tuple[float, float, float, float] | None:
    """Return (west, south, east, north) bbox for non-point geometries."""
    geom_type = geometry.get("type")
    if not geom_type or geom_type == "Point":
        return None

    try:
        geom = shape(geometry)
        if geom.is_empty:
            return None
        bounds = geom.bounds  # (minx, miny, maxx, maxy)
        return (
            round(bounds[0], 4),
            round(bounds[1], 4),
            round(bounds[2], 4),
            round(bounds[3], 4),
        )
    except Exception:
        return None


def extract_search_index(
    work_dir: Path,
    cell_names: list[str],
) -> list[dict]:
    """Extract named features from processed cells' GeoJSON directories.

    Args:
        work_dir: The pipeline work directory (contains {cell_name}/geojson/).
        cell_names: List of cell names to scan.

    Returns:
        Deduplicated list of compact feature dicts ready for JSON serialization.
    """
    # Dedup key → feature dict
    seen: dict[tuple[str, str, float, float], dict] = {}

    for cell_name in cell_names:
        geojson_dir = work_dir / cell_name / "geojson"
        if not geojson_dir.exists():
            continue

        for geojson_path in geojson_dir.glob("*.geojson"):
            layer_name = geojson_path.stem.upper()
            if layer_name in _SKIP_LAYERS:
                continue

            try:
                with open(geojson_path) as f:
                    data = json.load(f)
            except (json.JSONDecodeError, OSError):
                continue

            for feature in data.get("features", []):
                props = feature.get("properties", {})
                objnam = props.get("OBJNAM")
                if not objnam or not str(objnam).strip():
                    continue

                name = str(objnam).strip()
                geometry = feature.get("geometry")
                if not geometry:
                    continue

                center = _centroid(geometry)
                if center is None:
                    continue

                # Dedup by (name_lower, layer, rounded centroid)
                dedup_key = (name.lower(), layer_name, center[0], center[1])
                if dedup_key in seen:
                    continue

                entry: dict = {
                    "n": name,
                    "t": layer_name,
                    "c": list(center),
                }

                bbox = _bbox(geometry)
                if bbox is not None:
                    entry["b"] = list(bbox)

                label = props.get("LABEL")
                if label and str(label).strip() and str(label).strip() != name:
                    entry["l"] = str(label).strip()

                seen[dedup_key] = entry

    # Sort: cities/towns first, then landmarks, then alphabetically
    type_priority = _type_priority()
    features = sorted(
        seen.values(),
        key=lambda f: (type_priority.get(f["t"], 50), f["n"]),
    )
    return features


def _type_priority() -> dict[str, int]:
    """Priority order for search results (lower = higher priority)."""
    return {
        "BUAARE": 0,   # Cities/towns
        "LNDMRK": 5,   # Landmarks
        "SEAARE": 10,   # Sea areas
        "LNDARE": 12,   # Land areas (islands)
        "LNDRGN": 13,   # Land regions
        "BRIDGE": 15,   # Bridges
        "HRBFAC": 16,   # Harbor facilities
        "SMCFAC": 17,   # Small craft facilities (marinas)
        "RESARE": 20,   # Restricted areas
        "ACHARE": 21,   # Anchorage areas
        "FAIRWY": 22,   # Fairways
        "CTNARE": 23,   # Caution areas
        "BOYLAT": 30,   # Buoys
        "BOYCAR": 30,
        "BOYSAW": 30,
        "BOYSPP": 30,
        "BOYISD": 30,
        "BCNLAT": 31,   # Beacons
        "BCNCAR": 31,
        "BCNSPP": 31,
        "LIGHTS": 32,   # Lights
        "WRECKS": 35,   # Wrecks
        "OBSTRN": 36,   # Obstructions
    }


def write_search_index(features: list[dict], output_path: Path) -> None:
    """Write the search index JSON file.

    Args:
        features: List of compact feature dicts from extract_search_index().
        output_path: Path to write the JSON file.
    """
    output_path.parent.mkdir(parents=True, exist_ok=True)
    index = {
        "version": 1,
        "features": features,
    }
    with open(output_path, "w") as f:
        json.dump(index, f, separators=(",", ":"))  # compact JSON
