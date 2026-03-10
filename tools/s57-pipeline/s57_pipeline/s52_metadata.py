"""S-52 display category and priority metadata for S-57 features.

Stamps each GeoJSON feature with:
  _disp_cat: DISPLAYBASE | STANDARD | OTHER
  _disp_pri: 0-9 S-52 display priority (lower = drawn first)
"""

from __future__ import annotations

import json
from pathlib import Path

# S-52 Display Category by S-57 object class
DISPLAY_CATEGORY: dict[str, str] = {
    # DISPLAYBASE — always shown
    "COALNE": "DISPLAYBASE",
    "DEPARE": "DISPLAYBASE",
    "DEPCNT": "DISPLAYBASE",
    "LNDARE": "DISPLAYBASE",
    "UNSARE": "DISPLAYBASE",
    "SOUNDG": "DISPLAYBASE",
    "UWTROC": "DISPLAYBASE",
    "WRECKS": "DISPLAYBASE",
    "OBSTRN": "DISPLAYBASE",
    "ROCKAL": "DISPLAYBASE",
    # STANDARD — shown at normal detail
    "BOYLAT": "STANDARD",
    "BOYCAR": "STANDARD",
    "BOYSAW": "STANDARD",
    "BOYSPP": "STANDARD",
    "BOYISD": "STANDARD",
    "BCNLAT": "STANDARD",
    "BCNCAR": "STANDARD",
    "LIGHTS": "STANDARD",
    "FOGSIG": "STANDARD",
    "LNDMRK": "STANDARD",
    "RESARE": "STANDARD",
    "ACHARE": "STANDARD",
    "TSSLPT": "STANDARD",
    "FAIRWY": "STANDARD",
    "CTNARE": "STANDARD",
    "SEAARE": "STANDARD",
    "DRGARE": "STANDARD",
    "LAKARE": "STANDARD",
    "RIVERS": "STANDARD",
    "SLCONS": "STANDARD",
    "BRIDGE": "STANDARD",
    "CBLOHD": "STANDARD",
    "CBLSUB": "STANDARD",
    "NAVLNE": "STANDARD",
    "RECTRC": "STANDARD",
    "DWRTCL": "STANDARD",
    "TSSBND": "STANDARD",
    "TSEZNE": "STANDARD",
    "TWRTPT": "STANDARD",
    "BCNSPP": "STANDARD",
    "ACHBRT": "STANDARD",
    "LNDRGN": "STANDARD",
    "LNDELV": "STANDARD",
    "BUAARE": "STANDARD",
    "SMCFAC": "OTHER",
    # OTHER — shown at full detail
    "BUISGL": "OTHER",
    "BERTHS": "OTHER",
    "PILPNT": "OTHER",
    "MORFAC": "OTHER",
    "PONTON": "OTHER",
    "DAYMAR": "OTHER",
    "TOPMAR": "OTHER",
    "SBDARE": "OTHER",
    "HRBFAC": "OTHER",
    "CBLARE": "OTHER",
    "PIPARE": "OTHER",
    "PIPSOL": "OTHER",
    "DMPGRD": "OTHER",
    "OFSPLF": "OTHER",
    "MAGVAR": "OTHER",
    # New layers
    "PRCARE": "STANDARD",
    "PILBOP": "STANDARD",
    "WATTUR": "STANDARD",
    "GATCON": "STANDARD",
    "DAMCON": "STANDARD",
    "TUNNEL": "STANDARD",
    "FSHFAC": "STANDARD",
    "DYKCON": "STANDARD",
    "SLOTOP": "STANDARD",
    "PYLONS": "STANDARD",
    "CRANES": "OTHER",
    "FORSTC": "OTHER",
    "CGUSTA": "OTHER",
    "HULKES": "STANDARD",
    "DRYDOC": "OTHER",
    "RUNWAY": "OTHER",
    "AIRARE": "OTHER",
}

# S-52 Display Priority by S-57 object class (0-9, lower = drawn first)
DISPLAY_PRIORITY: dict[str, int] = {
    # Priority 1: area fills (drawn first)
    "DEPARE": 1,
    "LNDARE": 1,
    "UNSARE": 1,
    # Priority 2: secondary area fills
    "LAKARE": 2,
    "RIVERS": 2,
    "DRGARE": 2,
    "PONTON": 2,
    "SEAARE": 2,
    # Priority 3: depth contours
    "DEPCNT": 3,
    # Priority 4: lines and linear features
    "COALNE": 4,
    "SLCONS": 4,
    "BRIDGE": 4,
    "CBLSUB": 4,
    "CBLOHD": 4,
    "FAIRWY": 4,
    "TSSLPT": 4,
    # Priority 5: hazards and regulatory areas
    "WRECKS": 5,
    "OBSTRN": 5,
    "UWTROC": 5,
    "ROCKAL": 5,
    "RESARE": 5,
    "ACHARE": 5,
    "CTNARE": 5,
    # Priority 6: nav aids and soundings
    "SOUNDG": 6,
    "BOYLAT": 6,
    "BOYCAR": 6,
    "BOYSAW": 6,
    "BOYSPP": 6,
    "BOYISD": 6,
    "BCNLAT": 6,
    "BCNCAR": 6,
    # Priority 7: infrastructure
    "BUISGL": 7,
    "BERTHS": 7,
    "PILPNT": 7,
    "MORFAC": 7,
    # Priority 4 (continued): routing lines
    "NAVLNE": 4,
    "RECTRC": 4,
    "DWRTCL": 4,
    "TSSBND": 4,
    "PIPSOL": 4,
    # Priority 5 (continued): regulatory areas
    "TSEZNE": 5,
    "TWRTPT": 5,
    "ACHBRT": 5,
    "CBLARE": 5,
    "PIPARE": 5,
    "DMPGRD": 5,
    # Priority 6 (continued): additional navaids
    "BCNSPP": 6,
    "SBDARE": 6,
    # Priority 7 (continued): infrastructure
    "HRBFAC": 7,
    "OFSPLF": 7,
    "MAGVAR": 7,
    # Priority 7 (continued): land labels
    "LNDRGN": 7,
    "LNDELV": 7,
    "BUAARE": 2,
    "SMCFAC": 7,
    # Priority 8: lights, fog signals, landmarks, visual marks
    "LIGHTS": 8,
    "FOGSIG": 8,
    "LNDMRK": 8,
    "DAYMAR": 8,
    "TOPMAR": 8,
    # New layers
    "PRCARE": 5,
    "PILBOP": 6,
    "WATTUR": 5,
    "GATCON": 4,
    "DAMCON": 4,
    "TUNNEL": 4,
    "FSHFAC": 5,
    "DYKCON": 4,
    "SLOTOP": 4,
    "PYLONS": 4,
    "CRANES": 7,
    "FORSTC": 7,
    "CGUSTA": 7,
    "HULKES": 5,
    "DRYDOC": 7,
    "RUNWAY": 7,
    "AIRARE": 7,
}


def add_s52_metadata(path: Path) -> int:
    """Add _disp_cat and _disp_pri properties to each feature in a GeoJSON file.

    Uses the file stem (uppercased) as the layer name for lookup.

    Args:
        path: Path to the GeoJSON file to enrich.

    Returns:
        Number of features processed.
    """
    layer_name = path.stem.upper()
    disp_cat = DISPLAY_CATEGORY.get(layer_name)
    disp_pri = DISPLAY_PRIORITY.get(layer_name)

    if disp_cat is None and disp_pri is None:
        return 0

    with open(path) as f:
        geojson = json.load(f)

    count = 0
    for feature in geojson.get("features", []):
        props = feature.get("properties", {})
        if disp_cat is not None:
            props["_disp_cat"] = disp_cat
        if disp_pri is not None:
            props["_disp_pri"] = disp_pri
        count += 1

    with open(path, "w") as f:
        json.dump(geojson, f)

    return count
