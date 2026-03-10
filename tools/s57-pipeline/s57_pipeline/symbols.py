"""Compute semantic SYMBOL property for nav aid features.

Adds a SYMBOL property to GeoJSON features for sprite-based rendering.
The SYMBOL values are semantic (icon-set-agnostic) — the style layer maps
them to specific sprite names for the active icon set.
"""

from __future__ import annotations

import json
from pathlib import Path

# S-57 BOYSHP (buoy shape) codes
BOYSHP_CONICAL = 1
BOYSHP_CAN = 2
BOYSHP_SPHERICAL = 3
BOYSHP_PILLAR = 4
BOYSHP_SPAR = 5
BOYSHP_BARREL = 6
BOYSHP_SUPER = 7
BOYSHP_ICE = 8

# S-57 CATLAM (category of lateral mark)
CATLAM_PORT = 1
CATLAM_STBD = 2

# S-57 CATCAM (category of cardinal mark)
CATCAM_NORTH = 1
CATCAM_SOUTH = 2
CATCAM_EAST = 3
CATCAM_WEST = 4

# S-57 CATWRK (category of wreck)
CATWRK_NONDANGEROUS = 1
CATWRK_DANGEROUS = 2
CATWRK_DISTRIBUTED = 3
CATWRK_MAST_SHOWING = 4
CATWRK_HULL_SHOWING = 5

# S-57 WATLEV (water level effect)
WATLEV_DRY = 2
WATLEV_SUBMERGED = 3
WATLEV_COVERS = 4
WATLEV_AWASH = 5
WATLEV_FLOODS = 7

# S-57 CATOBS (category of obstruction)
CATOBS_FOUL_AREA = 6
CATOBS_FOUL_GROUND = 7

# Map BOYSHP to shape name
_SHAPE_MAP: dict[int, str] = {
    BOYSHP_CONICAL: "conical",
    BOYSHP_CAN: "can",
    BOYSHP_SPHERICAL: "spherical",
    BOYSHP_PILLAR: "pillar",
    BOYSHP_SPAR: "spar",
    BOYSHP_BARREL: "pillar",
    BOYSHP_SUPER: "pillar",
    BOYSHP_ICE: "pillar",
}


def _parse_colours(props: dict) -> list[int]:
    """Extract COLOUR as a list of ints from feature properties."""
    colour = props.get("COLOUR")
    if colour is None:
        return []
    if isinstance(colour, list):
        result = []
        for c in colour:
            try:
                result.append(int(c))
            except (ValueError, TypeError):
                pass
        return result
    if isinstance(colour, (int, float)):
        return [int(colour)]
    return []


# S-57 COLOUR codes
_COLOUR_RED = 3
_COLOUR_GREEN = 4


def _boylat_symbol(props: dict) -> str:
    """Compute SYMBOL for a lateral buoy (BOYLAT)."""
    catlam = props.get("CATLAM")
    boyshp = props.get("BOYSHP")
    colours = _parse_colours(props)

    # Preferred channel buoys: multi-color banded
    if len(colours) >= 3:
        if colours[0] == _COLOUR_RED and colours[1] == _COLOUR_GREEN:
            return "preferred-port"  # red-green-red = preferred channel to port
        if colours[0] == _COLOUR_GREEN and colours[1] == _COLOUR_RED:
            return "preferred-stbd"  # green-red-green = preferred channel to stbd

    if catlam == CATLAM_PORT:
        side = "port"
        default_shape = "can"  # IALA-B default for port
    elif catlam == CATLAM_STBD:
        side = "stbd"
        default_shape = "conical"  # IALA-B default for starboard
    else:
        return "lateral-port-can"  # fallback

    shape = _SHAPE_MAP.get(boyshp, default_shape) if boyshp else default_shape
    return f"lateral-{side}-{shape}"


def _boycar_symbol(props: dict) -> str:
    """Compute SYMBOL for a cardinal buoy (BOYCAR)."""
    catcam = props.get("CATCAM")
    direction_map: dict[int, str] = {
        CATCAM_NORTH: "cardinal-n",
        CATCAM_SOUTH: "cardinal-s",
        CATCAM_EAST: "cardinal-e",
        CATCAM_WEST: "cardinal-w",
    }
    if catcam is None:
        return "cardinal-n"
    return direction_map.get(catcam, "cardinal-n")


def _wreck_symbol(props: dict) -> str:
    """Compute SYMBOL for a wreck (WRECKS)."""
    catwrk = props.get("CATWRK")
    watlev = props.get("WATLEV")

    if catwrk == CATWRK_MAST_SHOWING:
        return "wreck-mast"

    if catwrk == CATWRK_NONDANGEROUS:
        return "wreck-nondangerous"

    if watlev == WATLEV_SUBMERGED:
        return "wreck-dangerous"

    if catwrk == CATWRK_DANGEROUS:
        return "wreck-dangerous"

    return "wreck-nondangerous"


_COLOUR_WHITE = 1
_COLOUR_BLACK = 2
_COLOUR_YELLOW = 6
_COLOUR_ORANGE = 11


def _boyspp_symbol(props: dict) -> str:
    """Compute SYMBOL for a special purpose buoy (BOYSPP)."""
    colours = _parse_colours(props)
    if len(colours) >= 2 and _COLOUR_WHITE in colours and _COLOUR_ORANGE in colours:
        return "special-wo"  # white-orange info/regulatory buoy
    return "special"


def _obstruction_symbol(props: dict) -> str:
    """Compute SYMBOL for an obstruction (OBSTRN)."""
    catobs = props.get("CATOBS")
    if catobs in (CATOBS_FOUL_AREA, CATOBS_FOUL_GROUND):
        return "obstruction-foul"
    return "obstruction"


def _rock_symbol(props: dict) -> str:
    """Compute SYMBOL for an underwater rock (UWTROC)."""
    watlev = props.get("WATLEV")
    if watlev == WATLEV_AWASH:
        return "rock-awash"
    if watlev == WATLEV_DRY:
        return "rock-above"
    return "rock-underwater"


def _beacon_symbol(props: dict, layer_name: str) -> str:
    """Compute SYMBOL for a beacon (BCNLAT, BCNCAR)."""
    if layer_name == "BCNCAR":
        return "beacon-cardinal"
    catlam = props.get("CATLAM")
    if catlam == CATLAM_PORT:
        return "beacon-port"
    if catlam == CATLAM_STBD:
        return "beacon-stbd"
    return "beacon-default"


def _light_symbol(props: dict) -> str:
    """Compute SYMBOL for a light (LIGHTS).

    Encodes both significance (major/minor based on nominal range)
    and colour (red/green/white) so the renderer can pick the
    correct light-flare sprite.
    """
    colours = _parse_colours(props)
    # Determine colour suffix
    if _COLOUR_GREEN in colours:
        colour = "green"
    elif _COLOUR_RED in colours:
        colour = "red"
    else:
        colour = "white"  # white/yellow/default

    valnmr = props.get("VALNMR")
    significance = "major" if valnmr is not None and valnmr >= 10 else "minor"
    return f"light-{significance}-{colour}"


def _bcnspp_symbol(props: dict) -> str:
    """Compute SYMBOL for a special purpose beacon (BCNSPP)."""
    return "beacon-special"


# S-57 TOPSHP (topmark shape) codes
TOPSHP_CONE_UP = 1
TOPSHP_CONE_DOWN = 2
TOPSHP_SPHERE = 3
TOPSHP_2CONES_UP = 4
TOPSHP_2CONES_DOWN = 5
TOPSHP_CYLINDER = 7
TOPSHP_X = 10
TOPSHP_2SPHERES = 12
TOPSHP_SQUARE = 6


def _daymar_symbol(props: dict) -> str:
    """Compute SYMBOL for a daymark (DAYMAR)."""
    topshp = props.get("TOPSHP")
    colours = _parse_colours(props)

    shape = "square"
    if topshp == TOPSHP_CONE_UP:
        shape = "triangle"
    elif topshp == TOPSHP_SQUARE or topshp == TOPSHP_CYLINDER:
        shape = "square"

    colour = "red"
    if _COLOUR_GREEN in colours:
        colour = "green"
    elif _COLOUR_RED in colours:
        colour = "red"
    elif _COLOUR_YELLOW in colours:
        colour = "red"  # fallback to red for yellow

    return f"daymark-{shape}-{colour}"


def _topmar_symbol(props: dict) -> str:
    """Compute SYMBOL for a topmark (TOPMAR)."""
    topshp = props.get("TOPSHP")
    topshp_map: dict[int, str] = {
        TOPSHP_CONE_UP: "topmark-cone-up",
        TOPSHP_CONE_DOWN: "topmark-cone-down",
        TOPSHP_SPHERE: "topmark-sphere",
        TOPSHP_X: "topmark-x",
        TOPSHP_2CONES_UP: "topmark-2cones-up",
        TOPSHP_2CONES_DOWN: "topmark-2cones-down",
    }
    if topshp is None:
        return "topmark-sphere"
    return topshp_map.get(topshp, "topmark-sphere")


# S-57 CATLMK (category of landmark) codes
CATLMK_CAIRN = 1
CATLMK_CHIMNEY = 3
CATLMK_FLAGSTAFF = 5
CATLMK_MAST = 7
CATLMK_MONUMENT = 9
CATLMK_DOME = 15
CATLMK_TOWER = 17
CATLMK_WINDMILL = 18
CATLMK_WINDMOTOR = 19


def _parse_first_int(value: object) -> int | None:
    """Extract the first integer from a value that may be int, str, or list."""
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str):
        try:
            return int(value)
        except ValueError:
            return None
    if isinstance(value, list) and len(value) > 0:
        try:
            return int(value[0])
        except (ValueError, TypeError):
            return None
    return None


def _landmark_symbol(props: dict) -> str:
    """Compute SYMBOL for a landmark (LNDMRK) based on CATLMK."""
    catlmk = _parse_first_int(props.get("CATLMK"))
    if catlmk == CATLMK_TOWER:
        return "landmark-tower"
    if catlmk == CATLMK_CHIMNEY:
        return "landmark-chimney"
    if catlmk == CATLMK_WINDMOTOR:
        return "landmark-windmotor"
    if catlmk == CATLMK_WINDMILL:
        return "landmark-windmill"
    if catlmk == CATLMK_MONUMENT:
        return "landmark-monument"
    if catlmk == CATLMK_FLAGSTAFF:
        return "landmark-flagstaff"
    if catlmk == CATLMK_MAST:
        return "landmark-tower"  # mast rendered as tower
    return "landmark-default"


def compute_symbol(props: dict, layer_name: str) -> str | None:
    """Compute the semantic SYMBOL value for a feature.

    Args:
        props: Feature properties dict.
        layer_name: S-57 layer name (e.g., "BOYLAT").

    Returns:
        Semantic symbol name, or None if no symbol applies.
    """
    if layer_name == "BOYLAT":
        return _boylat_symbol(props)
    if layer_name == "BOYCAR":
        return _boycar_symbol(props)
    if layer_name == "BOYSAW":
        return "safewater"
    if layer_name == "BOYSPP":
        return _boyspp_symbol(props)
    if layer_name == "BOYISD":
        return "isolated-danger"
    if layer_name in ("BCNLAT", "BCNCAR"):
        return _beacon_symbol(props, layer_name)
    if layer_name == "LIGHTS":
        return _light_symbol(props)
    if layer_name == "WRECKS":
        return _wreck_symbol(props)
    if layer_name == "OBSTRN":
        return _obstruction_symbol(props)
    if layer_name == "UWTROC":
        return _rock_symbol(props)
    if layer_name == "FOGSIG":
        return "fogsig"
    if layer_name == "MORFAC":
        return "mooring"
    if layer_name == "PILPNT":
        return "piling"
    if layer_name == "BCNSPP":
        return _bcnspp_symbol(props)
    if layer_name == "DAYMAR":
        return _daymar_symbol(props)
    if layer_name == "TOPMAR":
        return _topmar_symbol(props)
    if layer_name == "HRBFAC":
        return "harbor"
    if layer_name == "OFSPLF":
        return "platform"
    if layer_name == "LNDMRK":
        return _landmark_symbol(props)
    if layer_name == "SILTNK":
        return "tank"
    return None


def add_symbols_to_geojson(geojson_path: Path) -> int:
    """Add SYMBOL property to features in a GeoJSON file.

    Modifies the file in-place.

    Args:
        geojson_path: Path to the GeoJSON file.

    Returns:
        Number of features that got symbols.
    """
    layer_name = geojson_path.stem.upper()

    with open(geojson_path) as f:
        geojson = json.load(f)

    count = 0
    for feature in geojson.get("features", []):
        props = feature.get("properties", {})
        symbol = compute_symbol(props, layer_name)

        if symbol:
            props["SYMBOL"] = symbol
            count += 1

    with open(geojson_path, "w") as f:
        json.dump(geojson, f)

    return count
