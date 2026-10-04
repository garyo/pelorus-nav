"""Choose island-name label anchors that keep labels off neighbouring land.

The front-end places LNDARE ``OBJNAM`` labels with MapLibre variable anchors,
which offset the label 1.5 em from the feature's point in one of eight
directions. Next to a larger island, the default choice can write a tiny
islet's name across its neighbour. This pass scores every candidate anchor of
each named LNDARE feature by how much of the label box would cover *other*
land, per zoom band, and stamps the acceptable anchors on the feature as
``_la11`` … ``_la16`` (band [N, N+1); ``_la11`` also applies below z11 and
``_la16`` at z16 and above).

Values: ``"*"`` every candidate is fine (keep the default placement), ``"-"``
none is (hide the label in that band), ``"!R"`` (polygons) the default
placement minus the one position over land, ``"C"`` only centred, else a
short list of MapLibre anchor names: optionally ``C`` (when centring scores
best), then the best offset direction, then whichever of its two ring
neighbours are also acceptable, e.g. ``"C,B,BR,BL"`` or ``"R,TR"``. Keeping
hints to these forms keeps the style's lookup table small while leaving
MapLibre fallbacks when soundings or symbols take the first choice. An anchor
names the label edge nearest the point, so ``"T"`` puts the label below the
point and ``"R"`` puts it to the west.
"""

from __future__ import annotations

import json
import math
from collections.abc import Sequence
from pathlib import Path
from typing import TYPE_CHECKING, NamedTuple

from .enrich import _atomic_json_write

if TYPE_CHECKING:
    import numpy as np
    from numpy.typing import NDArray
    from shapely import STRtree
    from shapely.geometry.base import BaseGeometry

# Zoom bands [N, N+1) that receive a ``_laN`` property.
BANDS = range(11, 17)
# Fractional zooms sampled within a band; a candidate's worst score counts.
BAND_SAMPLES = (0.0, 0.5, 0.99)

# Label text size mirrors the s57-lndare-label layer in
# src/chart/styles/layers/text.ts (10 px at z11 → 13 px at z14); keep in sync.
TEXT_SIZE_MIN_ZOOM = 11.0
TEXT_SIZE_MAX_ZOOM = 14.0
TEXT_SIZE_AT_MIN_ZOOM = 10.0
# User text-size scale assumed for the label box: a compromise between the
# default 1.0 and the large scales some users choose.
TEXT_SCALE = 1.3
# Approximate italic glyph advance and line height, in ems.
CHAR_WIDTH_EM = 0.55
LINE_HEIGHT_EM = 1.2
# MapLibre's variable-anchor radial offset, in ems.
RADIAL_OFFSET_EM = 1.5

# Highest fraction of a label box that may cover other land.
MAX_OVERLAP = 0.10
# Land footprint of point-primitive LNDARE (islets, rocks), in metres.
POINT_FOOTPRINT_M = 10.0
# polylabel tolerance, in metres.
POLYLABEL_TOLERANCE_M = 1.0

# Ground metres per pixel at z0 on the equator, for 512-px tiles.
METRES_PER_PX_Z0 = 78271.517
# Equirectangular metres per degree.
METRES_PER_DEG_LON = 111320.0
METRES_PER_DEG_LAT = 110540.0

UNCONSTRAINED = "*"
HIDDEN = "-"
# Offset anchors in ring order: each one's label position (below, below-left,
# left, ...) is adjacent to its neighbours'. src/chart/styles/land-label-anchors.ts
# enumerates hints from the same ring; keep them in sync.
OFFSET_RING = ("T", "TR", "R", "BR", "B", "BL", "L", "TL")
OFFSET_ANCHORS = OFFSET_RING
# Exclusion hint ("!" + one code) for a polygon with a single position over
# land: the style keeps the whole default order minus that position.
EXCLUDE_PREFIX = "!"
POLYGON_ANCHORS = ("C", *OFFSET_ANCHORS)


def metres_per_pixel(zoom: float, lat0: float) -> float:
    """Ground metres per screen pixel at a fractional zoom and latitude."""
    return METRES_PER_PX_Z0 * math.cos(math.radians(lat0)) / 2**zoom


def label_box_size(
    zoom: float, name_len: int, lat0: float
) -> tuple[float, float, float]:
    """Label (width, height, radial offset) in metres at a fractional zoom."""
    z = min(max(zoom, TEXT_SIZE_MIN_ZOOM), TEXT_SIZE_MAX_ZOOM)
    size_px = (TEXT_SIZE_AT_MIN_ZOOM + (z - TEXT_SIZE_MIN_ZOOM)) * TEXT_SCALE
    mpp = metres_per_pixel(zoom, lat0)
    return (
        CHAR_WIDTH_EM * size_px * name_len * mpp,
        LINE_HEIGHT_EM * size_px * mpp,
        RADIAL_OFFSET_EM * size_px * mpp,
    )


def candidate_box(
    anchor: str, ax: float, ay: float, w: float, h: float, r: float
) -> tuple[float, float, float, float]:
    """Label box (minx, miny, maxx, maxy) in map metres, y up, for an anchor."""
    if anchor == "C":
        return (ax - w / 2, ay - h / 2, ax + w / 2, ay + h / 2)
    if anchor == "T":
        return (ax - w / 2, ay - r - h, ax + w / 2, ay - r)
    if anchor == "B":
        return (ax - w / 2, ay + r, ax + w / 2, ay + r + h)
    if anchor == "L":
        return (ax + r, ay - h / 2, ax + r + w, ay + h / 2)
    if anchor == "R":
        return (ax - r - w, ay - h / 2, ax - r, ay + h / 2)
    d = r / math.sqrt(2)
    x0 = ax + d if anchor[1] == "L" else ax - d - w
    y0 = ay - d - h if anchor[0] == "T" else ay + d
    return (x0, y0, x0 + w, y0 + h)


def overlap_fractions(
    land: Sequence[BaseGeometry], boxes: NDArray[np.float64]
) -> NDArray[np.float64]:
    """Fraction of each box (rows of minx, miny, maxx, maxy) covered by ``land``.

    Overlaps are summed per land piece rather than unioned: LNDARE areas
    within one cell share edges but don't overlap (any overlap only makes a
    score more conservative), and unioning a dense archipelago costs far
    more than clipping each piece to each box.
    """
    import numpy as np
    import shapely

    covered = np.zeros(len(boxes))
    if len(land):
        pieces = np.asarray(land, dtype=object)
        rects = shapely.box(boxes[:, 0], boxes[:, 1], boxes[:, 2], boxes[:, 3])
        box_idx, piece_idx = shapely.STRtree(pieces).query(rects)
        hit = pieces[piece_idx]
        # A piece whose bounds lie inside its box needs no overlay.
        hit_bounds, box_bounds = shapely.bounds(hit), boxes[box_idx]
        inside = np.all(
            (hit_bounds[:, :2] >= box_bounds[:, :2])
            & (hit_bounds[:, 2:] <= box_bounds[:, 2:]),
            axis=1,
        )
        areas = shapely.area(hit)
        # Rectangle clipping is several times faster than a general overlay.
        for k in np.flatnonzero(~inside):
            areas[k] = shapely.clip_by_rect(hit[k], *box_bounds[k]).area
        np.add.at(covered, box_idx, areas)
    sizes = (boxes[:, 2] - boxes[:, 0]) * (boxes[:, 3] - boxes[:, 1])
    return covered / sizes


def encode_anchors(scores: dict[str, float]) -> str:
    """Encode a band's worst-case anchor scores as a ``_laN`` value."""
    ok = [a for a, s in scores.items() if s <= MAX_OVERLAP]
    if len(ok) == len(scores):
        return UNCONSTRAINED
    if not ok:
        return HIDDEN
    bad = [a for a in scores if a not in ok]
    if len(bad) == 1 and "C" in scores:
        # Nearly everything is clear: keep the full default order as
        # fallbacks and only rule out the one position over land.
        return EXCLUDE_PREFIX + bad[0]
    rank = {a: round(scores[a], 2) for a in ok}

    def usable_neighbours(a: str) -> list[str]:
        i = OFFSET_RING.index(a)
        ring = (
            OFFSET_RING[(i - 1) % len(OFFSET_RING)],
            OFFSET_RING[(i + 1) % len(OFFSET_RING)],
        )
        return [n for n in ring if n in rank]

    offsets = [a for a in ok if a != "C"]
    if not offsets:
        return "C"
    # Least overlap first; on a tie, the direction with more usable
    # neighbours, since those are MapLibre's fallbacks.
    best = min(
        offsets,
        key=lambda a: (rank[a], -len(usable_neighbours(a)), OFFSET_RING.index(a)),
    )
    codes = [best, *usable_neighbours(best)]
    # Centre leads when it scores at least as well (labels sit on their own land).
    if "C" in rank and rank["C"] <= rank[best]:
        codes.insert(0, "C")
    return ",".join(codes)


class _Land(NamedTuple):
    """One LNDARE feature, its geometry projected to local metres."""

    feature: dict
    name: str | None
    geom: BaseGeometry
    footprint: BaseGeometry


def annotate_land_label_anchors(output_dir: Path) -> None:
    """Stamp ``_la11`` … ``_la16`` anchor choices on named LNDARE features.

    Reads and rewrites ``lndare.geojson`` in place; a missing or unparsable
    file is left alone. Every LNDARE geometry counts as land; pieces sharing
    a name (one island split at cell edges) never push each other's labels.
    Named features whose geometry can't be scored are left unconstrained.
    """
    path = output_dir / "lndare.geojson"
    if not path.exists():
        return
    with open(path) as f:
        try:
            geojson = json.load(f)
        except json.JSONDecodeError:
            return

    features = geojson.get("features", [])
    named = [feat for feat in features if _name(feat)]
    if not named:
        return
    for feat in named:
        for z in BANDS:
            feat["properties"][f"_la{z}"] = UNCONSTRAINED

    lands, lat0 = _load_lands(features)
    if lands:
        from shapely import STRtree

        tree = STRtree([land.footprint for land in lands])
        for land in lands:
            if land.name:
                for z, code in _band_codes(land, lands, tree, lat0).items():
                    land.feature["properties"][f"_la{z}"] = code

    _atomic_json_write(path, geojson)


def _name(feature: dict) -> str | None:
    return (feature.get("properties") or {}).get("OBJNAM") or None


def _load_lands(features: list[dict]) -> tuple[list[_Land], float]:
    """Usable features projected to metres about the cell's centre, and its latitude."""
    import shapely

    parsed = [(feat, _parse_geometry(feat.get("geometry"))) for feat in features]
    usable = [(feat, g) for feat, g in parsed if g is not None]
    if not usable:
        return [], 0.0
    minx, miny, maxx, maxy = shapely.total_bounds([g for _, g in usable])
    lon0, lat0 = (minx + maxx) / 2, (miny + maxy) / 2
    kx = METRES_PER_DEG_LON * math.cos(math.radians(lat0))

    def project(coords: NDArray[np.float64]) -> NDArray[np.float64]:
        out = coords.copy()
        out[:, 0] = (coords[:, 0] - lon0) * kx
        out[:, 1] = (coords[:, 1] - lat0) * METRES_PER_DEG_LAT
        return out

    lands = []
    for feat, g in usable:
        geom = shapely.transform(g, project)
        lands.append(_Land(feat, _name(feat), geom, _footprint(geom)))
    return lands, float(lat0)


def _parse_geometry(geom: dict | None) -> BaseGeometry | None:
    """GeoJSON geometry → valid, non-empty shapely geometry, or None."""
    if not geom:
        return None
    from shapely.geometry import shape

    try:
        shp = shape(geom)
    except (ValueError, TypeError, KeyError, AttributeError):
        return None
    if not shp.is_empty and not shp.is_valid:
        shp = shp.buffer(0)
    return None if shp.is_empty else shp


def _footprint(geom: BaseGeometry) -> BaseGeometry:
    """Land footprint in metres: the polygon, or a small disc for points/lines."""
    if geom.geom_type in ("Polygon", "MultiPolygon"):
        return geom
    return geom.buffer(POINT_FOOTPRINT_M)


def _label_anchor(
    geom: BaseGeometry,
) -> tuple[tuple[float, float], Sequence[str]] | None:
    """Label point and its candidate anchors; None for non-areal, non-point land."""
    from shapely.ops import polylabel

    if geom.geom_type == "Point":
        # A centred label would cover the islet's own symbol.
        return (geom.x, geom.y), OFFSET_ANCHORS
    if geom.geom_type == "MultiPolygon":
        geom = max(geom.geoms, key=lambda p: p.area)
    if geom.geom_type != "Polygon":
        return None
    pt = polylabel(geom, tolerance=POLYLABEL_TOLERANCE_M)
    return (pt.x, pt.y), POLYGON_ANCHORS


def _band_codes(
    land: _Land, lands: list[_Land], tree: STRtree, lat0: float
) -> dict[int, str]:
    """Encoded anchor choice per zoom band for one named feature."""
    import numpy as np
    import shapely

    placed = _label_anchor(land.geom)
    if placed is None:
        return dict.fromkeys(BANDS, UNCONSTRAINED)
    (ax, ay), anchors = placed

    name_len = len(land.name or "")
    boxes = np.array(
        [
            candidate_box(a, ax, ay, *label_box_size(z + dz, name_len, lat0))
            for z in BANDS
            for dz in BAND_SAMPLES
            for a in anchors
        ]
    )
    window = shapely.box(*boxes[:, :2].min(axis=0), *boxes[:, 2:].max(axis=0))
    others = [
        shapely.clip_by_rect(lands[j].footprint, *window.bounds)
        for j in tree.query(window)
        if lands[j].name != land.name
    ]
    # Land under the feature itself (e.g. an overlapping duplicate) is not
    # "other" land.
    others = [
        g.difference(land.footprint) if g.intersects(land.footprint) else g
        for g in others
        if not g.is_empty
    ]

    scores = overlap_fractions(others, boxes).reshape(
        len(BANDS), len(BAND_SAMPLES), len(anchors)
    )
    worst = scores.max(axis=1)
    return {
        z: encode_anchors(dict(zip(anchors, map(float, row), strict=True)))
        for z, row in zip(BANDS, worst, strict=True)
    }
