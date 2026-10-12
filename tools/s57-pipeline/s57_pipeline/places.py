"""Which state, province or country each search-index feature lies in.

Search shows a place next to each result ("near Coronado, CA") and lets a
query name one ("coronado, ca"). Places come from Natural Earth's public-domain
1:10m boundaries: states and provinces for the US and Canada, whole countries
and territories elsewhere (Puerto Rico, the US and British Virgin Islands,
Mexico, the Bahamas). A feature outside every polygon — on the water —
takes the nearest one within ``MAX_OFFSHORE_DEG``; farther offshore it has no
place.
"""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path

from shapely import STRtree, points
from shapely.geometry import shape
from shapely.geometry.base import BaseGeometry

NATURAL_EARTH_URL = "https://naciscdn.org/naturalearth/10m/cultural"
CACHE_DIR = Path("data/naturalearth")

# Countries shown by state or province rather than as a whole.
SUBDIVIDED = ("USA", "CAN")

# Nearest-place cutoff for features on the water: 0.4° is 24 nm of latitude.
MAX_OFFSHORE_DEG = 0.4


@dataclass(frozen=True)
class Place:
    label: str  # shown after a result: "CA", "PR", "Mexico"
    codes: tuple[str, ...]  # matched whole: "CA", "USA"
    names: tuple[str, ...]  # matched by prefix: "California", "United States"

    def to_json(self) -> dict:
        return {"l": self.label, "c": list(self.codes), "n": list(self.names)}


def _unique(values: list[str]) -> tuple[str, ...]:
    return tuple(dict.fromkeys(v for v in values if v and v != "-99"))


def place_from_admin1(props: dict) -> Place:
    """A US state or Canadian province, labelled by its postal code."""
    us = props["adm0_a3"] == "USA"
    country = "United States" if us else props["admin"]
    return Place(
        label=props["postal"],
        codes=_unique([props["postal"], props["adm0_a3"], "US" if us else ""]),
        names=_unique([props["name"], country, props["admin"]]),
    )


def place_from_admin0(props: dict) -> Place:
    """A country or territory. US territories get their code, like states."""
    us = props["SOV_A3"] == "US1"
    code = props["ISO_A2_EH"]
    return Place(
        label=code if us else props["NAME"],
        codes=_unique([code, props["ADM0_A3"], *(("US", "USA") if us else ())]),
        names=_unique([
            props["NAME"], props["NAME_LONG"], "United States" if us else "",
        ]),
    )


def _natural_earth_layer(layer: str, fields: str, where: str) -> list[dict]:
    """Features of a Natural Earth layer, cached as GeoJSON after one download."""
    path = CACHE_DIR / f"{layer}.geojson"
    if not path.exists():
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        partial = path.with_suffix(".partial")
        subprocess.run(
            [
                "ogr2ogr", "-f", "GeoJSON", str(partial),
                f"/vsizip//vsicurl/{NATURAL_EARTH_URL}/{layer}.zip",
                "-select", fields, "-where", where,
            ],
            check=True, capture_output=True,
        )
        partial.rename(path)
    with open(path) as f:
        return json.load(f)["features"]


class PlaceLocator:
    """Finds the place for points, from (place, area) pairs."""

    def __init__(self, areas: list[tuple[Place, BaseGeometry]]) -> None:
        self._places = [place for place, _ in areas]
        self._tree = STRtree([geom for _, geom in areas])

    @classmethod
    def natural_earth(cls) -> PlaceLocator:
        """Locator over Natural Earth boundaries (downloads them once)."""
        subdivided = ", ".join(f"'{a3}'" for a3 in SUBDIVIDED)
        admin1 = _natural_earth_layer(
            "ne_10m_admin_1_states_provinces",
            "name,postal,admin,adm0_a3",
            f"adm0_a3 IN ({subdivided})",
        )
        admin0 = _natural_earth_layer(
            "ne_10m_admin_0_countries",
            "NAME,NAME_LONG,ISO_A2_EH,ADM0_A3,SOV_A3",
            f"ADM0_A3 NOT IN ({subdivided})",
        )
        areas = [
            (place_from_admin1(f["properties"]), shape(f["geometry"]))
            for f in admin1
        ] + [
            (place_from_admin0(f["properties"]), shape(f["geometry"]))
            for f in admin0
        ]
        return cls(areas)

    def locate(self, coords: list[tuple[float, float]]) -> list[Place | None]:
        """The place for each (lon, lat): the area containing it, else the
        nearest within ``MAX_OFFSHORE_DEG``, else None."""
        found: list[Place | None] = [None] * len(coords)
        if not coords:
            return found
        point_idx, area_idx = self._tree.query_nearest(
            points(coords), max_distance=MAX_OFFSHORE_DEG, all_matches=False,
        )
        for p, a in zip(point_idx, area_idx):
            found[p] = self._places[a]
        return found


def assign_places(features: list[dict], locator: PlaceLocator) -> list[dict]:
    """Set each feature's ``p`` to its place's index in the returned table.

    The table lists only the places used, in first-use order. Features with no
    place get no ``p``.
    """
    table: dict[Place, int] = {}
    located = locator.locate([tuple(f["c"]) for f in features])
    for feature, place in zip(features, located):
        feature.pop("p", None)
        if place is not None:
            feature["p"] = table.setdefault(place, len(table))
    return [place.to_json() for place in table]
