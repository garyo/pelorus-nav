"""Compute short nautical labels for features.

Adds a LABEL property to GeoJSON features for display on the chart.
Examples: "Fl G 4s", "Q R", "3", "22".
"""

from __future__ import annotations

import re

# S-57 LITCHR (light character) code → abbreviation
LITCHR_ABBREV: dict[int, str] = {
    1: "F",       # Fixed
    2: "Fl",      # Flashing
    3: "LFl",     # Long-flashing
    4: "Q",       # Quick
    5: "VQ",      # Very quick
    6: "UQ",      # Ultra quick
    7: "Iso",     # Isophase
    8: "Oc",      # Occulting
    9: "IQ",      # Interrupted quick
    10: "IVQ",    # Interrupted very quick
    11: "IUQ",    # Interrupted ultra quick
    12: "Mo",     # Morse
    13: "FFl",    # Fixed/flash
    14: "FlLFl",  # Flash/long-flash
    15: "OcFl",   # Occulting/flash
    16: "FLFl",   # Fixed/long-flash
    17: "Al.Oc",  # Alternating occulting
    18: "Al.LFl", # Alternating long-flash
    19: "Al.Fl",  # Alternating flash
    20: "Al.Gp",  # Alternating group
    25: "Q+LFl",  # Quick + long-flash
    26: "VQ+LFl", # Very quick + long-flash
    27: "UQ+LFl", # Ultra quick + long-flash
    28: "Al",     # Alternating
    29: "Al.FFl", # Fixed + alternating flashing
}

# S-57 COLOUR code → single-letter abbreviation
COLOUR_ABBREV: dict[int, str] = {
    1: "W",   # White
    3: "R",   # Red
    4: "G",   # Green
    6: "Y",   # Yellow
    11: "Or",  # Orange
    12: "Am",  # Amber
}


def _light_label(props: dict) -> str | None:
    """Build a short light label like 'Fl G 4s' from LIGHTS properties."""
    litchr = props.get("LITCHR")
    if litchr is None:
        return None

    parts: list[str] = []

    # Light character
    char_abbrev = LITCHR_ABBREV.get(litchr)
    if char_abbrev is None:
        return None
    parts.append(char_abbrev)

    # Group notation for group flashing: e.g. "(2)" → "Fl(2)"
    siggrp = props.get("SIGGRP")
    if siggrp and siggrp != "(1)":
        parts[0] = f"{char_abbrev}{siggrp}"

    # Color
    colour = props.get("COLOUR")
    if colour:
        if isinstance(colour, list) and len(colour) > 0:
            try:
                code = int(colour[0])
            except (ValueError, TypeError):
                code = 0
        elif isinstance(colour, (int, float)):
            code = int(colour)
        else:
            code = 0
        abbrev = COLOUR_ABBREV.get(code)
        if abbrev and abbrev != "W":  # White is default, omit
            parts.append(abbrev)

    # Period
    sigper = props.get("SIGPER")
    if sigper is not None and sigper > 0:
        # Format as integer if whole number
        if sigper == int(sigper):
            parts.append(f"{int(sigper)}s")
        else:
            parts.append(f"{sigper}s")

    return " ".join(parts) if parts else None


def _buoy_number(props: dict) -> str | None:
    """Extract short buoy number/name from OBJNAM.

    'Boston Main Channel Lighted Buoy 6' → '6'
    'Spectacle Island Channel Daybeacon A' → 'A'
    """
    objnam = props.get("OBJNAM")
    if not objnam:
        return None

    # Try to extract trailing number or letter designation
    # Matches: "6", "6A", "PR", "TN", "BG", "NC", "1HL", "1SC", "A"
    match = re.search(r'\b(\d+[A-Z]*|[A-Z]{1,3})$', objnam.strip())
    if match:
        return match.group(1)
    return None


# S-57 NATSUR (nature of surface) code → chart abbreviation
NATSUR_ABBREV: dict[int, str] = {
    1: "M",     # Mud
    2: "Cy",    # Clay
    3: "Si",    # Silt
    4: "S",     # Sand
    5: "St",    # Stone
    6: "G",     # Gravel
    7: "P",     # Pebbles
    8: "Cb",    # Cobbles
    9: "R",     # Rock
    11: "La",   # Lava
    14: "Co",   # Coral
    17: "Sh",   # Shells
    18: "Bo",   # Boulder
}


def _seabed_label(props: dict) -> str | None:
    """Build a seabed nature label like 'S' (Sand) or 'S.M' (Sand/Mud)."""
    natsur = props.get("NATSUR")
    if not natsur:
        return None
    if not isinstance(natsur, list):
        natsur = [natsur]
    parts = []
    for code in natsur:
        try:
            abbrev = NATSUR_ABBREV.get(int(code))
            if abbrev:
                parts.append(abbrev)
        except (ValueError, TypeError):
            pass
    return ".".join(parts) if parts else None
