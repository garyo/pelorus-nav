"""S-57 layer definitions and tippecanoe settings per layer group."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class LayerConfig:
    """Configuration for a single S-57 layer's tippecanoe processing."""

    name: str
    group: str
    tippecanoe_args: list[str] = field(default_factory=list)


# Tippecanoe strategies by group
TERRAIN_ARGS = ["--coalesce-densest-as-needed"]
LINE_ARGS = ["--coalesce-densest-as-needed"]
DENSE_POINT_ARGS = [
    "--drop-densest-as-needed",
    "--extend-zooms-if-still-dropping",
]
NAVAID_ARGS = ["-r1"]  # Keep all at all zooms
HAZARD_ARGS = ["-r1"]
REGULATORY_ARGS = ["--coalesce-densest-as-needed"]
DEFAULT_ARGS: list[str] = []

# All S-57 layers we process, grouped by tippecanoe strategy
LAYER_CONFIGS: list[LayerConfig] = [
    # Terrain polygons
    LayerConfig("DEPARE", "terrain", TERRAIN_ARGS),
    LayerConfig("LNDARE", "terrain", TERRAIN_ARGS),
    LayerConfig("SEAARE", "labels", TERRAIN_ARGS),
    LayerConfig("LAKARE", "terrain", TERRAIN_ARGS),
    LayerConfig("RIVERS", "terrain", TERRAIN_ARGS),
    LayerConfig("DRGARE", "terrain", TERRAIN_ARGS),
    LayerConfig("UNSARE", "terrain", TERRAIN_ARGS),
    # Lines
    LayerConfig("DEPCNT", "lines", LINE_ARGS),
    LayerConfig("COALNE", "lines", LINE_ARGS),
    LayerConfig("SLCONS", "lines", LINE_ARGS),
    # Dense points
    LayerConfig("SOUNDG", "dense_points", DENSE_POINT_ARGS),
    # Nav aids (sparse, critical — keep all)
    LayerConfig("BOYLAT", "navaids", NAVAID_ARGS),
    LayerConfig("BOYCAR", "navaids", NAVAID_ARGS),
    LayerConfig("BOYSAW", "navaids", NAVAID_ARGS),
    LayerConfig("BOYSPP", "navaids", NAVAID_ARGS),
    LayerConfig("BOYISD", "navaids", NAVAID_ARGS),
    LayerConfig("BCNLAT", "navaids", NAVAID_ARGS),
    LayerConfig("BCNCAR", "navaids", NAVAID_ARGS),
    LayerConfig("LIGHTS", "navaids", NAVAID_ARGS),
    LayerConfig("FOGSIG", "navaids", NAVAID_ARGS),
    # Hazards
    LayerConfig("WRECKS", "hazards", HAZARD_ARGS),
    LayerConfig("OBSTRN", "hazards", HAZARD_ARGS),
    LayerConfig("UWTROC", "hazards", HAZARD_ARGS),
    LayerConfig("ROCKAL", "hazards", HAZARD_ARGS),
    # Regulatory areas
    LayerConfig("TSSLPT", "regulatory", REGULATORY_ARGS),
    LayerConfig("RESARE", "regulatory", REGULATORY_ARGS),
    LayerConfig("ACHARE", "regulatory", REGULATORY_ARGS),
    LayerConfig("FAIRWY", "regulatory", REGULATORY_ARGS),
    LayerConfig("CTNARE", "regulatory", REGULATORY_ARGS),
    # Landmarks (lighthouses, monuments, towers)
    LayerConfig("LNDMRK", "navaids", NAVAID_ARGS),
    # Land regions (named points, capes, peninsulas) & elevations
    LayerConfig("LNDRGN", "labels", DEFAULT_ARGS),
    LayerConfig("LNDELV", "labels", NAVAID_ARGS),
    # Built-up areas (cities, towns)
    LayerConfig("BUAARE", "labels", DEFAULT_ARGS),
    # Small craft facilities (marinas, yacht clubs, boat ramps)
    LayerConfig("SMCFAC", "infrastructure", DEFAULT_ARGS),
    # Buildings, berths & pilings
    LayerConfig("BUISGL", "infrastructure", DEFAULT_ARGS),
    LayerConfig("BERTHS", "labels", DEFAULT_ARGS),
    LayerConfig("PILPNT", "infrastructure", HAZARD_ARGS),
    # Infrastructure
    LayerConfig("BRIDGE", "infrastructure", DEFAULT_ARGS),
    LayerConfig("CBLOHD", "infrastructure", DEFAULT_ARGS),
    LayerConfig("CBLSUB", "infrastructure", DEFAULT_ARGS),
    LayerConfig("MORFAC", "infrastructure", DEFAULT_ARGS),
    LayerConfig("PONTON", "infrastructure", DEFAULT_ARGS),
    # Routing lines (regulatory)
    LayerConfig("NAVLNE", "regulatory", REGULATORY_ARGS),
    LayerConfig("RECTRC", "regulatory", REGULATORY_ARGS),
    LayerConfig("DWRTCL", "regulatory", REGULATORY_ARGS),
    LayerConfig("TSSBND", "regulatory", REGULATORY_ARGS),
    LayerConfig("PIPSOL", "regulatory", REGULATORY_ARGS),
    # Regulatory area fills
    LayerConfig("TSEZNE", "regulatory", REGULATORY_ARGS),
    LayerConfig("TWRTPT", "regulatory", REGULATORY_ARGS),
    LayerConfig("ACHBRT", "regulatory", REGULATORY_ARGS),
    LayerConfig("CBLARE", "regulatory", REGULATORY_ARGS),
    LayerConfig("PIPARE", "regulatory", REGULATORY_ARGS),
    LayerConfig("DMPGRD", "regulatory", REGULATORY_ARGS),
    # Navaids (additional)
    LayerConfig("BCNSPP", "navaids", NAVAID_ARGS),
    LayerConfig("DAYMAR", "navaids", NAVAID_ARGS),
    LayerConfig("TOPMAR", "navaids", NAVAID_ARGS),
    # Dense labels
    LayerConfig("SBDARE", "dense_points", DENSE_POINT_ARGS),
    # Infrastructure (additional)
    LayerConfig("HRBFAC", "infrastructure", DEFAULT_ARGS),
    LayerConfig("OFSPLF", "infrastructure", HAZARD_ARGS),
    LayerConfig("SILTNK", "infrastructure", DEFAULT_ARGS),
    LayerConfig("MAGVAR", "labels", DENSE_POINT_ARGS),
    # High priority (safety)
    LayerConfig("PRCARE", "regulatory", REGULATORY_ARGS),
    LayerConfig("PILBOP", "navaids", NAVAID_ARGS),
    LayerConfig("WATTUR", "hazards", HAZARD_ARGS),
    LayerConfig("GATCON", "infrastructure", DEFAULT_ARGS),
    LayerConfig("DAMCON", "infrastructure", DEFAULT_ARGS),
    LayerConfig("TUNNEL", "infrastructure", DEFAULT_ARGS),
    LayerConfig("FSHFAC", "hazards", HAZARD_ARGS),
    # Medium priority
    LayerConfig("DYKCON", "lines", LINE_ARGS),
    LayerConfig("SLOTOP", "lines", LINE_ARGS),
    LayerConfig("PYLONS", "infrastructure", DEFAULT_ARGS),
    LayerConfig("CRANES", "infrastructure", DEFAULT_ARGS),
    LayerConfig("FORSTC", "infrastructure", DEFAULT_ARGS),
    LayerConfig("CGUSTA", "infrastructure", DEFAULT_ARGS),
    LayerConfig("HULKES", "hazards", HAZARD_ARGS),
    LayerConfig("DRYDOC", "infrastructure", DEFAULT_ARGS),
    LayerConfig("RUNWAY", "infrastructure", DEFAULT_ARGS),
    LayerConfig("AIRARE", "infrastructure", DEFAULT_ARGS),
]

# Quick lookup by layer name
LAYER_MAP: dict[str, LayerConfig] = {lc.name: lc for lc in LAYER_CONFIGS}

# All layer names we care about
LAYER_NAMES: list[str] = [lc.name for lc in LAYER_CONFIGS]

# Groups for reference
GROUPS: set[str] = {lc.group for lc in LAYER_CONFIGS}


def get_layer_config(layer_name: str) -> LayerConfig | None:
    """Get the config for a given S-57 layer name, or None if unknown."""
    return LAYER_MAP.get(layer_name)


def get_layers_by_group(group: str) -> list[LayerConfig]:
    """Get all layer configs for a given group."""
    return [lc for lc in LAYER_CONFIGS if lc.group == group]
