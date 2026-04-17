"""Single-pass GeoJSON feature enrichment.

Combines minzoom/scale-band, labels, symbols, and S-52 metadata into
one read → modify → write pass per GeoJSON file, eliminating 3 redundant
JSON parse/serialize cycles.
"""

from __future__ import annotations

import json
import os
import re
import tempfile
from pathlib import Path


def _atomic_json_write(path: Path, data: object) -> None:
    """Write JSON atomically — write to temp file then rename."""
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(data, f)
        os.replace(tmp, path)
    except BaseException:
        os.unlink(tmp)
        raise
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from shapely import STRtree
    from shapely.geometry import Polygon

from .labels import _buoy_number, _fogsig_label, _light_label, _seabed_label
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
    cell_id: int | None = None,
    intu_zoom_ranges: dict[int, tuple[int, int, int]] | None = None,
    apply_scamin: bool = True,
) -> None:
    """Enrich a GeoJSON file with all metadata in a single read/write pass.

    Adds: tippecanoe minzoom (from SCAMIN), _scale_band, _cell_id, LABEL,
    _disp_cat, _disp_pri. Normalizes COLOUR to a JSON array.

    Args:
        geojson_path: Path to the GeoJSON file (modified in-place).
        cell_cscl: The cell's DSPM_CSCL compilation scale.
        cell_intu: The cell's DSID_INTU intended use (1-6).
        cell_id: Numeric identifier for the source ENC cell.
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
    is_fogsig = layer_name == "FOGSIG"
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
            if cell_id is not None:
                props["_cell_id"] = cell_id

        # --- Labels ---
        if is_lights:
            label = _light_label(props)
            if label:
                props["LABEL"] = label
        elif is_fogsig:
            label = _fogsig_label(props)
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

    _atomic_json_write(geojson_path, geojson)


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
            _atomic_json_write(path, geojson)


def _split_list_attr(value: object) -> list[str]:
    """Split a list-typed S-57 attribute (pre-flatten list or comma-string)."""
    if value is None:
        return []
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    if isinstance(value, (int, float)):
        return [str(value)]
    return [s.strip() for s in str(value).split(",") if s.strip()]


def annotate_parents(output_dir: Path) -> None:
    """Stamp each child feature with PARENT_LNAM / PARENT_OBJNAM / PARENT_LAYER.

    S-57 FFPT (feature-to-feature pointer) relationships are encoded on the
    parent feature, not on the children — the parent carries ``LNAM_REFS``
    (a list of child LNAMs) and ``FFPT_RIND`` (a parallel list of relation
    indicators; the S-57 spec's value ``2`` denotes the child relationship
    the spec calls "slave"). Per the NOAA NCM §5.30.19, a multi-sector or
    directional light is one parent structure (e.g. BCNSPP) plus N
    co-located LIGHTS children.

    This pass runs after ``enrich_geojson`` for every per-layer geojson in
    a cell, so ``LNAM_REFS`` / ``FFPT_RIND`` may arrive either as lists
    (if flattening was deferred) or as comma-separated strings. We handle
    both. The result is written back in place; files untouched by this
    pass are not rewritten.
    """
    loaded: dict[Path, dict] = {}
    for path in sorted(output_dir.glob("*.geojson")):
        try:
            with open(path) as f:
                loaded[path] = json.load(f)
        except json.JSONDecodeError:
            continue

    if not loaded:
        return

    lnam_index: dict[str, tuple[Path, dict]] = {}
    for path, geojson in loaded.items():
        for feat in geojson.get("features", []):
            lnam = (feat.get("properties") or {}).get("LNAM")
            if lnam:
                lnam_index[str(lnam)] = (path, feat)

    modified: set[Path] = set()
    for parent_path, geojson in loaded.items():
        parent_layer = parent_path.stem.upper()
        for parent in geojson.get("features", []):
            pprops = parent.get("properties") or {}
            refs = _split_list_attr(pprops.get("LNAM_REFS"))
            if not refs:
                continue
            rinds = _split_list_attr(pprops.get("FFPT_RIND"))
            parent_lnam = pprops.get("LNAM")
            parent_objnam = pprops.get("OBJNAM")
            if not parent_lnam:
                continue
            for i, ref in enumerate(refs):
                # RIND=2 is the S-57 child indicator; treat missing/empty
                # as child too (NOAA sometimes omits the RIND array when
                # only children exist).
                rind = rinds[i] if i < len(rinds) else ""
                if rind not in ("2", ""):
                    continue
                entry = lnam_index.get(ref)
                if entry is None:
                    continue  # cross-cell reference — skip silently
                child_path, child = entry
                cprops = child.setdefault("properties", {})
                cprops["PARENT_LNAM"] = str(parent_lnam)
                cprops["PARENT_LAYER"] = parent_layer
                if parent_objnam:
                    cprops["PARENT_OBJNAM"] = parent_objnam
                modified.add(child_path)

    for path in modified:
        _atomic_json_write(path, loaded[path])


# Layers that may be isolated dangers (S-52 UDWHAZ05).
_HAZARD_LAYERS = {"OBSTRN", "WRECKS", "UWTROC"}


def annotate_enclosing_depth(output_dir: Path) -> None:
    """Add ``_enclosing_depth`` to hazard features from enclosing DEPARE polygons.

    For each OBSTRN, WRECKS, and UWTROC point feature, finds the enclosing
    DEPARE polygon and stores its DRVAL1 as ``_enclosing_depth``.  The frontend
    uses this to display the S-52 isolated danger symbol (ISODGR) when a hazard
    is shallower than safetyDepth but lies in otherwise safe water.
    """
    depare_path = output_dir / "depare.geojson"
    if not depare_path.exists():
        return

    # Build spatial index of DEPARE polygons
    depare_polys, depare_drval1 = _load_depare_index(depare_path)
    if not depare_polys:
        return

    from shapely import STRtree  # noqa: F811
    from shapely.geometry import Point

    tree = STRtree(depare_polys)

    for layer_name in _HAZARD_LAYERS:
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
            if not geom or geom.get("type") != "Point":
                continue
            coords = geom["coordinates"]
            pt = Point(coords[0], coords[1])

            # Find enclosing DEPARE polygon(s) — take the one with highest DRVAL1
            # (most detailed / highest scale band wins in overlap areas)
            best_drval1: float | None = None
            for idx in tree.query(pt):
                poly = depare_polys[idx]
                if poly.contains(pt):
                    drval1 = depare_drval1[idx]
                    if best_drval1 is None or drval1 > best_drval1:
                        best_drval1 = drval1

            if best_drval1 is not None:
                feat.setdefault("properties", {})["_enclosing_depth"] = best_drval1
                modified = True

        if modified:
            _atomic_json_write(path, geojson)


def _load_depare_index(
    depare_path: Path,
) -> tuple[list[Polygon], list[float]]:
    """Load DEPARE polygons and their DRVAL1 values for spatial indexing."""
    from shapely.geometry import shape

    with open(depare_path) as f:
        try:
            geojson = json.load(f)
        except json.JSONDecodeError:
            return [], []

    polys: list[Polygon] = []
    drval1s: list[float] = []

    for feat in geojson.get("features", []):
        geom = feat.get("geometry")
        props = feat.get("properties", {})
        drval1 = props.get("DRVAL1")
        if geom is None or drval1 is None:
            continue
        geom_type = geom.get("type", "")
        if geom_type not in ("Polygon", "MultiPolygon"):
            continue
        try:
            shp = shape(geom)
            if not shp.is_valid:
                shp = shp.buffer(0)
            if geom_type == "MultiPolygon":
                for p in shp.geoms:
                    polys.append(p)
                    drval1s.append(float(drval1))
            else:
                polys.append(shp)
                drval1s.append(float(drval1))
        except Exception:
            continue

    return polys, drval1s
