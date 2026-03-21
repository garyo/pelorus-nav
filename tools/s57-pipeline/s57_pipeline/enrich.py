"""Single-pass GeoJSON feature enrichment.

Combines minzoom/scale-band, labels, symbols, and S-52 metadata into
one read → modify → write pass per GeoJSON file, eliminating 3 redundant
JSON parse/serialize cycles.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from .labels import _buoy_number, _light_label, _seabed_label
from .scamin import (
    INTU_BASE_ZOOMS,
    cscl_to_scale_band,
    intu_to_scale_band,
    scamin_to_minzoom,
)


def enrich_geojson(
    geojson_path: Path,
    *,
    cell_cscl: int | None = None,
    cell_intu: int | None = None,
    intu_zoom_ranges: dict[int, tuple[int, int, int]] | None = None,
    apply_scamin: bool = True,
) -> None:
    """Enrich a GeoJSON file with all metadata in a single read/write pass.

    Adds: tippecanoe minzoom (from SCAMIN), _scale_band, LABEL,
    _disp_cat, _disp_pri. Normalizes COLOUR to a JSON array.

    Args:
        geojson_path: Path to the GeoJSON file (modified in-place).
        cell_cscl: The cell's DSPM_CSCL compilation scale.
        cell_intu: The cell's DSID_INTU intended use (1-6).
        intu_zoom_ranges: Pre-computed ranges from compute_intu_zoom_ranges().
        apply_scamin: Whether to add tippecanoe minzoom from SCAMIN attributes.
    """
    layer_name = geojson_path.stem.upper()

    with open(geojson_path) as f:
        try:
            geojson = json.load(f)
        except json.JSONDecodeError:
            # Corrupt/empty GeoJSON from ogr2ogr — remove and skip
            geojson_path.unlink(missing_ok=True)
            return

    # Pre-compute per-layer constants
    scale_band = 0
    scamin_shift = 0  # zoom levels to shift SCAMIN minzooms down
    if apply_scamin:
        if cell_intu is not None and cell_intu in INTU_BASE_ZOOMS:
            scale_band = intu_to_scale_band(cell_intu)
            # When zoom-shift is active, the cell's terrain appears earlier
            # than SCAMIN expects. Shift SCAMIN minzooms down to match,
            # so lights/navaids appear alongside their band's terrain.
            if intu_zoom_ranges is not None and cell_intu in intu_zoom_ranges:
                base_min = INTU_BASE_ZOOMS[cell_intu][0]
                adj_min = intu_zoom_ranges[cell_intu][0]
                scamin_shift = max(0, base_min - adj_min)
        elif cell_cscl is not None:
            scale_band = cscl_to_scale_band(cell_cscl)

    is_lights = layer_name == "LIGHTS"
    is_buoy_beacon = layer_name in (
        "BOYLAT", "BOYSAW", "BOYSPP", "BOYISD", "BOYCAR", "BCNLAT", "BCNCAR",
    )
    is_sbdare = layer_name == "SBDARE"
    is_buaare = layer_name == "BUAARE"

    for feature in geojson.get("features", []):
        props = feature.get("properties", {})

        # --- SCAMIN → tippecanoe minzoom ---
        if apply_scamin:
            scamin = props.get("SCAMIN")
            if scamin is not None and scamin > 0:
                if "tippecanoe" not in feature:
                    feature["tippecanoe"] = {}
                minzoom = scamin_to_minzoom(scamin)
                # Apply zoom shift so features appear alongside
                # their band's terrain (not delayed by SCAMIN)
                if scamin_shift > 0:
                    minzoom = max(0, minzoom - scamin_shift)
                # City/town names: cap at z12 so they appear earlier
                if is_buaare and minzoom > 12:
                    minzoom = 12
                feature["tippecanoe"]["minzoom"] = minzoom
            props["_scale_band"] = scale_band

        # --- Labels ---
        if is_lights:
            label = _light_label(props)
            if label:
                props["LABEL"] = label
        elif is_buoy_beacon:
            label = _buoy_number(props)
            if label:
                props["LABEL"] = label
        elif is_sbdare:
            label = _seabed_label(props)
            if label:
                props["LABEL"] = label

        # --- BUAARE name cleanup (strip census suffixes) ---
        if is_buaare:
            objnam = props.get("OBJNAM")
            if objnam:
                # Strip ", XX Urban Clu..." or ", XX Urban ..." suffixes
                props["OBJNAM"] = re.sub(
                    r",\s+\w{2}\s+Urban\b.*$", "", objnam
                )

        # Flatten any list-valued properties to comma-separated strings.
        # ogr2ogr writes S-57 StringList fields as JSON arrays (e.g.
        # ["1","11"]), but MVT only supports flat values — tippecanoe
        # would serialize them as '["1","11"]'. Flatten so MapLibre
        # sees "1,11" for reliable substring matching.
        for key, val in props.items():
            if isinstance(val, list):
                props[key] = ",".join(str(v) for v in val)

    with open(geojson_path, "w") as f:
        json.dump(geojson, f)


# Layers whose features may have co-located TOPMAR features.
_TOPMAR_PARENT_LAYERS = {
    "BOYLAT", "BOYSAW", "BOYSPP", "BOYISD", "BOYCAR",
    "BCNLAT", "BCNCAR", "BCNSPP",
    "LIGHTS", "FOGSIG",
}


def correlate_topmarks(output_dir: Path) -> None:
    """Mark buoy/beacon features that have a co-located TOPMAR.

    Reads the TOPMAR GeoJSON (if present) and builds a coordinate lookup.
    Then scans each buoy/beacon GeoJSON and sets ``HAS_TOPMAR=1`` on
    features whose position matches a topmark within ~1 m.

    This allows the frontend to use a data-driven text offset so that
    labels clear the topmark symbol.
    """
    topmar_path = output_dir / "topmar.geojson"
    if not topmar_path.exists():
        return

    with open(topmar_path) as f:
        try:
            topmar_geojson = json.load(f)
        except json.JSONDecodeError:
            return

    # Build set of rounded coordinates (5 decimal places ≈ 1 m)
    topmar_coords: set[tuple[float, float]] = set()
    for feat in topmar_geojson.get("features", []):
        geom = feat.get("geometry")
        if geom and geom.get("type") == "Point":
            coords = geom["coordinates"]
            topmar_coords.add((round(coords[0], 5), round(coords[1], 5)))

    if not topmar_coords:
        return

    # Annotate parent buoy/beacon features
    for layer_name in _TOPMAR_PARENT_LAYERS:
        path = output_dir / f"{layer_name.lower()}.geojson"
        if not path.exists():
            continue

        with open(path) as f:
            try:
                geojson = json.load(f)
            except json.JSONDecodeError:
                continue

        modified = False
        for feat in geojson.get("features", []):
            geom = feat.get("geometry")
            if geom and geom.get("type") == "Point":
                coords = geom["coordinates"]
                key = (round(coords[0], 5), round(coords[1], 5))
                if key in topmar_coords:
                    feat.setdefault("properties", {})["HAS_TOPMAR"] = 1
                    modified = True

        if modified:
            with open(path, "w") as f:
                json.dump(geojson, f)
